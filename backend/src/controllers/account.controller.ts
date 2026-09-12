import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { Decimal } from "@prisma/client/runtime/library";
import { z } from "zod";
import { writeAudit } from "../services/audit.service";
import { assertInvestAllowed, assertWithdrawAllowed } from "../services/kycLimits.service";
import { assertCanDebitPrincipal, getAvailablePrincipal } from "../services/guarantorHold.service";
import { getAdminSettings } from "../services/adminSettings.service";
import { creditPlatformTx } from "../services/platform.service";

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
  // Amount the user types is the *net* they want to receive.
  // Fee is charged on top and taken from their balance.
  const net = new Decimal(amount);

  await assertWithdrawAllowed(req.user!.id, amount);

  const settings = await getAdminSettings();
  const feePct = Number(settings.withdrawFeePct ?? 2.5);
  const fee = new Decimal(((Number(net) * feePct) / 100).toFixed(2));
  const totalDebit = net.plus(fee);

  // Hold-aware: cannot withdraw principal locked as guarantor
  await assertCanDebitPrincipal(req.user!.id, totalDebit);

  const account = await prisma.investmentAccount.findUnique({
    where: { userId: req.user!.id },
  });
  if (!account) throw new AppError("Account not found.", 404);
  if (totalDebit.greaterThan(account.principalBalance)) {
    throw new AppError(
      `Insufficient balance. You need ${totalDebit.toFixed(2)} (amount ${net.toFixed(2)} + ${feePct}% fee ${fee.toFixed(2)}).`,
      422,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.investmentAccount.update({
      where: { userId: req.user!.id },
      data: { principalBalance: { decrement: totalDebit } },
    });
    await tx.transaction.create({
      data: {
        userId: req.user!.id,
        type: "WITHDRAWAL",
        amount: totalDebit,
        balanceAfter: updated.principalBalance.plus(updated.interestBalance),
        note: `Withdrawal net ${net.toFixed(2)}; platform fee ${fee.toFixed(2)} (${feePct.toFixed(2)}%); total debited ${totalDebit.toFixed(2)}`,
      },
    });
    // Fee credited to platform account.
    if (fee.greaterThan(0)) {
      await creditPlatformTx(tx, fee);
    }
    return updated;
  });

  await writeAudit({
    userId: req.user!.id,
    action: "WITHDRAW",
    metadata: {
      net: Number(net),
      fee: Number(fee),
      totalDebit: Number(totalDebit),
      feePct,
    },
    ip: req.ip,
  });

  return res.json({
    principalBalance: result.principalBalance,
    amount: totalDebit,
    fee,
    net,
    feePct,
  });
}

/** Checklist + invite helpers for home onboarding. */
export async function getEngagement(req: Request, res: Response) {
  const userId = req.user!.id;
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      username: true,
      kycStatus: true,
      referredById: true,
      _count: { select: { referrals: true } },
    },
  });

  const [depositCount, fundCount, guaranteeCount, loanCount, account] = await Promise.all([
    prisma.transaction.count({ where: { userId, type: "DEPOSIT" } }),
    prisma.loanFunding.count({ where: { funderId: userId } }),
    prisma.loanGuarantor.count({
      where: { userId, status: "ACCEPTED" },
    }),
    prisma.loan.count({ where: { borrowerId: userId } }),
    prisma.investmentAccount.findUnique({ where: { userId } }),
  ]);

  const hasBalance =
    !!account &&
    (account.principalBalance.greaterThan(0) || account.interestBalance.greaterThan(0));

  const steps = {
    verified: user.kycStatus === "VERIFIED",
    // Admin top-ups / adjustments may not create DEPOSIT rows — treat balance as funded.
    firstDeposit: depositCount > 0 || hasBalance,
    fundedOrGuaranteed: fundCount > 0 || guaranteeCount > 0,
    requestedLoan: loanCount > 0,
  };
  const done = Object.values(steps).filter(Boolean).length;

  return res.json({
    username: user.username,
    kycStatus: user.kycStatus,
    referralCount: user._count.referrals,
    invitePath: `/register?ref=${encodeURIComponent(user.username)}`,
    steps,
    completedSteps: done,
    totalSteps: 4,
  });
}
