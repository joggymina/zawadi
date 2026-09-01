import { LoanStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";
import { AppError } from "../middleware/errorHandler";

const ACTIVE_HOLD: LoanStatus[] = [
  LoanStatus.PENDING_GUARANTORS,
  LoanStatus.OPEN,
  LoanStatus.REPAYING,
];

export async function getGuarantorHeldAmount(userId: string): Promise<Decimal> {
  const rows = await prisma.loanGuarantor.findMany({
    where: {
      userId,
      status: "ACCEPTED",
      loan: { status: { in: ACTIVE_HOLD } },
    },
  });
  return rows.reduce((s, r) => s.plus(r.balanceAtPledge), new Decimal(0));
}

export async function getAvailablePrincipal(userId: string) {
  const account = await prisma.investmentAccount.findUnique({ where: { userId } });
  if (!account) throw new AppError("Account not found.", 404);
  const held = await getGuarantorHeldAmount(userId);
  const available = Decimal.max(account.principalBalance.minus(held), new Decimal(0));
  return {
    principal: account.principalBalance,
    interest: account.interestBalance,
    held,
    available,
  };
}

export async function assertCanDebitPrincipal(userId: string, amount: Decimal) {
  const { available, held } = await getAvailablePrincipal(userId);
  if (amount.greaterThan(available)) {
    throw new AppError(
      `Insufficient available balance. ${available.toFixed(2)} free (${held.toFixed(2)} held as guarantor).`,
      422,
    );
  }
}