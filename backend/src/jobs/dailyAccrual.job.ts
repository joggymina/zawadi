import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { annualToDaily, compoundInterest, wholeDaysBetween, roundMoney } from "../utils/money";
import { getAdminSettings } from "../services/adminSettings.service";

/**
 * Accrues interest on every investment account and every actively-repaying
 * loan. Idempotent: running it twice in the same day is a no-op because
 * `wholeDaysBetween` only counts *whole* elapsed days since the last run,
 * and lastAccrualAt is advanced by exactly that many days (not to "now"),
 * so partial days are never dropped or double-counted.
 */
export async function runDailyAccrual() {
  const settings = await getAdminSettings();
  const investDailyRate = annualToDaily(settings.investAnnualRatePct);
  const now = new Date();

  const accounts = await prisma.investmentAccount.findMany({ where: { principalBalance: { gt: 0 } } });
  for (const account of accounts) {
    const days = wholeDaysBetween(account.lastAccrualAt, now);
    if (days <= 0) continue;

    const gained = compoundInterest(account.principalBalance, investDailyRate, days);
    if (gained <= 0) continue;
    const gainedDecimal = roundMoney(gained);
    const newLastAccrual = new Date(account.lastAccrualAt.getTime() + days * 86_400_000);

    await prisma.$transaction(async (tx) => {
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
    });
  }

  const loans = await prisma.loan.findMany({ where: { status: "REPAYING" } });
  for (const loan of loans) {
    if (!loan.lastAccrualAt) continue;
    const days = wholeDaysBetween(loan.lastAccrualAt, now);
    if (days <= 0) continue;

    const gained = compoundInterest(loan.principalOwed, annualToDaily(loan.interestRateApr), days);
    if (gained <= 0) continue;
    const gainedDecimal = roundMoney(gained);
    const newLastAccrual = new Date(loan.lastAccrualAt.getTime() + days * 86_400_000);

    await prisma.loan.update({
      where: { id: loan.id },
      data: { interestOwed: { increment: gainedDecimal }, lastAccrualAt: newLastAccrual },
    });
  }
}

// Runs once daily at 00:05 server time. In production, run this as its
// own worker process (or a managed scheduled job / queue consumer)
// rather than in-process with the API server, so a slow accrual run
// never blocks request handling and a restart never skips a run.
export function scheduleDailyAccrual() {
  cron.schedule("5 0 * * *", () => {
    runDailyAccrual().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Daily accrual job failed:", err);
    });
  });
}
