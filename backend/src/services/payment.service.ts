import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { Decimal } from "@prisma/client/runtime/library";
import { env } from "../config/env";
import { assertInvestAllowed } from "./kycLimits.service";
import { getAdminSettings } from "./adminSettings.service";
import * as notifications from "./notification.service";
import crypto from "crypto";

const HASHPAY_BASE = () =>
  (env.HASHPAY_BASE_URL || "https://api.hashback.co.ke").replace(/\/$/, "");

export type PaymentProvider = "HASHPAY" | "PAYHERO";

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

export async function getActivePaymentProvider(): Promise<PaymentProvider> {
  const s = await getAdminSettings();
  const raw = String((s as { paymentProvider?: string }).paymentProvider || "HASHPAY").toUpperCase();
  return raw === "PAYHERO" ? "PAYHERO" : "HASHPAY";
}

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

export function verifyHashPaySignature(
  rawBody: string | Buffer,
  signatureHeader?: string | string[],
): boolean {
  const secret = env.HASHPAY_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!signatureHeader) return false;
  const sig = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return sig === expected;
  }
}

async function initiateViaHashPay(params: {
  intentId: string;
  amount: Decimal;
  phone: string;
  username: string;
}) {
  if (!env.HASHPAY_API_KEY || !env.HASHPAY_ACCOUNT_ID) {
    throw new AppError("HashPay is not configured (API key / account id).", 503);
  }
  const body = {
    api_key: env.HASHPAY_API_KEY,
    account_id: env.HASHPAY_ACCOUNT_ID,
    amount: params.amount.toFixed(0),
    msisdn: params.phone,
    reference: params.intentId,
  };
  let hashJson: {
    success?: boolean;
    message?: string;
    checkout_id?: string;
    checkoutRequestID?: string;
    CheckoutRequestID?: string;
  };
  try {
    const res = await fetch(`${HASHPAY_BASE()}/initiatestk`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    hashJson = (await res.json().catch(() => ({}))) as typeof hashJson;
    if (!res.ok || hashJson.success === false) {
      throw new AppError(
        hashJson.message || `HashPay error (${res.status}). Try again.`,
        502,
      );
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("Could not reach HashPay. Try again shortly.", 502);
  }
  return (
    hashJson.checkout_id ||
    hashJson.checkoutRequestID ||
    hashJson.CheckoutRequestID ||
    null
  );
}

async function initiateViaPayHero(params: {
  intentId: string;
  amount: Decimal;
  phone: string;
  username: string;
}) {
  if (!env.PAYHERO_CHANNEL_ID || !env.PAYHERO_CALLBACK_URL) {
    throw new AppError("PayHero channel/callback is not configured.", 503);
  }
  const body = {
    amount: Number(params.amount.toFixed(0)),
    phone_number: params.phone,
    channel_id: Number(env.PAYHERO_CHANNEL_ID),
    provider: "m-pesa",
    external_reference: params.intentId,
    customer_name: params.username,
    callback_url: env.PAYHERO_CALLBACK_URL,
  };
  let payheroJson: {
    success?: boolean;
    status?: string;
    message?: string;
    reference?: string;
    CheckoutRequestID?: string;
  };
  try {
    const res = await fetch("https://backend.payhero.co.ke/api/v2/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: payHeroAuthHeader(),
      },
      body: JSON.stringify(body),
    });
    payheroJson = (await res.json().catch(() => ({}))) as typeof payheroJson;
    if (!res.ok || payheroJson.success === false) {
      throw new AppError(
        payheroJson.message || `PayHero error (${res.status}). Try again.`,
        502,
      );
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("Could not reach PayHero. Try again shortly.", 502);
  }
  return payheroJson.CheckoutRequestID || payheroJson.reference || null;
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
  const provider = await getActivePaymentProvider();

  const intent = await prisma.paymentIntent.create({
    data: {
      userId: params.userId,
      type: "DEPOSIT",
      amount,
      status: "PENDING",
    },
  });

  let providerRef: string | null = null;
  try {
    if (provider === "PAYHERO") {
      providerRef = await initiateViaPayHero({
        intentId: intent.id,
        amount,
        phone,
        username: user.username,
      });
    } else {
      providerRef = await initiateViaHashPay({
        intentId: intent.id,
        amount,
        phone,
        username: user.username,
      });
    }
  } catch (err) {
    await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: { status: "FAILED" },
    });
    throw err;
  }

  if (providerRef) {
    await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: { providerRef },
    });
  }

  return {
    intentId: intent.id,
    status: "PENDING" as const,
    provider,
    message: "Check your phone and enter your M-Pesa PIN to complete the deposit.",
    providerRef,
  };
}

/** Idempotent credit when provider reports success */
export async function completeDepositSuccess(params: {
  externalReference: string;
  providerRef?: string;
  mpesaReceipt?: string;
}) {
  const result = await prisma.$transaction(async (tx) => {
    let intent = await tx.paymentIntent.findUnique({
      where: { id: params.externalReference },
    });
    if (!intent && params.providerRef) {
      intent = await tx.paymentIntent.findFirst({
        where: { providerRef: params.providerRef, status: "PENDING" },
      });
    }
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
  let intent = await prisma.paymentIntent.findUnique({
    where: { id: externalReference },
  });
  if (!intent) {
    intent = await prisma.paymentIntent.findFirst({
      where: { providerRef: externalReference, status: "PENDING" },
    });
  }
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
