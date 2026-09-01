import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { getAdminSettings, updateAdminSettings } from "../services/adminSettings.service";
import * as loanService from "../services/loan.service";
import { writeAudit } from "../services/audit.service";
import * as defaultSettlement from "../services/defaultSettlement.service";
// ...any other single imports you need (not duplicated)

export const updateSettingsSchema = z.object({
  investAnnualRatePct: z.number().min(0).max(100).optional(),
  loanAnnualRatePct: z.number().min(0).max(100).optional(),
  guarantorsRequired: z.number().int().min(1).max(20).optional(),
  guarantorCoverageExtraPct: z.number().min(0).max(200).optional(),
  withdrawFeePct: z.number().min(0).max(100).optional(),
  platformInterestSharePct: z.number().min(0).max(100).optional(),
});

export const offerSchema = z.object({
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(300),
});

export const setKycSchema = z.object({
  kycStatus: z.enum(["PENDING", "VERIFIED", "REJECTED"]),
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

export async function listUsers(req: Request, res: Response) {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const kyc = typeof req.query.kyc === "string" ? req.query.kyc.trim().toUpperCase() : "";

  const where: {
    kycStatus?: "PENDING" | "VERIFIED" | "REJECTED";
    OR?: Array<{ username?: { contains: string; mode: "insensitive" }; phoneNumber?: { contains: string; mode: "insensitive" } }>;
  } = {};

  if (kyc === "PENDING" || kyc === "VERIFIED" || kyc === "REJECTED") {
    where.kycStatus = kyc;
  }
  if (q) {
    where.OR = [
      { username: { contains: q, mode: "insensitive" } },
      { phoneNumber: { contains: q, mode: "insensitive" } },
    ];
  }

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      username: true,
      phoneNumber: true,
      role: true,
      kycStatus: true,
      createdAt: true,
      account: {
        select: { principalBalance: true, interestBalance: true },
      },
    },
    orderBy: [{ kycStatus: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return res.json(users);
}

export async function setUserKyc(req: Request, res: Response) {
  const { kycStatus } = req.body as z.infer<typeof setKycSchema>;
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) throw new AppError("User not found.", 404);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { kycStatus },
    select: {
      id: true,
      username: true,
      kycStatus: true,
      role: true,
    },
  });

  await writeAudit({
    userId: req.user!.id,
    action: "ADMIN_KYC_UPDATE",
    metadata: { targetUserId: user.id, username: user.username, kycStatus },
    ip: req.ip,
  });

  return res.json(updated);
}

export async function listDefaultCandidates(_req: Request, res: Response) {
  const list = await defaultSettlement.findDefaultCandidates();
  return res.json(
    list.map((l) => ({
      id: l.id,
      amount: l.amount,
      dueAt: l.dueAt,
      principalOwed: l.principalOwed,
      interestOwed: l.interestOwed,
      borrower: l.borrower,
      package: l.package
        ? { id: l.package.id, name: l.package.name, graceHours: l.package.graceHours }
        : null,
    })),
  );
}

export async function settleDefault(req: Request, res: Response) {
  const result = await defaultSettlement.settleDefaultedLoan({
    loanId: req.params.id,
    triggeredById: req.user!.id,
  });
  return res.json({
    loanId: result.loanId,
    status: result.status,
    collected: result.collected,
    uncollected: result.uncollected,
  });
}

export async function runAllDefaultSettlements(req: Request, res: Response) {
  const results = await defaultSettlement.runDefaultSettlements();
  await writeAudit({
    userId: req.user!.id,
    action: "LOAN_DEFAULT_SETTLE_BATCH",
    metadata: { count: results.length },
    ip: req.ip,
  });
  return res.json({ results });
}