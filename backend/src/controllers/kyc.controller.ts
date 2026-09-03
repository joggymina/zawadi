import { Request, Response } from "express";
import { z } from "zod";
import * as kycService from "../services/kyc.service";
import { writeAudit } from "../services/audit.service";

export const submitKycSchema = z.object({
  fullName: z.string().min(3).max(120),
  idNumber: z.string().min(5).max(32),
  selfieData: z.string().min(100),
  idFrontData: z.string().min(100),
  idBackData: z.string().min(100),
});

export async function submitKyc(req: Request, res: Response) {
  const body = req.body as z.infer<typeof submitKycSchema>;
  const result = await kycService.submitKyc({ userId: req.user!.id, ...body });
  await writeAudit({
    userId: req.user!.id,
    action: "KYC_SUBMIT",
    metadata: { submissionId: result.id },
    ip: req.ip,
  });
  return res.status(201).json(result);
}

export async function getMyKyc(req: Request, res: Response) {
  return res.json(await kycService.getMyKyc(req.user!.id));
}