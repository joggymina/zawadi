import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { Decimal } from "@prisma/client/runtime/library";
import { z } from "zod";
import { writeAudit } from "../services/audit.service";
import { assertInvestAllowed, assertWithdrawAllowed } from "../services/kycLimits.service";
import { assertCanDebitPrincipal, getAvailablePrincipal } from "../services/guarantorHold.service";
import { getAdminSettings } from "../services/adminSettings.service";

export const amountSchema = z.object({
  amount: z.number().positive().max(10_000_000),
});

export async function getMe(req: Request, res: Response) {
  const bal = await getAvailablePrincipal(req.user!.id);
  return res.json({
    principalBalance: bal.principal,
    interestBalance: bal.interest,
    totalBalance: bal.principal.plus(bal.interest),
    heldAsGuarantor: bal.held,
    availablePrincipal: bal.available,
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

export async function invest(req: Request, res: Response) {
  const { amount } = req.body as z.infer<typeof amountSchema>;
  const amt = new Decimal(amount);
  await assertInvestAllowed(req.user!.id, amount);

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

  await writeAudit({
    userId: req.user!.id,
    action: "INVEST",
    metadata: { amount },
    ip: req.ip,
  });

  return res.json({ principalBalance: result.principalBalance });
}

export async function withdraw(req: Request, res: Response) {
  const { amount } = req.body as z.infer<typeof amountSchema>;
  const gross = new Decimal(amount);

  await assertWithdrawAllowed(req.user!.id, amount);

  const settings = await getAdminSettings();
  const feePct = Number(settings.withdrawFeePct ?? 2.5);
  const fee = new Decimal(((Number(gross) * feePct) / 100).toFixed(2));
  const net = gross.minus(fee);

  if (net.lessThanOrEqualTo(0)) {
    throw new AppError("Amount too small after withdrawal fee.", 422);
  }

  // Hold-aware: cannot withdraw principal locked as guarantor
  await assertCanDebitPrincipal(req.user!.id, gross);

  const account = await prisma.investmentAccount.findUnique({
    where: { userId: req.user!.id },
  });
  if (!account) throw new AppError("Account not found.", 404);
  if (gross.greaterThan(account.principalBalance)) {
    throw new AppError("That's more than your investment principal.", 422);
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.investmentAccount.update({
      where: { userId: req.user!.id },
      data: { principalBalance: { decrement: gross } },
    });
    await tx.transaction.create({
      data: {
        userId: req.user!.id,
        type: "WITHDRAWAL",
        amount: gross,
        balanceAfter: updated.principalBalance.plus(updated.interestBalance),
        note: `Withdrawal gross ${gross.toFixed(2)}; platform fee ${fee.toFixed(2)} (${feePct.toFixed(2)}%); net ${net.toFixed(2)}`,
      },
    });
    return updated;
  });

  await writeAudit({
    userId: req.user!.id,
    action: "WITHDRAW",
    metadata: {
      amount: Number(gross),
      fee: Number(fee),
      net: Number(net),
      feePct,
    },
    ip: req.ip,
  });

  return res.json({
    principalBalance: result.principalBalance,
    amount: gross,
    fee,
    net,
    feePct,
  });
}