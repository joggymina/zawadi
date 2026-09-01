import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { getAdminSettings } from "./adminSettings.service";
import { assertCanDebitPrincipal } from "./guarantorHold.service";
import { Decimal } from "@prisma/client/runtime/library";

const DAY_MS = 86_400_000;

function elapsedDays(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / DAY_MS);
}

function simpleInterest(principal: Decimal, aprPct: Decimal | number, days: number): Decimal {
  if (days <= 0) return new Decimal(0);
  const p = Number(principal);
  if (p <= 0) return new Decimal(0);
  const r = Number(aprPct) / 100;
  return new Decimal((p * r * (days / 365)).toFixed(2));
}

async function matchingPackageRate(elapsedHours: number): Promise<Decimal | null> {
  const packages = await prisma.loanPackage.findMany({ orderBy: { durationHours: "asc" } });
  if (packages.length === 0) return null;
  const match =
    packages.find((p) => p.durationHours >= elapsedHours) ?? packages[packages.length - 1];
  return match.interestRateApr;
}

async function applyEarlyRepayInterestCap(params: {
  principal: Decimal;
  interestOwed: Decimal;
  disbursedAt: Date | null;
  now: Date;
}) {
  if (!params.disbursedAt) {
    return { interestOwed: params.interestOwed, capped: false, matchApr: null as number | null };
  }
  const hours = (params.now.getTime() - params.disbursedAt.getTime()) / (60 * 60 * 1000);
  const days = elapsedDays(params.disbursedAt, params.now);
  const matchApr = await matchingPackageRate(hours);
  if (matchApr === null) {
    return { interestOwed: params.interestOwed, capped: false, matchApr: null };
  }
  const maxInterest = simpleInterest(params.principal, matchApr, days);
  if (params.interestOwed.greaterThan(maxInterest)) {
    return {
      interestOwed: maxInterest,
      capped: true,
      matchApr: Number(matchApr),
    };
  }
  return {
    interestOwed: params.interestOwed,
    capped: false,
    matchApr: Number(matchApr),
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

  // Required coverage = loan × (1 + buffer%)
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

  // Equal share of coverage — this is the locked amount, not full principal
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

  return prisma.loan.create({
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
}

export async function respondAsGuarantor(params: {
  loanId: string;
  guarantorId: string;
  accept: boolean;
}) {
  return prisma.$transaction(async (tx) => {
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

    const updated = await tx.loanGuarantor.findMany({ where: { loanId: loan.id } });
    const allAccepted = updated.every((g) => g.status === "ACCEPTED");
    if (allAccepted) {
      await tx.loan.update({ where: { id: loan.id }, data: { status: "OPEN" } });
      return { loanId: loan.id, status: "OPEN" as const };
    }
    return { loanId: loan.id, status: "PENDING_GUARANTORS" as const };
  });
}

export async function listPendingGuarantees(guarantorId: string) {
  return prisma.loanGuarantor.findMany({
    where: {
      userId: guarantorId,
      status: "PENDING",
      loan: { status: "PENDING_GUARANTORS" },
    },
    include: {
      loan: {
        include: {
          package: true,
          borrower: { select: { username: true } },
          guarantors: { include: { user: { select: { username: true } } } },
        },
      },
    },
    orderBy: { loan: { createdAt: "desc" } },
  });
}

export async function fundLoan(params: { loanId: string; funderId: string; amount: number }) {
  const amount = new Decimal(params.amount);
  await assertCanDebitPrincipal(params.funderId, amount);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Loan" WHERE id = ${params.loanId} FOR UPDATE`;

    const loan = await tx.loan.findUnique({
      where: { id: params.loanId },
      include: { package: true },
    });
    if (!loan) throw new AppError("Loan not found.", 404);
    if (loan.status !== "OPEN") throw new AppError("This loan is not open for funding.", 422);
    if (loan.borrowerId === params.funderId) {
      throw new AppError("You can't fund your own loan.", 422);
    }

    const remaining = loan.amount.minus(loan.fundedAmount);
    if (amount.greaterThan(remaining)) {
      throw new AppError(`Only ${remaining.toFixed(2)} remains to be funded.`, 422);
    }

    const funderAccount = await tx.investmentAccount.findUnique({
      where: { userId: params.funderId },
    });
    if (!funderAccount) throw new AppError("Account not found.", 404);
    if (amount.greaterThan(funderAccount.principalBalance)) {
      throw new AppError("Insufficient investment principal.", 422);
    }

    await tx.investmentAccount.update({
      where: { userId: params.funderId },
      data: { principalBalance: { decrement: amount } },
    });
    await tx.transaction.create({
      data: {
        userId: params.funderId,
        type: "LOAN_FUND",
        amount,
        balanceAfter: funderAccount.principalBalance.minus(amount).plus(funderAccount.interestBalance),
        referenceId: loan.id,
        note: `Funded loan ${loan.id}`,
      },
    });
    await tx.loanFunding.create({
      data: { loanId: loan.id, funderId: params.funderId, amount },
    });

    const newFundedAmount = loan.fundedAmount.plus(amount);
    const fullyFunded = newFundedAmount.greaterThanOrEqualTo(loan.amount);
    let dueAt: Date | null = loan.dueAt;
    if (fullyFunded && loan.package) {
      dueAt = new Date(Date.now() + loan.package.durationHours * 60 * 60 * 1000);
    }

    const updatedLoan = await tx.loan.update({
      where: { id: loan.id },
      data: {
        fundedAmount: newFundedAmount,
        status: fullyFunded ? "REPAYING" : "OPEN",
        principalOwed: fullyFunded ? loan.amount : loan.principalOwed,
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
}

export async function repayLoan(params: { loanId: string; borrowerId: string; amount: number }) {
  const amount = new Decimal(params.amount);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Loan" WHERE id = ${params.loanId} FOR UPDATE`;

    const loan = await tx.loan.findUnique({
      where: { id: params.loanId },
      include: { fundings: true },
    });
    if (!loan) throw new AppError("Loan not found.", 404);
    if (loan.borrowerId !== params.borrowerId) throw new AppError("This isn't your loan.", 403);
    if (loan.status !== "REPAYING") throw new AppError("This loan isn't awaiting repayment.", 422);

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

    const cap = await applyEarlyRepayInterestCap({
      principal: loan.amount,
      interestOwed,
      disbursedAt: loan.disbursedAt,
      now,
    });
    interestOwed = cap.interestOwed;

    const outstanding = loan.principalOwed.plus(interestOwed);
    if (amount.greaterThan(outstanding.plus(0.01))) {
      throw new AppError(`Outstanding balance is only ${outstanding.toFixed(2)}.`, 422);
    }

    const borrowerAccount = await tx.investmentAccount.findUniqueOrThrow({
      where: { userId: params.borrowerId },
    });
    if (amount.greaterThan(borrowerAccount.principalBalance.plus(borrowerAccount.interestBalance))) {
      throw new AppError("Insufficient balance for this repayment.", 422);
    }

    let remaining = amount;
    const interestPaid = Decimal.min(remaining, interestOwed);
    remaining = remaining.minus(interestPaid);
    const principalPaid = Decimal.min(remaining, loan.principalOwed);
    const newInterestOwed = interestOwed.minus(interestPaid);
    const newPrincipalOwed = loan.principalOwed.minus(principalPaid);
    const fullyRepaid =
      newPrincipalOwed.lessThanOrEqualTo(0.01) && newInterestOwed.lessThanOrEqualTo(0.01);

    const totalFunded = loan.fundings.reduce((s, f) => s.plus(f.amount), new Decimal(0));
    const denominator = totalFunded.greaterThan(0) ? totalFunded : loan.amount;

    await tx.investmentAccount.update({
      where: { userId: params.borrowerId },
      data: { principalBalance: { decrement: amount } },
    });

    const noteParts = ["Loan repayment (awaiting approval)"];
    if (cap.capped && cap.matchApr != null) {
      noteParts.push(
        `interest capped at ${cap.matchApr.toFixed(2)}% p.a. for time held (early-repay policy)`,
      );
    }

    await tx.transaction.create({
      data: {
        userId: params.borrowerId,
        type: "LOAN_REPAYMENT",
        amount,
        balanceAfter: borrowerAccount.principalBalance
          .minus(amount)
          .plus(borrowerAccount.interestBalance),
        referenceId: loan.id,
        note: noteParts.join(" — "),
      },
    });

    const repayment = await tx.loanRepayment.create({
      data: {
        loanId: loan.id,
        amount,
        principalOwedBefore: loan.principalOwed,
        interestOwedBefore: interestOwed,
        distributions: {
          create: loan.fundings.map((f) => ({
            funderId: f.funderId,
            amount: amount.mul(f.amount).div(denominator),
          })),
        },
      },
      include: { distributions: true },
    });

    await tx.loan.update({
      where: { id: loan.id },
      data: {
        principalOwed: newPrincipalOwed.lessThan(0) ? new Decimal(0) : newPrincipalOwed,
        interestOwed: newInterestOwed.lessThan(0) ? new Decimal(0) : newInterestOwed,
        lastAccrualAt: lastAccrualAt ?? loan.lastAccrualAt,
        status: fullyRepaid ? "REPAID" : "REPAYING",
      },
    });

    return repayment;
  });
}

export async function approveRepayment(params: { repaymentId: string; adminId: string }) {
  return prisma.$transaction(async (tx) => {
    const repayment = await tx.loanRepayment.findUnique({
      where: { id: params.repaymentId },
      include: { distributions: true, loan: true },
    });
    if (!repayment) throw new AppError("Repayment not found.", 404);
    if (repayment.status !== "PENDING") {
      throw new AppError("This repayment has already been reviewed.", 422);
    }

    for (const d of repayment.distributions) {
      const funderAccount = await tx.investmentAccount.findUniqueOrThrow({
        where: { userId: d.funderId },
      });
      await tx.investmentAccount.update({
        where: { userId: d.funderId },
        data: { principalBalance: { increment: d.amount } },
      });
      await tx.transaction.create({
        data: {
          userId: d.funderId,
          type: "LOAN_RETURN",
          amount: d.amount,
          balanceAfter: funderAccount.principalBalance.plus(d.amount).plus(funderAccount.interestBalance),
          referenceId: repayment.loanId,
          note: `Return from loan ${repayment.loanId}`,
        },
      });
    }

    return tx.loanRepayment.update({
      where: { id: repayment.id },
      data: { status: "APPROVED", reviewedAt: new Date(), reviewedById: params.adminId },
    });
  });
}

export async function rejectRepayment(params: { repaymentId: string; adminId: string }) {
  return prisma.$transaction(async (tx) => {
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
}