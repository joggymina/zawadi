import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { Decimal } from "@prisma/client/runtime/library";

export const PLATFORM_USERNAME = "__platform__";

export async function ensurePlatformAccount() {
  return prisma.platformAccount.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      principalBalance: new Decimal(0),
      lifetimeInflow: new Decimal(0),
      lifetimeOutflow: new Decimal(0),
    },
    update: {},
  });
}

/** System user used as LoanFunding.funderId for platform capital. */
export async function ensurePlatformUser() {
  const existing = await prisma.user.findUnique({ where: { username: PLATFORM_USERNAME } });
  if (existing) return existing;

  return prisma.user.create({
    data: {
      username: PLATFORM_USERNAME,
      phoneNumber: "0000000000",
      passwordHash: "$platform$not-a-login",
      role: "ADMIN",
      kycStatus: "VERIFIED",
      account: { create: {} },
    },
  });
}

export async function getPlatformUserId(): Promise<string> {
  const u = await ensurePlatformUser();
  return u.id;
}

export async function getPlatformSummary() {
  const acct = await ensurePlatformAccount();
  return {
    principalBalance: acct.principalBalance,
    lifetimeInflow: acct.lifetimeInflow,
    lifetimeOutflow: acct.lifetimeOutflow,
    updatedAt: acct.updatedAt,
  };
}

/** Credit platform (top-up, repayment return, fees). */
export async function creditPlatform(amount: Decimal | number, _note?: string) {
  const amt = new Decimal(amount);
  if (amt.lessThanOrEqualTo(0)) throw new AppError("Amount must be positive.", 422);
  await ensurePlatformAccount();
  return prisma.platformAccount.update({
    where: { id: "default" },
    data: {
      principalBalance: { increment: amt },
      lifetimeInflow: { increment: amt },
    },
  });
}

/** Credit inside an existing transaction. */
export async function creditPlatformTx(tx: any, amount: Decimal) {
  if (amount.lessThanOrEqualTo(0)) return null;
  await tx.platformAccount.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      principalBalance: amount,
      lifetimeInflow: amount,
      lifetimeOutflow: new Decimal(0),
    },
    update: {
      principalBalance: { increment: amount },
      lifetimeInflow: { increment: amount },
    },
  });
}

/** Debit platform for residual loan funding. */
export async function debitPlatform(tx: any, amount: Decimal) {
  const acct = await tx.platformAccount.findUnique({ where: { id: "default" } });
  if (!acct) throw new AppError("Platform account not initialized.", 500);
  if (acct.principalBalance.lessThan(amount)) {
    throw new AppError(
      `Platform balance too low. Available ${acct.principalBalance.toFixed(2)}, need ${amount.toFixed(2)}.`,
      422,
    );
  }
  return tx.platformAccount.update({
    where: { id: "default" },
    data: {
      principalBalance: { decrement: amount },
      lifetimeOutflow: { increment: amount },
    },
  });
}
