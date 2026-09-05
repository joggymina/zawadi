import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { getAdminSettings } from "./adminSettings.service";
import { assertCanDebitPrincipal } from "./guarantorHold.service";
import { ensurePlatformUser, debitPlatform, ensurePlatformAccount, creditPlatformTx, getPlatformUserId, PLATFORM_USERNAME } from "./platform.service";
import * as notifications from "./notification.service";
import { Decimal } from "@prisma/client/runtime/library";
import { termInterestTotal } from "../utils/money";

const DAY_MS = 86_400_000;

function elapsedHoursBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / (60 * 60 * 1000));
}

/**
 * Package-tier interest (not hourly pro-rata of the original package).
 *
 * When the borrower repays (or we show outstanding), elapsed time since
 * disbursement is matched to a loan package by duration:
 *   - find the shortest package whose durationHours >= elapsedHours
 *   - if elapsed exceeds every package, use the loan's own package
 * Interest due = principal × matchedPackage.rate%  (full tier fee, not hourly steps).
 *
 * Example: 180-day loan repaid after 10 hours → 12-hour package rate applies.
 */
export type PackageTier = {
  id: string;
  name: string;
  durationHours: number;
  interestRateApr: Decimal | { toString(): string };
};

export function matchPackageTier(
  packages: PackageTier[],
  elapsedHours: number,
  fallback: PackageTier | null,
): PackageTier | null {
  if (!packages.length) return fallback;
  const sorted = [...packages].sort((a, b) => a.durationHours - b.durationHours);
  const hours = Math.max(0, elapsedHours);
  // Shortest package that fully covers time used.
  const match = sorted.find((p) => p.durationHours >= hours);
  if (match) return match;
  // Past every published package duration → loan's own package (or longest).
  return fallback ?? sorted[sorted.length - 1];
}

export function interestForPackageTier(params: {
  principal: Decimal | number;
  packages: PackageTier[];
  elapsedHours: number;
  loanPackage: PackageTier | null;
}): { interest: Decimal; tier: PackageTier | null; ratePct: Decimal } {
  const tier = matchPackageTier(params.packages, params.elapsedHours, params.loanPackage);
  if (!tier) {
    return { interest: new Decimal(0), tier: null, ratePct: new Decimal(0) };
  }
  const ratePct = new Decimal(tier.interestRateApr.toString());
  const interest = termInterestTotal(new Decimal(params.principal.toString()), ratePct);
  return { interest, tier, ratePct };
}

/**
 * Outstanding = principalOwed + package interest.
 *
 * From funding through the end of the selected package duration, the borrower
 * owes the **full selected package** interest (principal × package rate%).
 * Interest is on the books from day one — not 0 until some hourly tick.
 *
 * Early repayment only: if repaid before the package ends, interest may be
 * reduced to the package tier that matches time actually used (shorter band).
 */
export function computeLoanOutstanding(
  loan: {
    amount: Decimal | { toString(): string };
    principalOwed: Decimal | { toString(): string };
    interestOwed: Decimal | { toString(): string };
    interestRateApr: Decimal | { toString(): string };
    disbursedAt?: Date | null;
    package?: { id: string; name: string; durationHours: number; interestRateApr: Decimal | { toString(): string } } | null;
  },
  packages: PackageTier[],
  now = new Date(),
  opts?: { earlyRepay?: boolean },
) {
  const principalDue = new Decimal(loan.principalOwed.toString()).toDecimalPlaces(2);
  const storedInterest = new Decimal(loan.interestOwed.toString()).toDecimalPlaces(2);

  const loanPackage: PackageTier | null = loan.package
    ? {
        id: loan.package.id,
        name: loan.package.name,
        durationHours: loan.package.durationHours,
        interestRateApr: loan.package.interestRateApr,
      }
    : loan.interestRateApr != null
      ? {
          id: "loan",
          name: "Loan package",
          durationHours: 24 * 365,
          interestRateApr: loan.interestRateApr,
        }
      : null;

  // Interest is always based on **remaining principal** (principalOwed), not the
  // original loan amount. After partial repayment, interest shrinks with principal.
  const principalBase = principalDue.greaterThan(0) ? principalDue : new Decimal(0);

  const fullPackageInterest =
    loanPackage && principalBase.greaterThan(0)
      ? termInterestTotal(
          principalBase,
          new Decimal(loanPackage.interestRateApr.toString()),
        ).toDecimalPlaces(2)
      : new Decimal(0);

  let interestDue = fullPackageInterest;
  let matchedTier: PackageTier | null = loanPackage;
  let ratePct = loanPackage
    ? new Decimal(loanPackage.interestRateApr.toString())
    : new Decimal(0);

  // Early repay path only: charge the tier that matches time used (may be lower).
  if (opts?.earlyRepay && loan.disbursedAt && loanPackage && principalBase.greaterThan(0)) {
    const elapsedHours = Math.max(
      0,
      (now.getTime() - new Date(loan.disbursedAt).getTime()) / (60 * 60 * 1000),
    );
    if (elapsedHours < loanPackage.durationHours) {
      const result = interestForPackageTier({
        principal: principalBase,
        packages,
        elapsedHours,
        loanPackage,
      });
      // Never charge more than the selected package rate on remaining principal.
      interestDue = Decimal.min(result.interest, fullPackageInterest).toDecimalPlaces(2);
      matchedTier = result.tier;
      ratePct = result.ratePct;
    }
  }

  if (principalBase.lessThanOrEqualTo(0)) {
    interestDue = new Decimal(0);
  }

  return {
    principalDue,
    interestDue,
    totalDue: principalDue.plus(interestDue).toDecimalPlaces(2),
    interestChanged: !interestDue.eq(storedInterest),
    matchedTier,
    matchedRatePct: ratePct,
  };
}

export async function createLoanRequest(params: {
  borrowerId: string;
  amount: number;
  purpose?: string;
  guarantorUsernames: string[];
  packageId: string;
}) {
  const settings = await getAdminSettings();
  const amount = new Decimal(params.amount);

  const pkg = await prisma.loanPackage.findFirst({
    where: { id: params.packageId, active: true },
  });
  if (!pkg) throw new AppError("Selected loan package is not available.", 422);

  if (params.guarantorUsernames.includes("")) throw new AppError("Invalid guarantor list.");
  if (new Set(params.guarantorUsernames).size !== params.guarantorUsernames.length) {
    throw new AppError("Guarantors must be distinct users.");
  }
  if (params.guarantorUsernames.length !== settings.guarantorsRequired) {
    throw new AppError(`Exactly ${settings.guarantorsRequired} guarantors are required.`);
  }

  const guarantors = await prisma.user.findMany({
    where: { username: { in: params.guarantorUsernames } },
    include: { account: true },
  });
  if (guarantors.length !== params.guarantorUsernames.length) {
    throw new AppError("One or more guarantors could not be found.");
  }
  if (guarantors.some((g) => g.id === params.borrowerId)) {
    throw new AppError("You can't guarantee your own loan.");
  }

  const threshold = amount.mul(1 + Number(settings.guarantorCoverageExtraPct) / 100);
  const combined = guarantors.reduce(
    (sum, g) => sum.plus(g.account?.principalBalance ?? 0),
    new Decimal(0),
  );
  if (combined.lessThan(threshold)) {
    throw new AppError(
      `Combined guarantor balance (${combined.toFixed(2)}) is below the required ${threshold.toFixed(2)} (${100 + Number(settings.guarantorCoverageExtraPct)}% of the loan).`,
      422,
    );
  }

  const holdEach = threshold.div(guarantors.length).toDecimalPlaces(2);

  for (const g of guarantors) {
    const bal = g.account?.principalBalance ?? new Decimal(0);
    if (bal.lessThan(holdEach)) {
      throw new AppError(
        `@${g.username} does not have enough principal to cover their share (${holdEach.toFixed(2)}).`,
        422,
      );
    }
  }

  const borrower = await prisma.user.findUnique({
    where: { id: params.borrowerId },
    select: { username: true },
  });

  const loan = await prisma.loan.create({
    data: {
      borrowerId: params.borrowerId,
      amount,
      purpose: params.purpose,
      interestRateApr: pkg.interestRateApr,
      status: "PENDING_GUARANTORS",
      packageId: pkg.id,
      guarantors: {
        create: guarantors.map((g) => ({
          userId: g.id,
          balanceAtPledge: holdEach,
          status: "PENDING",
        })),
      },
    },
    include: {
      guarantors: { include: { user: { select: { username: true } } } },
      package: true,
    },
  });

  await notifications.notifyMany(
    guarantors.map((g) => ({
      userId: g.id,
      type: "GUARANTOR_INVITE",
      title: "Guarantee request",
      body: `@${borrower?.username ?? "Someone"} asked you to guarantee a loan of ${amount.toFixed(2)}. Open Loans → To guarantee to respond.`,
      meta: { loanId: loan.id, amount: amount.toFixed(2) },
    })),
  );

  return loan;
}

export async function respondAsGuarantor(params: {
  loanId: string;
  guarantorId: string;
  accept: boolean;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const loan = await tx.loan.findUnique({
      where: { id: params.loanId },
      include: { guarantors: true },
    });
    if (!loan) throw new AppError("Loan not found.", 404);
    if (loan.status !== "PENDING_GUARANTORS") {
      throw new AppError("This loan is no longer waiting for guarantors.", 422);
    }

    const row = loan.guarantors.find((g) => g.userId === params.guarantorId);
    if (!row) throw new AppError("You are not a guarantor on this loan.", 403);
    if (row.status !== "PENDING") {
      throw new AppError("You already responded to this request.", 422);
    }

    if (!params.accept) {
      await tx.loanGuarantor.update({
        where: { id: row.id },
        data: { status: "DECLINED", respondedAt: new Date() },
      });
      await tx.loan.update({
        where: { id: loan.id },
        data: { status: "CANCELLED" },
      });
      return { loanId: loan.id, status: "CANCELLED" as const };
    }

    const account = await tx.investmentAccount.findUnique({
      where: { userId: params.guarantorId },
    });
    if (!account) throw new AppError("Account not found.", 404);

    const otherHolds = await tx.loanGuarantor.findMany({
      where: {
        userId: params.guarantorId,
        status: "ACCEPTED",
        loan: { status: { in: ["PENDING_GUARANTORS", "OPEN", "REPAYING"] } },
      },
    });
    const held = otherHolds.reduce((s, r) => s.plus(r.balanceAtPledge), new Decimal(0));
    const available = account.principalBalance.minus(held);
    if (available.lessThan(row.balanceAtPledge)) {
      throw new AppError(
        `You need ${row.balanceAtPledge.toFixed(2)} free principal to guarantee this loan (after other holds).`,
        422,
      );
    }

    await tx.loanGuarantor.update({
      where: { id: row.id },
      data: { status: "ACCEPTED", respondedAt: new Date() },
    });

    const pendingLeft = await tx.loanGuarantor.count({
      where: { loanId: loan.id, status: "PENDING" },
    });

    if (pendingLeft === 0) {
      let windowMinutes = 4320;
      if (loan.packageId) {
        const pkg = await tx.loanPackage.findUnique({ where: { id: loan.packageId } });
        if (pkg && typeof (pkg as { fundingWindowMinutes?: number }).fundingWindowMinutes === "number") {
          windowMinutes = Math.max(1, (pkg as { fundingWindowMinutes: number }).fundingWindowMinutes);
        }
      }
      const now = new Date();
      const closes = new Date(now.getTime() + windowMinutes * 60 * 1000);
      await tx.loan.update({
        where: { id: loan.id },
        data: {
          status: "OPEN",
          fundingOpensAt: now,
          fundingClosesAt: closes,
        },
      });
      return { loanId: loan.id, status: "OPEN" as const };
    }

    return { loanId: loan.id, status: "PENDING_GUARANTORS" as const };
  });

  try {
    const loan = await prisma.loan.findUnique({
      where: { id: result.loanId },
      include: { borrower: { select: { id: true, username: true } } },
    });
    const guarantor = await prisma.user.findUnique({
      where: { id: params.guarantorId },
      select: { username: true },
    });
    if (loan) {
      if (!params.accept) {
        await notifications.notify({
          userId: loan.borrowerId,
          type: "GUARANTOR_DECLINED",
          title: "Guarantor declined",
          body: `@${guarantor?.username ?? "A guarantor"} declined. Your loan request was cancelled.`,
          meta: { loanId: loan.id },
        });
      } else if (result.status === "OPEN") {
        await notifications.notify({
          userId: loan.borrowerId,
          type: "LOAN_OPEN",
          title: "Loan open for funding",
          body: "All guarantors accepted. Your loan is now open on the marketplace.",
          meta: { loanId: loan.id },
        });
      } else {
        await notifications.notify({
          userId: loan.borrowerId,
          type: "GUARANTOR_ACCEPTED",
          title: "Guarantor accepted",
          body: `@${guarantor?.username ?? "A guarantor"} accepted. Waiting on remaining guarantors.`,
          meta: { loanId: loan.id },
        });
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Guarantor response notification failed:", err);
  }

  return result;
}

export async function listPendingGuarantees(guarantorId: string) {
  return prisma.loanGuarantor.findMany({
    where: { userId: guarantorId, status: "PENDING" },
    include: {
      loan: {
        include: {
          borrower: { select: { username: true } },
          package: true,
        },
      },
    },
    orderBy: { pledgedAt: "desc" },
  });
}

export async function fundLoan(params: {
  loanId: string;
  funderId: string;
  amount: number;
  allowClosedWindow?: boolean;
  /** Debit PlatformAccount instead of the funder's investment principal. */
  fromPlatform?: boolean;
}) {
  const amount = new Decimal(params.amount);
  if (!params.fromPlatform) {
    await assertCanDebitPrincipal(params.funderId, amount);
  } else {
    await ensurePlatformAccount();
  }

  const updatedLoan = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Loan" WHERE id = ${params.loanId} FOR UPDATE`;

    const loan = await tx.loan.findUnique({
      where: { id: params.loanId },
      include: { package: true, fundings: true },
    });
    if (!loan) throw new AppError("Loan not found.", 404);
    if (loan.status !== "OPEN") throw new AppError("This loan is not open for funding.", 422);
    const closesAt = (loan as { fundingClosesAt?: Date | null }).fundingClosesAt;
    if (
      !params.allowClosedWindow &&
      closesAt &&
      closesAt.getTime() <= Date.now()
    ) {
      throw new AppError("Funding window has closed for this loan.", 422);
    }
    if (!params.fromPlatform && loan.borrowerId === params.funderId) {
      throw new AppError("You can't fund your own loan.", 422);
    }

    const remaining = loan.amount.minus(loan.fundedAmount);
    if (amount.greaterThan(remaining)) {
      throw new AppError(`Only ${remaining.toFixed(2)} remains to be funded.`, 422);
    }

    if (params.fromPlatform) {
      await debitPlatform(tx as any, amount);
    } else {
      const funderAccount = await tx.investmentAccount.findUniqueOrThrow({
        where: { userId: params.funderId },
      });
      if (funderAccount.principalBalance.lessThan(amount)) {
        throw new AppError("Insufficient principal balance.", 422);
      }

      await tx.investmentAccount.update({
        where: { userId: params.funderId },
        data: { principalBalance: { decrement: amount } },
      });
      const afterFunder = await tx.investmentAccount.findUniqueOrThrow({
        where: { userId: params.funderId },
      });
      await tx.transaction.create({
        data: {
          userId: params.funderId,
          type: "LOAN_FUND",
          amount,
          balanceAfter: afterFunder.principalBalance.plus(afterFunder.interestBalance),
          referenceId: loan.id,
          note: `Funded loan ${loan.id}`,
        },
      });
    }

    await tx.loanFunding.create({
      data: { loanId: loan.id, funderId: params.funderId, amount },
    });

    const newFunded = loan.fundedAmount.plus(amount);
    const fullyFunded = newFunded.greaterThanOrEqualTo(loan.amount);

    let dueAt: Date | null = loan.dueAt;
    if (fullyFunded && loan.package) {
      dueAt = new Date(Date.now() + loan.package.durationHours * 60 * 60 * 1000);
    }

    let initialInterest: Decimal | undefined;
    if (fullyFunded) {
      // Full selected-package interest from funding through package end.
      const rate = loan.package?.interestRateApr ?? loan.interestRateApr;
      initialInterest = termInterestTotal(
        new Decimal(loan.amount.toString()),
        new Decimal(rate.toString()),
      );
    }

    const updatedLoan = await tx.loan.update({
      where: { id: loan.id },
      data: {
        fundedAmount: newFunded,
        status: fullyFunded ? "REPAYING" : "OPEN",
        principalOwed: fullyFunded ? loan.amount : loan.principalOwed,
        interestOwed: fullyFunded && initialInterest ? initialInterest : undefined,
        lastAccrualAt: fullyFunded ? new Date() : loan.lastAccrualAt,
        disbursedAt: fullyFunded ? new Date() : loan.disbursedAt,
        dueAt: fullyFunded ? dueAt : loan.dueAt,
      },
      include: { package: true },
    });

    if (fullyFunded) {
      const borrowerAccount = await tx.investmentAccount.findUniqueOrThrow({
        where: { userId: loan.borrowerId },
      });
      await tx.investmentAccount.update({
        where: { userId: loan.borrowerId },
        data: { principalBalance: { increment: loan.amount } },
      });
      await tx.transaction.create({
        data: {
          userId: loan.borrowerId,
          type: "LOAN_DISBURSEMENT",
          amount: loan.amount,
          balanceAfter: borrowerAccount.principalBalance
            .plus(loan.amount)
            .plus(borrowerAccount.interestBalance),
          referenceId: loan.id,
          note: "Loan disbursed",
        },
      });
    }

    return updatedLoan;
  });

  try {
    const funder = await prisma.user.findUnique({
      where: { id: params.funderId },
      select: { username: true },
    });
    const fullyFunded = updatedLoan.status === "REPAYING";
    const who = params.fromPlatform
      ? "the platform"
      : `@${funder?.username ?? "A funder"}`;
    await notifications.notify({
      userId: updatedLoan.borrowerId,
      type: fullyFunded ? "LOAN_FUNDED" : "LOAN_FUND_PARTIAL",
      title: fullyFunded ? "Loan fully funded" : "Loan received funding",
      body: fullyFunded
        ? `${who} completed funding. Funds were disbursed to your account.`
        : `${who} funded ${params.amount}. Still open for more funding.`,
      meta: {
        loanId: updatedLoan.id,
        amount: params.amount,
        status: updatedLoan.status,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Fund notification failed:", err);
  }

  return updatedLoan;
}

export async function repayLoan(params: { loanId: string; borrowerId: string; amount: number }) {
  const amount = new Decimal(Number(params.amount)).toDecimalPlaces(2);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Loan" WHERE id = ${params.loanId} FOR UPDATE`;

    const loan = await tx.loan.findUnique({
      where: { id: params.loanId },
      include: { fundings: true, package: true },
    });
    if (!loan) throw new AppError("Loan not found.", 404);
    if (loan.borrowerId !== params.borrowerId) throw new AppError("This isn't your loan.", 403);
    if (loan.status !== "REPAYING") throw new AppError("This loan isn't awaiting repayment.", 422);

    const packages = await tx.loanPackage.findMany({ orderBy: { durationHours: "asc" } });
    const due = computeLoanOutstanding(loan, packages, new Date(), { earlyRepay: true });
    const interestOwed = due.interestDue;

    const pending = await tx.loanRepayment.findMany({
      where: { loanId: loan.id, status: "PENDING" },
      select: { id: true, amount: true },
    });
    if (pending.length > 0) {
      throw new AppError(
        "A repayment is already awaiting approval on this loan. Wait for it to be reviewed before submitting another.",
        422,
      );
    }

    const outstanding = due.totalDue;
    if (outstanding.lessThanOrEqualTo(0)) {
      throw new AppError("This loan has no outstanding balance.", 422);
    }

    let payAmount = amount.toDecimalPlaces(2);
    if (payAmount.greaterThan(outstanding)) {
      if (payAmount.minus(outstanding).lessThanOrEqualTo(0.05)) {
        payAmount = outstanding;
      } else {
        throw new AppError(
          `Total amount due is ${outstanding.toFixed(2)} (principal ${due.principalDue.toFixed(2)} + interest ${due.interestDue.toFixed(2)}).`,
          422,
        );
      }
    } else if (outstanding.minus(payAmount).lessThanOrEqualTo(0.05) && payAmount.greaterThan(0)) {
      payAmount = outstanding;
    }

    // Repay from principal first, then interest balance. Holds only block withdraw/fund.
    const account = await tx.investmentAccount.findUniqueOrThrow({
      where: { userId: params.borrowerId },
    });
    const available = account.principalBalance.plus(account.interestBalance);
    if (available.lessThan(payAmount)) {
      // Allow clearing within 1.00 of available so dust does not block full repay.
      if (payAmount.minus(available).lessThanOrEqualTo(1) && available.greaterThan(0)) {
        payAmount = available.toDecimalPlaces(2);
      } else {
        throw new AppError(
          `Insufficient balance. You have ${available.toFixed(2)} (principal ${account.principalBalance.toFixed(2)} + interest ${account.interestBalance.toFixed(2)}); this repayment needs ${payAmount.toFixed(2)}.`,
          422,
        );
      }
    }

    let fromPrincipal = Decimal.min(payAmount, account.principalBalance);
    let fromInterest = payAmount.minus(fromPrincipal);
    await tx.investmentAccount.update({
      where: { userId: params.borrowerId },
      data: {
        principalBalance: { decrement: fromPrincipal },
        interestBalance: fromInterest.greaterThan(0) ? { decrement: fromInterest } : undefined,
      },
    });
    const after = await tx.investmentAccount.findUniqueOrThrow({
      where: { userId: params.borrowerId },
    });
    await tx.transaction.create({
      data: {
        userId: params.borrowerId,
        type: "LOAN_REPAYMENT",
        amount: payAmount,
        balanceAfter: after.principalBalance.plus(after.interestBalance),
        referenceId: loan.id,
        note: "Loan repayment (awaiting approval)",
      },
    });

    // Sync interest to the matched package tier before snapshotting repayment.
    if (due.interestChanged) {
      await tx.loan.update({
        where: { id: loan.id },
        data: { interestOwed },
      });
    }

    const repayment = await tx.loanRepayment.create({
      data: {
        loanId: loan.id,
        amount: payAmount,
        status: "PENDING",
        principalOwedBefore: loan.principalOwed,
        interestOwedBefore: interestOwed,
      },
    });

    return repayment;
  });
}

export async function approveRepayment(params: { repaymentId: string; adminId: string }) {
  const settings = await getAdminSettings();
  const sharePct = Number(settings.platformInterestSharePct ?? 10) / 100;

  const repayment = await prisma.$transaction(async (tx) => {
    const repayment = await tx.loanRepayment.findUnique({
      where: { id: params.repaymentId },
      include: {
        loan: { include: { fundings: true } },
      },
    });
    if (!repayment) throw new AppError("Repayment not found.", 404);
    if (repayment.status !== "PENDING") {
      throw new AppError("This repayment has already been reviewed.", 422);
    }

    const interestPart = Decimal.min(repayment.amount, repayment.interestOwedBefore);
    const principalPart = repayment.amount.minus(interestPart);

    const totalFunded = repayment.loan.fundings.reduce(
      (s, f) => s.plus(f.amount),
      new Decimal(0),
    );
    const denom = totalFunded.greaterThan(0) ? totalFunded : repayment.loan.amount;

    const platformUserId = await getPlatformUserId();
    let platformFees = new Decimal(0);

    for (const f of repayment.loan.fundings) {
      const weight = f.amount.div(denom);
      const dPrincipal = principalPart.mul(weight).toDecimalPlaces(2);
      const dInterest = interestPart.mul(weight).toDecimalPlaces(2);
      const fee = dInterest.mul(sharePct).toDecimalPlaces(2);
      const credit = dPrincipal.plus(dInterest).minus(fee);
      platformFees = platformFees.plus(fee);

      if (credit.greaterThan(0)) {
        if (f.funderId === platformUserId) {
          // Platform residual funding returns to the treasury, not the system user wallet.
          await creditPlatformTx(tx, credit);
        } else {
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
              referenceId: repayment.loanId,
              note: `Return from loan ${repayment.loanId} (platform fee on interest ${fee.toFixed(2)})`,
            },
          });
        }

        await tx.loanRepaymentDistribution.create({
          data: {
            repaymentId: repayment.id,
            funderId: f.funderId,
            amount: credit,
          },
        });
      }
    }

    // Interest share always accrues to platform treasury.
    if (platformFees.greaterThan(0)) {
      await creditPlatformTx(tx, platformFees);
    }

    const loan = repayment.loan;
    // Owed was not reduced at repay-submit time — reduce principal now on approval.
    const newPrincipal = Decimal.max(
      0,
      loan.principalOwed.minus(principalPart),
    ).toDecimalPlaces(2);

    // Interest on whatever principal remains (package / early-tier), not leftover of original fee.
    let newInterest = new Decimal(0);
    if (newPrincipal.greaterThan(0)) {
      const packages = await tx.loanPackage.findMany({ orderBy: { durationHours: "asc" } });
      const loanFull = await tx.loan.findUnique({
        where: { id: loan.id },
        include: { package: true },
      });
      const due = computeLoanOutstanding(
        {
          amount: loanFull!.amount,
          principalOwed: newPrincipal,
          interestOwed: new Decimal(0),
          interestRateApr: loanFull!.interestRateApr,
          disbursedAt: loanFull!.disbursedAt,
          package: loanFull!.package,
        },
        packages,
        new Date(),
        { earlyRepay: true },
      );
      newInterest = due.interestDue;
    }

    const fullyRepaid =
      newPrincipal.lessThanOrEqualTo(0) && newInterest.lessThanOrEqualTo(0);

    await tx.loan.update({
      where: { id: loan.id },
      data: {
        principalOwed: newPrincipal,
        interestOwed: newInterest,
        status: fullyRepaid ? "REPAID" : "REPAYING",
      },
    });

    return tx.loanRepayment.update({
      where: { id: repayment.id },
      data: { status: "APPROVED", reviewedAt: new Date(), reviewedById: params.adminId },
    });
  });

  try {
    const full = await prisma.loanRepayment.findUnique({
      where: { id: repayment.id },
      include: {
        loan: {
          include: {
            borrower: { select: { id: true, username: true } },
            fundings: { select: { funderId: true } },
          },
        },
      },
    });
    if (full?.loan) {
      const inputs: Parameters<typeof notifications.notifyMany>[0] = [
        {
          userId: full.loan.borrowerId,
          type: "REPAYMENT_APPROVED",
          title: "Repayment approved",
          body: `Your repayment of ${full.amount} was approved and distributed to funders.`,
          meta: { loanId: full.loanId, repaymentId: full.id },
        },
      ];
      const platformId = await getPlatformUserId();
      for (const f of full.loan.fundings) {
        if (f.funderId === platformId) continue;
        inputs.push({
          userId: f.funderId,
          type: "REPAYMENT_DISTRIBUTED",
          title: "Repayment received",
          body: `A repayment on @${full.loan.borrower.username}'s loan was approved. Check your account for the return.`,
          meta: { loanId: full.loanId, repaymentId: full.id },
        });
      }
      await notifications.notifyMany(inputs);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Approve repayment notification failed:", err);
  }

  return repayment;
}

export async function rejectRepayment(params: { repaymentId: string; adminId: string }) {
  const repayment = await prisma.$transaction(async (tx) => {
    const repayment = await tx.loanRepayment.findUnique({
      where: { id: params.repaymentId },
      include: { loan: true },
    });
    if (!repayment) throw new AppError("Repayment not found.", 404);
    if (repayment.status !== "PENDING") {
      throw new AppError("This repayment has already been reviewed.", 422);
    }

    await tx.loan.update({
      where: { id: repayment.loanId },
      data: {
        principalOwed: repayment.principalOwedBefore,
        interestOwed: repayment.interestOwedBefore,
        status: "REPAYING",
      },
    });

    const borrowerAccount = await tx.investmentAccount.findUniqueOrThrow({
      where: { userId: repayment.loan.borrowerId },
    });
    await tx.investmentAccount.update({
      where: { userId: repayment.loan.borrowerId },
      data: { principalBalance: { increment: repayment.amount } },
    });
    await tx.transaction.create({
      data: {
        userId: repayment.loan.borrowerId,
        type: "ADJUSTMENT",
        amount: repayment.amount,
        balanceAfter: borrowerAccount.principalBalance
          .plus(repayment.amount)
          .plus(borrowerAccount.interestBalance),
        referenceId: repayment.loanId,
        note: "Repayment rejected — refunded",
      },
    });

    return tx.loanRepayment.update({
      where: { id: repayment.id },
      data: { status: "REJECTED", reviewedAt: new Date(), reviewedById: params.adminId },
    });
  });

  try {
    const full = await prisma.loanRepayment.findUnique({
      where: { id: repayment.id },
      include: { loan: true },
    });
    if (full?.loan) {
      await notifications.notify({
        userId: full.loan.borrowerId,
        type: "REPAYMENT_REJECTED",
        title: "Repayment not approved",
        body: `Your repayment of ${full.amount} was not approved and was refunded to your principal.`,
        meta: { loanId: full.loanId, repaymentId: full.id },
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Reject repayment notification failed:", err);
  }

  return repayment;
}