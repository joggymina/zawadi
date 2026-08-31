import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { getAdminSettings } from "./adminSettings.service";
import { Decimal } from "@prisma/client/runtime/library";

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

  if (params.guarantorUsernames.includes("")) {
    throw new AppError("Invalid guarantor list.");
  }
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

  return prisma.loan.create({
    data: {
      borrowerId: params.borrowerId,
      amount,
      purpose: params.purpose,
      interestRateApr: settings.loanAnnualRatePct,
      status: "OPEN",
      packageId: pkg.id,
      guarantors: {
        create: guarantors.map((g) => ({
          userId: g.id,
          balanceAtPledge: g.account?.principalBalance ?? new Decimal(0),
        })),
      },
    },
    include: { guarantors: true, package: true },
  });
}

export async function fundLoan(params: { loanId: string; funderId: string; amount: number }) {
  const amount = new Decimal(params.amount);

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

  return prisma.$transaction(async (tx) => {
    const loan = await tx.loan.findUnique({
      where: { id: params.loanId },
      include: { fundings: true },
    });
    if (!loan) throw new AppError("Loan not found.", 404);
    if (loan.borrowerId !== params.borrowerId) throw new AppError("This isn't your loan.", 403);
    if (loan.status !== "REPAYING") throw new AppError("This loan isn't awaiting repayment.", 422);

    const account = await tx.investmentAccount.findUnique({ where: { userId: params.borrowerId } });
    if (!account) throw new AppError("Account not found.", 404);
    if (amount.greaterThan(account.principalBalance.plus(account.interestBalance))) {
      throw new AppError("Insufficient balance for this repayment.", 422);
    }

    const principalOwedBefore = loan.principalOwed;
    const interestOwedBefore = loan.interestOwed;
    const totalOwed = principalOwedBefore.plus(interestOwedBefore);
    const pay = amount.greaterThan(totalOwed) ? totalOwed : amount;

    let interestPay = pay.greaterThan(interestOwedBefore) ? interestOwedBefore : pay;
    let principalPay = pay.minus(interestPay);

    const newInterest = interestOwedBefore.minus(interestPay);
    const newPrincipal = principalOwedBefore.minus(principalPay);

    await tx.investmentAccount.update({
      where: { userId: params.borrowerId },
      data: { principalBalance: { decrement: pay } },
    });

    const updatedAccount = await tx.investmentAccount.findUniqueOrThrow({
      where: { userId: params.borrowerId },
    });

    await tx.transaction.create({
      data: {
        userId: params.borrowerId,
        type: "LOAN_REPAYMENT",
        amount: pay,
        balanceAfter: updatedAccount.principalBalance.plus(updatedAccount.interestBalance),
        referenceId: loan.id,
        note: "Loan repayment (pending approval)",
      },
    });

    const totalFunded = loan.fundings.reduce((s, f) => s.plus(f.amount), new Decimal(0));
    const distributions = loan.fundings.map((f) => ({
      funderId: f.funderId,
      amount: totalFunded.isZero() ? new Decimal(0) : pay.mul(f.amount).div(totalFunded),
    }));

    const repayment = await tx.loanRepayment.create({
      data: {
        loanId: loan.id,
        amount: pay,
        status: "PENDING",
        principalOwedBefore,
        interestOwedBefore,
        distributions: {
          create: distributions.map((d) => ({
            funderId: d.funderId,
            amount: d.amount,
          })),
        },
      },
      include: { distributions: true },
    });

    const fullyRepaid = newPrincipal.lessThanOrEqualTo(0) && newInterest.lessThanOrEqualTo(0);
    await tx.loan.update({
      where: { id: loan.id },
      data: {
        principalOwed: newPrincipal.lessThan(0) ? new Decimal(0) : newPrincipal,
        interestOwed: newInterest.lessThan(0) ? new Decimal(0) : newInterest,
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
      data: {
        status: "APPROVED",
        reviewedAt: new Date(),
        reviewedById: params.adminId,
      },
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
      data: {
        status: "REJECTED",
        reviewedAt: new Date(),
        reviewedById: params.adminId,
      },
    });
  });
}