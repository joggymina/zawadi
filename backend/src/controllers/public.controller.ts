import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";

/** Aggregated platform proof — no personal data. */
export async function platformStats(_req: Request, res: Response) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [
    memberCount,
    accounts,
    loansRepaidMonth,
    loansRepaidAll,
    openLoans,
    activeFundings,
  ] = await Promise.all([
    prisma.user.count({ where: { username: { not: "__platform__" } } }),
    prisma.investmentAccount.findMany({
      select: { principalBalance: true, interestBalance: true },
    }),
    prisma.loan.count({
      where: { status: "REPAID", updatedAt: { gte: startOfMonth } },
    }),
    prisma.loan.count({ where: { status: "REPAID" } }),
    prisma.loan.count({ where: { status: "OPEN" } }),
    prisma.loanFunding.count({
      where: { loan: { status: { in: ["OPEN", "REPAYING"] } } },
    }),
  ]);

  let underManagement = new Decimal(0);
  for (const a of accounts) {
    underManagement = underManagement.plus(a.principalBalance).plus(a.interestBalance);
  }

  return res.json({
    members: memberCount,
    underManagement: underManagement.toFixed(2),
    loansRepaidThisMonth: loansRepaidMonth,
    loansRepaidAllTime: loansRepaidAll,
    openForFunding: openLoans,
    activeFundings,
  });
}

/**
 * Recent sanitized activity. Prefers deposits / funding / repayments over
 * bulk daily interest rows so the feed stays readable.
 */
export async function platformActivity(req: Request, res: Response) {
  const limit = Math.min(Number(req.query.limit) || 8, 20);

  const [deposits, funds, returns, repaid, interestSample] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        type: "DEPOSIT",
        user: { username: { not: "__platform__" } },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { createdAt: true },
    }),
    prisma.loanFunding.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { createdAt: true, amount: true },
    }),
    prisma.transaction.findMany({
      where: {
        type: "LOAN_RETURN",
        user: { username: { not: "__platform__" } },
      },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { createdAt: true },
    }),
    prisma.loan.findMany({
      where: { status: "REPAID" },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: { updatedAt: true },
    }),
    prisma.transaction.findMany({
      where: {
        type: "INTEREST",
        user: { username: { not: "__platform__" } },
      },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { createdAt: true },
    }),
  ]);

  type Item = { kind: string; text: string; at: string; rank: number };
  const items: Item[] = [];

  for (const t of deposits) {
    items.push({
      kind: "deposit",
      text: "A member invested via M-Pesa",
      at: t.createdAt.toISOString(),
      rank: 1,
    });
  }
  for (const f of funds) {
    items.push({
      kind: "fund",
      text: "A marketplace loan received funding",
      at: f.createdAt.toISOString(),
      rank: 2,
    });
  }
  for (const l of repaid) {
    items.push({
      kind: "repaid",
      text: "A loan was fully repaid",
      at: l.updatedAt.toISOString(),
      rank: 1,
    });
  }
  for (const t of returns) {
    items.push({
      kind: "return",
      text: "A funder received a repayment share",
      at: t.createdAt.toISOString(),
      rank: 3,
    });
  }
  // At most one interest line (batch jobs create many identical rows)
  if (interestSample[0]) {
    items.push({
      kind: "interest",
      text: "Daily investment interest was credited to members",
      at: interestSample[0].createdAt.toISOString(),
      rank: 9,
    });
  }

  // Dedupe identical kind within 2 minutes
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  const deduped: Item[] = [];
  for (const it of items) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      prev.kind === it.kind &&
      Math.abs(new Date(prev.at).getTime() - new Date(it.at).getTime()) < 120_000
    ) {
      continue;
    }
    deduped.push(it);
  }

  // Prefer higher-signal events, then recency
  deduped.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.at < b.at ? 1 : -1;
  });

  return res.json(
    deduped.slice(0, limit).map(({ kind, text, at }) => ({ kind, text, at })),
  );
}
