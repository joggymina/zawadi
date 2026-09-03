import { Request, Response } from "express";
import { z } from "zod";
import * as paymentService from "../services/payment.service";
import { writeAudit } from "../services/audit.service";

export const depositSchema = z.object({
  amount: z.number().positive().max(10_000_000),
  phone: z.string().min(9).max(15).optional(),
});

export async function startDeposit(req: Request, res: Response) {
  const body = req.body as z.infer<typeof depositSchema>;
  const result = await paymentService.initiateDeposit({
    userId: req.user!.id,
    amount: body.amount,
    phone: body.phone,
  });
  await writeAudit({
    userId: req.user!.id,
    action: "DEPOSIT_INIT",
    metadata: { amount: body.amount, intentId: result.intentId },
    ip: req.ip,
  });
  return res.status(201).json(result);
}

export async function getIntent(req: Request, res: Response) {
  const intent = await paymentService.getIntentForUser(req.user!.id, req.params.id);
  return res.json(intent);
}

/**
 * PayHero webhook — no JWT.
 * Body shape: { status, response: { ResultCode, ExternalReference, ... } }
 */
export async function payheroCallback(req: Request, res: Response) {
  try {
    const payload = req.body as {
      status?: boolean;
      response?: {
        ResultCode?: number | string;
        ResultDesc?: string;
        Status?: string;
        ExternalReference?: string;
        CheckoutRequestID?: string;
        MpesaReceiptNumber?: string;
        Amount?: number;
      };
    };

    const r = payload.response ?? (req.body as typeof payload.response);
    const externalRef = r?.ExternalReference;
    if (!externalRef) {
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    const code = Number(r?.ResultCode);
    const ok =
      code === 0 ||
      String(r?.Status || "").toLowerCase() === "success";

    if (ok) {
      await paymentService.completeDepositSuccess({
        externalReference: externalRef,
        providerRef: r?.CheckoutRequestID,
        mpesaReceipt: r?.MpesaReceiptNumber,
      });
    } else {
      await paymentService.markDepositFailed(
        externalRef,
        r?.ResultDesc || "Payment not completed",
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("PayHero callback error:", err);
  }

  // Always ACK so PayHero does not retry forever
  return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
}