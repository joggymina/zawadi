import { prisma } from "../lib/prisma";
import { annualToDaily, compoundInterest, wholeDaysBetween, roundMoney } from "../utils/money";
import { getAdminSettings } from "./adminSettings.service";
import type { InvestmentAccount, Loan } from "@prisma/client";

/**
 * Applies any missed daily interest to a single investment account,
 * bringing lastAccrualAt fully up to date, and returns the refreshed
 * record (or the original, unchanged, if nothing was due).
 *
 * This is the *reliable* path: it's called lazily from every endpoint
 * that reads or acts on an account (getMe, invest, withdraw), not just
 * from the nightly cron. Relying on the cron alone is fragile on
 * container platforms — a redeploy or restart anywhere near the
 * scheduled run silently skips that day's accrual with no catch-up,
 * which is exactly what made interest look "stuck" in production.
 * Calling this on every read means a missed cron run is invisible to
 * the user: the next request just catches up whatever elapsed.
 */
export async function accrueInvestmentAccount(account: InvestmentAccount): Promise<InvestmentAccount> {
  if (account.principalBalance.lessThanOrEqualTo(0)) return account;

  const now = new Date();
  const days = wholeDaysBetween(account.lastAccrualAt, now);
  if (days <= 0) return account;

  const settings = await getAdminSettings();
  const dailyRate = annualToDaily(settings.investAnnualRatePct);
  const gained = compoundInterest(account.principalBalance, dailyRate, days);
  if (gained <= 0) return account;

  const gainedDecimal = roundMoney(gained);
  const newLastAccrual = new Date(account.lastAccrualAt.getTime() + days * 86_400_000);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.investmentAccount.update({
      where: { id: account.id },
      data: { interestBalance: { increment: gainedDecimal }, lastAccrualAt: newLastAccrual },
    });
    await tx.transaction.create({
      data: {
        userId: account.userId,
        type: "INTEREST",
        amount: gainedDecimal,
        balanceAfter: updated.principalBalance.plus(updated.interestBalance),
        note: `Interest for ${days} day(s) at ${settings.investAnnualRatePct}% p.a.`,
      },
    });
    return updated;
  });
}

/** Convenience wrapper for call sites that only have a userId. */
export async function accrueInvestmentAccountByUserId(userId: string): Promise<InvestmentAccount | null> {
  const account = await prisma.investmentAccount.findUnique({ where: { userId } });
  if (!account) return null;
  return accrueInvestmentAccount(account);
}

/** Same idea, for a loan's outstanding balance while it's REPAYING. */
export async function accrueLoan(loan: Loan): Promise<Loan> {
  if (loan.status !== "REPAYING" || !loan.lastAccrualAt || loan.principalOwed.lessThanOrEqualTo(0)) {
    return loan;
  }

  const now = new Date();
  const days = wholeDaysBetween(loan.lastAccrualAt, now);
  if (days <= 0) return loan;

  const gained = compoundInterest(loan.principalOwed, annualToDaily(loan.interestRateApr), days);
  if (gained <= 0) return loan;

  const gainedDecimal = roundMoney(gained);
  const newLastAccrual = new Date(loan.lastAccrualAt.getTime() + days * 86_400_000);

  return prisma.loan.update({
    where: { id: loan.id },
    data: { interestOwed: { increment: gainedDecimal }, lastAccrualAt: newLastAccrual },
  });
}

/** Accrues every loan in a list that's currently REPAYING, in place. */
export async function accrueLoans<T extends Loan>(loans: T[]): Promise<T[]> {
  return Promise.all(
    loans.map(async (loan) => {
      if (loan.status !== "REPAYING") return loan;
      const updated = await accrueLoan(loan);
      return { ...loan, ...updated };
    }),
  );
}
