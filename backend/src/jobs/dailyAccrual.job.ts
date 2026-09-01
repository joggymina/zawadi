import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { annualToDaily, compoundInterest, wholeDaysBetween, roundMoney } from "../utils/money";
import { getAdminSettings } from "../services/adminSettings.service";
import { runDefaultSettlements } from "../services/defaultSettlement.service";

export async function runDailyAccrual() {
  const settings = await getAdminSettings();
  const investDailyRate = annualToDaily(settings.investAnnualRatePct);
  const now = new Date();

  const accounts = await prisma.investmentAccount.findMany({
    where: { principalBalance: { gt: 0 } },
  });
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

    const gained = compoundInterest(
      loan.principalOwed,
      annualToDaily(loan.interestRateApr),
      days,
    );
    if (gained <= 0) continue;
    const gainedDecimal = roundMoney(gained);
    const newLastAccrual = new Date(loan.lastAccrualAt.getTime() + days * 86_400_000);

    await prisma.loan.update({
      where: { id: loan.id },
      data: { interestOwed: { increment: gainedDecimal }, lastAccrualAt: newLastAccrual },
    });
  }

  // Phase D: settle loans past due + grace
  await runDefaultSettlements(now);
}

export function scheduleDailyAccrual() {
  cron.schedule("5 0 * * *", () => {
    runDailyAccrual().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Daily accrual job failed:", err);
    });
  });
}