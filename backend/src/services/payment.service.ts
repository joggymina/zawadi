import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { Decimal } from "@prisma/client/runtime/library";
import { env } from "../config/env";
import { assertInvestAllowed } from "./kycLimits.service";
import * as notifications from "./notification.service";

function payHeroAuthHeader(): string {
  if (env.PAYHERO_BASIC_TOKEN) {
    const t = env.PAYHERO_BASIC_TOKEN.trim();
    return t.toLowerCase().startsWith("basic ") ? t : `Basic ${t}`;
  }
  if (env.PAYHERO_API_USERNAME && env.PAYHERO_API_PASSWORD) {
    const raw = Buffer.from(
      `${env.PAYHERO_API_USERNAME}:${env.PAYHERO_API_PASSWORD}`,
      "utf8",
    ).toString("base64");
    return `Basic ${raw}`;
  }
  throw new AppError("PayHero credentials are not configured.", 503);
}

/** Normalize to 2547… / 2541… */
export function normalizeKenyaPhone(input: string): string {
  let p = input.replace(/[\s\-]/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0")) p = `254${p.slice(1)}`;
  if (p.startsWith("7") || p.startsWith("1")) p = `254${p}`;
  if (!/^254[71]\d{8}$/.test(p)) {
    throw new AppError("Enter a valid M-Pesa number (e.g. 07XXXXXXXX).", 422);
  }
  return p;
}

export async function initiateDeposit(params: {
  userId: string;
  amount: number;
  phone?: string;
}) {
  const amount = new Decimal(params.amount);
  if (!amount.isInteger() || amount.lessThan(1)) {
    throw new AppError("Amount must be a whole number of at least 1 KSH.", 422);
  }

  await assertInvestAllowed(params.userId, params.amount);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: params.userId },
    select: { phoneNumber: true, username: true },
  });

  const phone = normalizeKenyaPhone(params.phone ?? user.phoneNumber);

  if (!env.PAYHERO_CHANNEL_ID || !env.PAYHERO_CALLBACK_URL) {
    throw new AppError("PayHero channel/callback is not configured.", 503);
  }

  const intent = await prisma.paymentIntent.create({
    data: {
      userId: params.userId,
      type: "DEPOSIT",
      amount,
      status: "PENDING",
    },
  });

  const body = {
    amount: Number(amount.toFixed(0)),
    phone_number: phone,
    channel_id: Number(env.PAYHERO_CHANNEL_ID),
    provider: "m-pesa",
    external_reference: intent.id,
    customer_name: user.username,
    callback_url: env.PAYHERO_CALLBACK_URL,
  };

  let payheroJson: {
    success?: boolean;
    status?: string;
    reference?: string;
    CheckoutRequestID?: string;
    message?: string;
  };

  try {
    const res = await fetch("https://backend.payhero.co.ke/api/v2/payments", {
      method: "POST",
      headers: {
        Authorization: payHeroAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    payheroJson = (await res.json().catch(() => ({}))) as typeof payheroJson;
    if (!res.ok) {
      await prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: "FAILED" },
      });
      throw new AppError(
        (payheroJson as { message?: string }).message ||
          `PayHero error (${res.status}). Try again.`,
        502,
      );
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: { status: "FAILED" },
    });
    throw new AppError("Could not reach PayHero. Try again shortly.", 502);
  }

  const providerRef =
    payheroJson.CheckoutRequestID || payheroJson.reference || null;

  if (providerRef) {
    await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: { providerRef },
    });
  }

  return {
    intentId: intent.id,
    status: "PENDING" as const,
    message: "Check your phone and enter your M-Pesa PIN to complete the deposit.",
    providerRef,
  };
}

/** Idempotent credit when PayHero reports success */
export async function completeDepositSuccess(params: {
  externalReference: string;
  providerRef?: string;
  mpesaReceipt?: string;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const intent = await tx.paymentIntent.findUnique({
      where: { id: params.externalReference },
    });
    if (!intent) throw new AppError("Payment not found.", 404);
    if (intent.status === "SUCCESS") {
      return { intentId: intent.id, status: "SUCCESS" as const, alreadyProcessed: true };
    }
    if (intent.type !== "DEPOSIT") throw new AppError("Not a deposit.", 422);
    if (intent.status !== "PENDING") {
      throw new AppError("Payment cannot be completed.", 422);
    }

    await tx.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: "SUCCESS",
        providerRef: params.providerRef ?? params.mpesaReceipt ?? intent.providerRef,
        completedAt: new Date(),
      },
    });

    const account = await tx.investmentAccount.update({
      where: { userId: intent.userId },
      data: { principalBalance: { increment: intent.amount } },
    });

    const receipt = params.mpesaReceipt || params.providerRef || intent.id;
    await tx.transaction.create({
      data: {
        userId: intent.userId,
        type: "DEPOSIT",
        amount: intent.amount,
        balanceAfter: account.principalBalance.plus(account.interestBalance),
        referenceId: intent.id,
        note: `M-Pesa deposit (${receipt})`,
      },
    });

    return {
      intentId: intent.id,
      userId: intent.userId,
      amount: intent.amount,
      status: "SUCCESS" as const,
      alreadyProcessed: false,
    };
  });

  if (!result.alreadyProcessed && "userId" in result) {
    try {
      await notifications.notify({
        userId: result.userId as string,
        type: "DEPOSIT_SUCCEEDED",
        title: "Deposit received",
        body: `Your investment balance was credited with KSH ${Number(result.amount).toFixed(2)}.`,
        meta: { intentId: result.intentId },
      });
    } catch {
      /* ignore */
    }
  }

  return result;
}

export async function markDepositFailed(externalReference: string, reason?: string) {
  const intent = await prisma.paymentIntent.findUnique({
    where: { id: externalReference },
  });
  if (!intent || intent.status !== "PENDING") return;
  await prisma.paymentIntent.update({
    where: { id: intent.id },
    data: { status: "FAILED", completedAt: new Date() },
  });
  try {
    await notifications.notify({
      userId: intent.userId,
      type: "DEPOSIT_FAILED",
      title: "Deposit failed",
      body: reason || "M-Pesa payment was not completed.",
      meta: { intentId: intent.id },
    });
  } catch {
    /* ignore */
  }
}

export async function getIntentForUser(userId: string, intentId: string) {
  const intent = await prisma.paymentIntent.findFirst({
    where: { id: intentId, userId },
  });
  if (!intent) throw new AppError("Payment not found.", 404);
  return intent;
}