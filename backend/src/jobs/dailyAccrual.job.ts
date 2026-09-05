import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { annualToDaily, compoundInterest, wholeDaysBetween, roundMoney, dailyTermAccrualSlice , wholeHoursBetween, hourlyTermAccrualSlice } from "../utils/money";
import { getAdminSettings } from "../services/adminSettings.service";
import { runDefaultSettlements } from "../services/defaultSettlement.service";
import { interestForPackageTier } from "../services/loan.service";

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

    // Borrower loans — package-tier interest (match elapsed time to a package duration).
  // Not hourly pro-rata; interest is the full rate of the matched duration band.
  const packages = await prisma.loanPackage.findMany({ orderBy: { durationHours: "asc" } });
  const loans = await prisma.loan.findMany({
    where: { status: "REPAYING" },
    include: { package: true },
  });
  for (const loan of loans) {
    if (!loan.disbursedAt) continue;
    const elapsedHours = Math.max(
      0,
      (now.getTime() - loan.disbursedAt.getTime()) / (60 * 60 * 1000),
    );
    const loanPkg = loan.package
      ? {
          id: loan.package.id,
          name: loan.package.name,
          durationHours: loan.package.durationHours,
          interestRateApr: loan.package.interestRateApr,
        }
      : null;
    const { interest } = interestForPackageTier({
      principal: loan.amount,
      packages,
      elapsedHours,
      loanPackage: loanPkg,
    });
    if (!interest.eq(loan.interestOwed)) {
      await prisma.loan.update({
        where: { id: loan.id },
        data: { interestOwed: interest, lastAccrualAt: now },
      });
    }
  }

  await runDefaultSettlements(now);
}

export function scheduleDailyAccrual() {
  // Investor yield: once per day.
  cron.schedule("5 0 * * *", () => {
    runDailyAccrual().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Daily accrual job failed:", err);
    });
  });
  // Loan interest: once per hour (whole-hour steps).
  cron.schedule("3 * * * *", () => {
    runDailyAccrual().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Hourly loan accrual job failed:", err);
    });
  });
}
