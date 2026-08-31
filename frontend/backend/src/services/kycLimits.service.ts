import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { KYC_LIMITS } from "../config/limits";
import { Decimal } from "@prisma/client/runtime/library";
import type { KycStatus } from "@prisma/client";

export async function getUserKyc(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, kycStatus: true },
  });
  if (!user) throw new AppError("User not found.", 404);
  return user;
}

export function assertNotRejected(kycStatus: KycStatus) {
  if (kycStatus === "REJECTED") {
    throw new AppError("Account restricted. Contact support.", 403);
  }
}

export function limitsFor(kycStatus: KycStatus) {
  assertNotRejected(kycStatus);
  // PENDING and any unknown → PENDING limits; VERIFIED → verified
  if (kycStatus === "VERIFIED") return KYC_LIMITS.VERIFIED;
  return KYC_LIMITS.PENDING;
}

export function assertTxAmount(kycStatus: KycStatus, amount: number | Decimal) {
  const limits = limitsFor(kycStatus);
  const n = typeof amount === "number" ? amount : Number(amount);
  if (n > limits.maxTxAmount) {
    throw new AppError(
      `Unverified or limited accounts can only move up to KSH ${limits.maxTxAmount.toLocaleString()} per transaction. Verify your account for higher limits.`,
      422,
    );
  }
}

export function assertLoanAmount(kycStatus: KycStatus, amount: number | Decimal) {
  const limits = limitsFor(kycStatus);
  const n = typeof amount === "number" ? amount : Number(amount);
  if (n > limits.maxLoanAmount) {
    throw new AppError(
      `Loan amount cannot exceed KSH ${limits.maxLoanAmount.toLocaleString()} for your verification level.`,
      422,
    );
  }
}

export async function assertInvestAllowed(userId: string, amount: number) {
  const { kycStatus } = await getUserKyc(userId);
  assertTxAmount(kycStatus, amount);

  const limits = limitsFor(kycStatus);
  const account = await prisma.investmentAccount.findUnique({ where: { userId } });
  const current = account ? Number(account.principalBalance.plus(account.interestBalance)) : 0;
  if (current + amount > limits.maxBalance) {
    throw new AppError(
      `This would exceed the KSH ${limits.maxBalance.toLocaleString()} balance limit for your verification level.`,
      422,
    );
  }
}

export async function assertWithdrawAllowed(userId: string, amount: number) {
  const { kycStatus } = await getUserKyc(userId);
  assertTxAmount(kycStatus, amount);
}

export async function assertCreateLoanAllowed(userId: string, amount: number) {
  const { kycStatus } = await getUserKyc(userId);
  assertLoanAmount(kycStatus, amount);

  const limits = limitsFor(kycStatus);
  const openCount = await prisma.loan.count({
    where: {
      borrowerId: userId,
      status: { in: ["OPEN", "REPAYING", "PENDING_GUARANTORS"] },
    },
  });
  if (openCount >= limits.maxOpenLoans) {
    throw new AppError(
      `You can have at most ${limits.maxOpenLoans} open loan(s) at your verification level.`,
      422,
    );
  }
}

export async function assertFundAllowed(userId: string, amount: number) {
  const { kycStatus } = await getUserKyc(userId);
  assertTxAmount(kycStatus, amount);
}