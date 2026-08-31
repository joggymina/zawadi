import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { accrueInvestmentAccount, accrueLoan } from "../services/interestAccrual.service";

/**
 * Batch sweep that catches up every account and loan at once. This is a
 * convenience for accounts nobody has actively viewed in a while — the
 * *reliable* accrual path is interestAccrual.service.ts, called lazily
 * from getMe/invest/withdraw and the loan list/fund/repay endpoints on
 * every request. This job existing (or missing a run) no longer matters
 * for correctness, only for how promptly a dormant account's interest
 * shows up before someone next looks at it.
 */
export async function runDailyAccrual() {
  const accounts = await prisma.investmentAccount.findMany({ where: { principalBalance: { gt: 0 } } });
  for (const account of accounts) {
    await accrueInvestmentAccount(account);
  }

  const loans = await prisma.loan.findMany({ where: { status: "REPAYING" } });
  for (const loan of loans) {
    await accrueLoan(loan);
  }
}

// Runs once daily at 00:05 server time. In production, run this as its
// own worker process (or a managed scheduled job / queue consumer)
// rather than in-process with the API server, so a slow accrual run
// never blocks request handling. Its own reliability no longer matters
// for correctness (see the comment above) — this is just for freshness.
export function scheduleDailyAccrual() {
  cron.schedule("5 0 * * *", () => {
    runDailyAccrual().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Daily accrual job failed:", err);
    });
  });
}

