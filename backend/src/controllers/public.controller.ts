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

/** Recent sanitized activity for social proof. */
export async function platformActivity(req: Request, res: Response) {
  const limit = Math.min(Number(req.query.limit) || 12, 30);

  const [txs, repaid, funded] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        type: { in: ["DEPOSIT", "INTEREST", "LOAN_FUND", "LOAN_RETURN"] },
        user: { username: { not: "__platform__" } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { type: true, amount: true, createdAt: true },
    }),
    prisma.loan.findMany({
      where: { status: "REPAID" },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { amount: true, updatedAt: true },
    }),
    prisma.loanFunding.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { amount: true, createdAt: true },
    }),
  ]);

  type Item = { kind: string; text: string; at: string };
  const items: Item[] = [];

  for (const t of txs) {
    const amt = Number(t.amount);
    if (t.type === "DEPOSIT") {
      items.push({
        kind: "deposit",
        text: `A member invested via M-Pesa`,
        at: t.createdAt.toISOString(),
      });
    } else if (t.type === "INTEREST") {
      items.push({
        kind: "interest",
        text: `Investment interest was credited`,
        at: t.createdAt.toISOString(),
      });
    } else if (t.type === "LOAN_FUND") {
      items.push({
        kind: "fund",
        text: `Someone funded a marketplace loan`,
        at: t.createdAt.toISOString(),
      });
    } else if (t.type === "LOAN_RETURN") {
      items.push({
        kind: "return",
        text: `A funder received a repayment share`,
        at: t.createdAt.toISOString(),
      });
    }
    void amt;
  }

  for (const l of repaid) {
    items.push({
      kind: "repaid",
      text: `A loan was fully repaid`,
      at: l.updatedAt.toISOString(),
    });
  }

  for (const f of funded) {
    items.push({
      kind: "fund",
      text: `A loan received new funding`,
      at: f.createdAt.toISOString(),
    });
  }

  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return res.json(items.slice(0, limit));
}
