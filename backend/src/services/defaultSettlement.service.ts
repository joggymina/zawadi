import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { Decimal } from "@prisma/client/runtime/library";
import { writeAudit } from "./audit.service";
import { getAdminSettings } from "./adminSettings.service";

const DAY_MS = 86_400_000;

function elapsedDays(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / DAY_MS);
}

function simpleInterest(principal: Decimal, aprPct: Decimal | number, days: number): Decimal {
  if (days <= 0) return new Decimal(0);
  const p = Number(principal);
  if (p <= 0) return new Decimal(0);
  return new Decimal(((p * Number(aprPct)) / 100) * (days / 365)).toDecimalPlaces(2);
}

function graceEnd(dueAt: Date, graceHours: number): Date {
  return new Date(dueAt.getTime() + graceHours * 60 * 60 * 1000);
}

export async function findDefaultCandidates(now = new Date()) {
  const loans = await prisma.loan.findMany({
    where: { status: "REPAYING", dueAt: { not: null } },
    include: {
      package: true,
      fundings: true,
      guarantors: { where: { status: "ACCEPTED" } },
      borrower: { select: { id: true, username: true } },
    },
  });

  return loans.filter((loan) => {
    if (!loan.dueAt) return false;
    const grace = loan.package?.graceHours ?? 0;
    return now.getTime() > graceEnd(loan.dueAt, grace).getTime();
  });
}

export async function settleDefaultedLoan(params: {
  loanId: string;
  triggeredById?: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Loan" WHERE id = ${params.loanId} FOR UPDATE`;

    const loan = await tx.loan.findUnique({
      where: { id: params.loanId },
      include: {
        package: true,
        fundings: true,
        guarantors: { where: { status: "ACCEPTED" } },
      },
    });
    if (!loan) throw new AppError("Loan not found.", 404);
    if (loan.status !== "REPAYING") {
      throw new AppError("Loan is not in REPAYING status.", 422);
    }
    if (!loan.dueAt) throw new AppError("Loan has no due date.", 422);

    const grace = loan.package?.graceHours ?? 0;
    if (now.getTime() <= graceEnd(loan.dueAt, grace).getTime()) {
      throw new AppError("Loan is still within term or grace period.", 422);
    }

    let interestOwed = loan.interestOwed;
    let lastAccrualAt = loan.lastAccrualAt;
    if (lastAccrualAt && loan.principalOwed.greaterThan(0)) {
      const days = elapsedDays(lastAccrualAt, now);
      if (days > 0) {
        interestOwed = interestOwed.plus(
          simpleInterest(loan.principalOwed, loan.interestRateApr, days),
        );
        lastAccrualAt = now;
      }
    }

    let remaining = loan.principalOwed.plus(interestOwed);
    if (remaining.lessThanOrEqualTo(0)) {
      await tx.loan.update({
        where: { id: loan.id },
        data: {
          principalOwed: new Decimal(0),
          interestOwed: new Decimal(0),
          lastAccrualAt: lastAccrualAt ?? loan.lastAccrualAt,
          status: "REPAID",
        },
      });
      return {
        loanId: loan.id,
        status: "REPAID" as const,
        collected: new Decimal(0),
        uncollected: new Decimal(0),
      };
    }

    let collected = new Decimal(0);

    const borrowerAccount = await tx.investmentAccount.findUnique({
      where: { userId: loan.borrowerId },
    });
    if (borrowerAccount) {
      const fromPrincipal = Decimal.min(remaining, borrowerAccount.principalBalance);
      if (fromPrincipal.greaterThan(0)) {
        await tx.investmentAccount.update({
          where: { userId: loan.borrowerId },
          data: { principalBalance: { decrement: fromPrincipal } },
        });
        remaining = remaining.minus(fromPrincipal);
        collected = collected.plus(fromPrincipal);
        const after = await tx.investmentAccount.findUniqueOrThrow({
          where: { userId: loan.borrowerId },
        });
        await tx.transaction.create({
          data: {
            userId: loan.borrowerId,
            type: "LOAN_REPAYMENT",
            amount: fromPrincipal,
            balanceAfter: after.principalBalance.plus(after.interestBalance),
            referenceId: loan.id,
            note: "Default settlement — borrower principal",
          },
        });
      }

      if (remaining.greaterThan(0)) {
        const refreshed = await tx.investmentAccount.findUniqueOrThrow({
          where: { userId: loan.borrowerId },
        });
        const fromInterest = Decimal.min(remaining, refreshed.interestBalance);
        if (fromInterest.greaterThan(0)) {
          await tx.investmentAccount.update({
            where: { userId: loan.borrowerId },
            data: { interestBalance: { decrement: fromInterest } },
          });
          remaining = remaining.minus(fromInterest);
          collected = collected.plus(fromInterest);
          const after = await tx.investmentAccount.findUniqueOrThrow({
            where: { userId: loan.borrowerId },
          });
          await tx.transaction.create({
            data: {
              userId: loan.borrowerId,
              type: "LOAN_REPAYMENT",
              amount: fromInterest,
              balanceAfter: after.principalBalance.plus(after.interestBalance),
              referenceId: loan.id,
              note: "Default settlement — borrower interest balance",
            },
          });
        }
      }
    }

    if (remaining.greaterThan(0) && loan.guarantors.length > 0) {
      const shortfall = remaining;
      const totalHold = loan.guarantors.reduce(
        (s, g) => s.plus(g.balanceAtPledge),
        new Decimal(0),
      );

      for (const g of loan.guarantors) {
        if (remaining.lessThanOrEqualTo(0)) break;
        const share = totalHold.greaterThan(0)
          ? shortfall.mul(g.balanceAtPledge).div(totalHold).toDecimalPlaces(2)
          : new Decimal(0);
        const cap = Decimal.min(share, g.balanceAtPledge);
        if (cap.lessThanOrEqualTo(0)) continue;

        const gAccount = await tx.investmentAccount.findUnique({ where: { userId: g.userId } });
        if (!gAccount) continue;
        const debit = Decimal.min(cap, gAccount.principalBalance, remaining);
        if (debit.lessThanOrEqualTo(0)) continue;

        await tx.investmentAccount.update({
          where: { userId: g.userId },
          data: { principalBalance: { decrement: debit } },
        });
        remaining = remaining.minus(debit);
        collected = collected.plus(debit);
        const after = await tx.investmentAccount.findUniqueOrThrow({
          where: { userId: g.userId },
        });
        await tx.transaction.create({
          data: {
            userId: g.userId,
            type: "ADJUSTMENT",
            amount: debit,
            balanceAfter: after.principalBalance.plus(after.interestBalance),
            referenceId: loan.id,
            note: "Default settlement — guarantor hold drawn",
          },
        });
      }
    }

    if (collected.greaterThan(0) && loan.fundings.length > 0) {
      const settings = await getAdminSettings();
      const sharePct = Number(settings.platformInterestSharePct ?? 10) / 100;

      const interestCollected = Decimal.min(collected, interestOwed);
      const principalCollected = collected.minus(interestCollected);

      const totalFunded = loan.fundings.reduce((s, f) => s.plus(f.amount), new Decimal(0));
      const denom = totalFunded.greaterThan(0) ? totalFunded : loan.amount;

      for (const f of loan.fundings) {
        const weight = f.amount.div(denom);
        const dPrincipal = principalCollected.mul(weight).toDecimalPlaces(2);
        const dInterest = interestCollected.mul(weight).toDecimalPlaces(2);
        const fee = dInterest.mul(sharePct).toDecimalPlaces(2);
        const credit = dPrincipal.plus(dInterest).minus(fee);
        if (credit.lessThanOrEqualTo(0)) continue;

        const funderAccount = await tx.investmentAccount.findUniqueOrThrow({
          where: { userId: f.funderId },
        });
        await tx.investmentAccount.update({
          where: { userId: f.funderId },
          data: { principalBalance: { increment: credit } },
        });
        await tx.transaction.create({
          data: {
            userId: f.funderId,
            type: "LOAN_RETURN",
            amount: credit,
            balanceAfter: funderAccount.principalBalance
              .plus(credit)
              .plus(funderAccount.interestBalance),
            referenceId: loan.id,
            note: `Default settlement return (platform fee on interest ${fee.toFixed(2)})`,
          },
        });
      }
    }

    // Always DEFAULTED when recovery runs via past-due path (not voluntary REPAID)
const finalStatus = "DEFAULTED" as const;

    await tx.loan.update({
      where: { id: loan.id },
      data: {
        principalOwed: new Decimal(0),
        interestOwed: new Decimal(0),
        lastAccrualAt: lastAccrualAt ?? loan.lastAccrualAt,
        status: finalStatus,
      },
    });

    return {
      loanId: loan.id,
      status: finalStatus as "DEFAULTED" | "REPAID",
      collected,
      uncollected: remaining,
    };
  });

  if (params.triggeredById) {
    await writeAudit({
      userId: params.triggeredById,
      action: "LOAN_DEFAULT_SETTLE",
      metadata: {
        loanId: result.loanId,
        status: result.status,
        collected: Number(result.collected),
        uncollected: Number(result.uncollected),
      },
    });
  }

  return result;
}

export async function runDefaultSettlements(now = new Date()) {
  const candidates = await findDefaultCandidates(now);
  const results: Array<Record<string, unknown>> = [];
  for (const loan of candidates) {
    try {
      const r = await settleDefaultedLoan({ loanId: loan.id, now });
      results.push({
        loanId: r.loanId,
        status: r.status,
        collected: r.collected.toFixed(2),
        uncollected: r.uncollected.toFixed(2),
      });
      // eslint-disable-next-line no-console
      console.log(`Default settled ${loan.id} → ${r.status}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Default settle failed for ${loan.id}:`, err);
      results.push({ loanId: loan.id, error: String(err) });
    }
  }
  return results;
}