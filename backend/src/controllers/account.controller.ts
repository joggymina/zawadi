import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { Decimal } from "@prisma/client/runtime/library";
import { z } from "zod";

export const amountSchema = z.object({
  amount: z.number().positive().max(10_000_000),
});

export async function getMe(req: Request, res: Response) {
  const account = await prisma.investmentAccount.findUnique({ where: { userId: req.user!.id } });
  if (!account) throw new AppError("Account not found.", 404);
  return res.json({
    principalBalance: account.principalBalance,
    interestBalance: account.interestBalance,
    totalBalance: account.principalBalance.plus(account.interestBalance),
  });
}

export async function getTransactions(req: Request, res: Response) {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const txs = await prisma.transaction.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return res.json(txs);
}

// NOTE: `invest` here directly credits the ledger. This is intentional
// while there's no payment rail wired up yet — once Daraja (M-PESA) is
// integrated, this endpoint should instead create a PENDING PaymentIntent
// and STK-push the user; the ledger credit happens only from the
// payment-confirmed webhook handler, never from a client-initiated call.
export async function invest(req: Request, res: Response) {
  const { amount } = req.body as z.infer<typeof amountSchema>;
  const amt = new Decimal(amount);

  const result = await prisma.$transaction(async (tx) => {
    const account = await tx.investmentAccount.update({
      where: { userId: req.user!.id },
      data: { principalBalance: { increment: amt } },
    });
    await tx.transaction.create({
      data: {
        userId: req.user!.id,
        type: "DEPOSIT",
        amount: amt,
        balanceAfter: account.principalBalance.plus(account.interestBalance),
        note: "Manual deposit (pre-payment-integration)",
      },
    });
    return account;
  });

  return res.json({ principalBalance: result.principalBalance });
}

export async function withdraw(req: Request, res: Response) {
  const { amount } = req.body as z.infer<typeof amountSchema>;
  const amt = new Decimal(amount);

  const account = await prisma.investmentAccount.findUnique({ where: { userId: req.user!.id } });
  if (!account) throw new AppError("Account not found.", 404);
  if (amt.greaterThan(account.principalBalance)) {
    throw new AppError("That's more than your investment principal.", 422);
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.investmentAccount.update({
      where: { userId: req.user!.id },
      data: { principalBalance: { decrement: amt } },
    });
    await tx.transaction.create({
      data: {
        userId: req.user!.id,
        type: "WITHDRAWAL",
        amount: amt,
        balanceAfter: updated.principalBalance.plus(updated.interestBalance),
        note: "Manual withdrawal (pre-payment-integration)",
      },
    });
    return updated;
  });

  return res.json({ principalBalance: result.principalBalance });
}
