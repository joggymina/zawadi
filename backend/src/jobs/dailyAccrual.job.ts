import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { annualToDaily, compoundInterest, wholeDaysBetween, roundMoney, dailyTermAccrualSlice } from "../utils/money";
import { getAdminSettings } from "../services/adminSettings.service";
import { runDefaultSettlements } from "../services/defaultSettlement.service";

export async function runDailyAccrual() {
  const settings = await getAdminSettings();
  const investDailyRate = annualToDaily(settings.investAnnualRatePct);
  const now = new Date();

  // Investor / savings accounts — still compound at investAnnualRatePct p.a.
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

  // Borrower loans — flat term interest, accrued linearly over package duration.
  // Full term interest = principal × interestRateApr% (term rate, not p.a.).
  // Each day adds (totalTermInterest / durationDays), capped at total.
  const loans = await prisma.loan.findMany({
    where: { status: "REPAYING" },
    include: { package: true },
  });
  for (const loan of loans) {
    if (!loan.lastAccrualAt) continue;
    const days = wholeDaysBetween(loan.lastAccrualAt, now);
    if (days <= 0) continue;

    const durationHours = loan.package?.durationHours ?? 24 * 7;
    // Term fee is based on original loan amount (flat package %).
    const gainedDecimal = dailyTermAccrualSlice({
      principal: loan.amount,
      ratePct: loan.interestRateApr,
      durationHours,
      wholeDays: days,
      interestAlreadyOwed: loan.interestOwed,
    });
    if (gainedDecimal.lessThanOrEqualTo(0)) {
      // Still advance lastAccrualAt so we don't spin, but only if already at cap.
      const newLastAccrual = new Date(loan.lastAccrualAt.getTime() + days * 86_400_000);
      await prisma.loan.update({
        where: { id: loan.id },
        data: { lastAccrualAt: newLastAccrual },
      });
      continue;
    }

    const newLastAccrual = new Date(loan.lastAccrualAt.getTime() + days * 86_400_000);
    await prisma.loan.update({
      where: { id: loan.id },
      data: {
        interestOwed: { increment: gainedDecimal },
        lastAccrualAt: newLastAccrual,
      },
    });
  }

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
