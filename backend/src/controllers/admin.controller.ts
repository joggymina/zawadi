import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { getAdminSettings, updateAdminSettings } from "../services/adminSettings.service";
import * as loanService from "../services/loan.service";
import { writeAudit } from "../services/audit.service";

export const updateSettingsSchema = z.object({
  investAnnualRatePct: z.number().min(0).max(100).optional(),
  loanAnnualRatePct: z.number().min(0).max(100).optional(),
  guarantorsRequired: z.number().int().min(1).max(20).optional(),
  guarantorCoverageExtraPct: z.number().min(0).max(200).optional(),
});

export const offerSchema = z.object({
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(300),
});

export async function getSettings(_req: Request, res: Response) {
  return res.json(await getAdminSettings());
}

export async function putSettings(req: Request, res: Response) {
  const body = req.body as z.infer<typeof updateSettingsSchema>;
  const updated = await updateAdminSettings(body);
  await writeAudit({
    userId: req.user!.id,
    action: "ADMIN_SETTINGS_UPDATE",
    metadata: body,
    ip: req.ip,
  });
  return res.json(updated);
}

export async function listOffers(_req: Request, res: Response) {
  return res.json(
    await prisma.offer.findMany({ where: { active: true }, orderBy: { createdAt: "desc" } }),
  );
}

export async function createOffer(req: Request, res: Response) {
  const body = req.body as z.infer<typeof offerSchema>;
  const offer = await prisma.offer.create({ data: body });
  await writeAudit({
    userId: req.user!.id,
    action: "ADMIN_OFFER_CREATE",
    metadata: { id: offer.id, title: offer.title },
    ip: req.ip,
  });
  return res.status(201).json(offer);
}

export async function deleteOffer(req: Request, res: Response) {
  await prisma.offer.update({ where: { id: req.params.id }, data: { active: false } });
  await writeAudit({
    userId: req.user!.id,
    action: "ADMIN_OFFER_DELETE",
    metadata: { id: req.params.id },
    ip: req.ip,
  });
  return res.status(204).send();
}

export async function listPendingRepayments(_req: Request, res: Response) {
  const repayments = await prisma.loanRepayment.findMany({
    where: { status: "PENDING" },
    include: {
      loan: { include: { borrower: { select: { username: true } } } },
      distributions: { include: { funder: { select: { username: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  return res.json(repayments);
}

export async function approveRepayment(req: Request, res: Response) {
  const result = await loanService.approveRepayment({
    repaymentId: req.params.id,
    adminId: req.user!.id,
  });
  await writeAudit({
    userId: req.user!.id,
    action: "ADMIN_REPAYMENT_APPROVE",
    metadata: { repaymentId: req.params.id },
    ip: req.ip,
  });
  return res.json(result);
}

export async function rejectRepayment(req: Request, res: Response) {
  const result = await loanService.rejectRepayment({
    repaymentId: req.params.id,
    adminId: req.user!.id,
  });
  await writeAudit({
    userId: req.user!.id,
    action: "ADMIN_REPAYMENT_REJECT",
    metadata: { repaymentId: req.params.id },
    ip: req.ip,
  });
  return res.json(result);
}