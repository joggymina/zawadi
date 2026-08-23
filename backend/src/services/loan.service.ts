import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { getAdminSettings } from "./adminSettings.service";
import { Decimal } from "@prisma/client/runtime/library";

/**
 * Create a loan request. The borrower's chosen guarantors' investment
 * principal must, combined, cover the loan amount plus the admin's
 * configured buffer (default: 105%). We snapshot each guarantor's balance
 * at pledge time so a later withdrawal doesn't retroactively invalidate
 * an already-published loan.
 */
export async function createLoanRequest(params: {
  borrowerId: string;
  amount: number;
  purpose?: string;
  guarantorUsernames: string[];
}) {
  const settings = await getAdminSettings();
  const amount = new Decimal(params.amount);

  if (params.guarantorUsernames.includes(""))
    throw new AppError("Invalid guarantor list.");
  if (new Set(params.guarantorUsernames).size !== params.guarantorUsernames.length)
    throw new AppError("Guarantors must be distinct users.");
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
    (sum, g) => sum.plus(g.account?.principalBalance ?? new Decimal(0)),
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
      guarantors: {
        create: guarantors.map((g) => ({
          userId: g.id,
          balanceAtPledge: g.account?.principalBalance ?? new Decimal(0),
        })),
      },
    },
    include: { guarantors: true },
  });
}

/**
 * Fund an open loan. When the loan becomes fully funded, it transitions
 * to REPAYING and the full amount is disbursed to the borrower in the
 * same DB transaction as the funder's debit — both happen or neither does.
 */
export async function fundLoan(params: { loanId: string; funderId: string; amount: number }) {
  const amount = new Decimal(params.amount);

  return prisma.$transaction(async (tx) => {
    const loan = await tx.loan.findUnique({ where: { id: params.loanId } });
    if (!loan) throw new AppError("Loan not found.", 404);
    if (loan.status !== "OPEN") throw new AppError("This loan is no longer open for funding.", 422);
    if (loan.borrowerId === params.funderId) throw new AppError("You can't fund your own loan.", 422);

    const remaining = loan.amount.minus(loan.fundedAmount);
    if (amount.greaterThan(remaining)) {
      throw new AppError(`Only ${remaining.toFixed(2)} is still needed for this loan.`, 422);
    }

    const funderAccount = await tx.investmentAccount.findUnique({ where: { userId: params.funderId } });
    if (!funderAccount || amount.greaterThan(funderAccount.principalBalance)) {
      throw new AppError("That's more than your available investment balance.", 422);
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

    await tx.loanFunding.create({ data: { loanId: loan.id, funderId: params.funderId, amount } });

    const newFundedAmount = loan.fundedAmount.plus(amount);
    const fullyFunded = newFundedAmount.greaterThanOrEqualTo(loan.amount);

    const updatedLoan = await tx.loan.update({
      where: { id: loan.id },
      data: {
        fundedAmount: newFundedAmount,
        status: fullyFunded ? "REPAYING" : "OPEN",
        principalOwed: fullyFunded ? loan.amount : loan.principalOwed,
        lastAccrualAt: fullyFunded ? new Date() : loan.lastAccrualAt,
        disbursedAt: fullyFunded ? new Date() : loan.disbursedAt,
      },
    });

    if (fullyFunded) {
      const borrowerAccount = await tx.investmentAccount.findUniqueOrThrow({ where: { userId: loan.borrowerId } });
      await tx.investmentAccount.update({
        where: { userId: loan.borrowerId },
        data: { principalBalance: { increment: loan.amount } },
      });
      await tx.transaction.create({
        data: {
          userId: loan.borrowerId,
          type: "LOAN_DISBURSEMENT",
          amount: loan.amount,
          balanceAfter: borrowerAccount.principalBalance.plus(loan.amount).plus(borrowerAccount.interestBalance),
          referenceId: loan.id,
          note: "Loan disbursed",
        },
      });
    }

    return updatedLoan;
  });
}

/**
 * Borrower repayment. Their own balance is debited and the loan's
 * outstanding balance is reduced immediately — but the payout to funders
 * is recorded as PENDING and only realized when an admin approves it
 * (see approveRepayment / rejectRepayment below).
 */
export async function repayLoan(params: { loanId: string; borrowerId: string; amount: number }) {
  const amount = new Decimal(params.amount);

  return prisma.$transaction(async (tx) => {
    const loan = await tx.loan.findUnique({ where: { id: params.loanId }, include: { fundings: true } });
    if (!loan) throw new AppError("Loan not found.", 404);
    if (loan.borrowerId !== params.borrowerId) throw new AppError("This isn't your loan.", 403);
    if (loan.status !== "REPAYING") throw new AppError("This loan isn't awaiting repayment.", 422);

    const outstanding = loan.principalOwed.plus(loan.interestOwed);
    if (amount.greaterThan(outstanding.plus(0.01))) {
      throw new AppError(`Outstanding balance is only ${outstanding.toFixed(2)}.`, 422);
    }

    const borrowerAccount = await tx.investmentAccount.findUniqueOrThrow({ where: { userId: params.borrowerId } });
    if (amount.greaterThan(borrowerAccount.principalBalance)) {
      throw new AppError("You don't have enough in your own balance to make this repayment.", 422);
    }

    let remaining = amount;
    const interestPaid = Decimal.min(remaining, loan.interestOwed);
    remaining = remaining.minus(interestPaid);
    const principalPaid = Decimal.min(remaining, loan.principalOwed);

    const newInterestOwed = loan.interestOwed.minus(interestPaid);
    const newPrincipalOwed = loan.principalOwed.minus(principalPaid);
    const fullyRepaid = newPrincipalOwed.lessThanOrEqualTo(0.01) && newInterestOwed.lessThanOrEqualTo(0.01);

    const totalFunded = loan.fundings.reduce((s, f) => s.plus(f.amount), new Decimal(0));
    const denominator = totalFunded.greaterThan(0) ? totalFunded : loan.amount;

    await tx.investmentAccount.update({
      where: { userId: params.borrowerId },
      data: { principalBalance: { decrement: amount } },
    });
    await tx.transaction.create({
      data: {
        userId: params.borrowerId,
        type: "LOAN_REPAYMENT",
        amount,
        balanceAfter: borrowerAccount.principalBalance.minus(amount).plus(borrowerAccount.interestBalance),
        referenceId: loan.id,
        note: "Loan repayment (awaiting admin approval before funders are credited)",
      },
    });

    const repayment = await tx.loanRepayment.create({
      data: {
        loanId: loan.id,
        amount,
        principalOwedBefore: loan.principalOwed,
        interestOwedBefore: loan.interestOwed,
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
      data: { principalOwed: newPrincipalOwed, interestOwed: newInterestOwed, status: fullyRepaid ? "REPAID" : "REPAYING" },
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
    if (repayment.status !== "PENDING") throw new AppError("This repayment has already been reviewed.", 422);

    for (const dist of repayment.distributions) {
      const funderAccount = await tx.investmentAccount.findUniqueOrThrow({ where: { userId: dist.funderId } });
      await tx.investmentAccount.update({
        where: { userId: dist.funderId },
        data: { principalBalance: { increment: dist.amount } },
      });
      await tx.transaction.create({
        data: {
          userId: dist.funderId,
          type: "LOAN_RETURN",
          amount: dist.amount,
          balanceAfter: funderAccount.principalBalance.plus(dist.amount).plus(funderAccount.interestBalance),
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
    const repayment = await tx.loanRepayment.findUnique({ where: { id: params.repaymentId }, include: { loan: true } });
    if (!repayment) throw new AppError("Repayment not found.", 404);
    if (repayment.status !== "PENDING") throw new AppError("This repayment has already been reviewed.", 422);

    // Restore the loan's outstanding balance to what it was before this
    // repayment attempt, and refund the borrower.
    await tx.loan.update({
      where: { id: repayment.loanId },
      data: {
        principalOwed: repayment.principalOwedBefore,
        interestOwed: repayment.interestOwedBefore,
        status: "REPAYING",
      },
    });

    const borrowerAccount = await tx.investmentAccount.findUniqueOrThrow({ where: { userId: repayment.loan.borrowerId } });
    await tx.investmentAccount.update({
      where: { userId: repayment.loan.borrowerId },
      data: { principalBalance: { increment: repayment.amount } },
    });
    await tx.transaction.create({
      data: {
        userId: repayment.loan.borrowerId,
        type: "ADJUSTMENT",
        amount: repayment.amount,
        balanceAfter: borrowerAccount.principalBalance.plus(repayment.amount).plus(borrowerAccount.interestBalance),
        referenceId: repayment.loanId,
        note: "Repayment rejected by admin — refunded",
      },
    });

    return tx.loanRepayment.update({
      where: { id: repayment.id },
      data: { status: "REJECTED", reviewedAt: new Date(), reviewedById: params.adminId },
    });
  });
}
