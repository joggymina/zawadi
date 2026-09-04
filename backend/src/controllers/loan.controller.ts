import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import * as loanService from "../services/loan.service";
import { writeAudit } from "../services/audit.service";
import { assertCreateLoanAllowed, assertFundAllowed } from "../services/kycLimits.service";

export const createLoanSchema = z.object({
  amount: z.number().positive().max(10_000_000),
  purpose: z.string().max(200).optional(),
  guarantorUsernames: z.array(z.string()).min(1).max(20),
  packageId: z.string().min(1),
});

export const fundLoanSchema = z.object({ amount: z.number().positive() });
export const repayLoanSchema = z.object({ amount: z.number().positive() });
export const guarantorResponseSchema = z.object({ accept: z.boolean() });

export async function createLoan(req: Request, res: Response) {
  const body = req.body as z.infer<typeof createLoanSchema>;
  await assertCreateLoanAllowed(req.user!.id, body.amount);
  const loan = await loanService.createLoanRequest({
    borrowerId: req.user!.id,
    amount: body.amount,
    purpose: body.purpose,
    guarantorUsernames: body.guarantorUsernames,
    packageId: body.packageId,
  });
  await writeAudit({
    userId: req.user!.id,
    action: "LOAN_CREATE",
    metadata: {
      loanId: loan.id,
      amount: body.amount,
      packageId: body.packageId,
      guarantors: body.guarantorUsernames,
    },
    ip: req.ip,
  });
  return res.status(201).json(loan);
}

export async function listMarketplace(req: Request, res: Response) {
  const now = new Date();
  const loans = await prisma.loan.findMany({
    where: {
      status: "OPEN",
      borrowerId: { not: req.user!.id },
      OR: [{ fundingClosesAt: null }, { fundingClosesAt: { gt: now } }],
    },
    include: {
      package: true,
      guarantors: { include: { user: { select: { username: true } } } },
      borrower: { select: { username: true } },
      fundings: {
        include: { funder: { select: { username: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json(loans);
}

export async function listMine(req: Request, res: Response) {
  const loans = await prisma.loan.findMany({
    where: { borrowerId: req.user!.id },
    include: {
      package: true,
      guarantors: { include: { user: { select: { username: true } } } },
      fundings: {
        include: { funder: { select: { username: true } } },
        orderBy: { createdAt: "asc" },
      },
      repayments: {
        include: { distributions: true },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json(loans);
}

export async function listFunded(req: Request, res: Response) {
  const fundings = await prisma.loanFunding.findMany({
    where: { funderId: req.user!.id },
    orderBy: { createdAt: "desc" },
    include: {
      loan: {
        include: {
          package: true,
          borrower: { select: { username: true } },
          guarantors: { include: { user: { select: { username: true } } } },
          fundings: {
            include: { funder: { select: { username: true } } },
            orderBy: { createdAt: "asc" },
          },
          repayments: {
            orderBy: { createdAt: "desc" },
            include: {
              distributions: { where: { funderId: req.user!.id } },
            },
          },
        },
      },
    },
  });
  return res.json(
    fundings.map((f) => ({
      fundingId: f.id,
      myAmount: f.amount,
      fundedAt: f.createdAt,
      loan: f.loan,
    })),
  );
}

export async function listPendingGuarantees(req: Request, res: Response) {
  const rows = await loanService.listPendingGuarantees(req.user!.id);
  return res.json(rows);
}

export async function respondGuarantor(req: Request, res: Response) {
  const { accept } = req.body as z.infer<typeof guarantorResponseSchema>;
  const result = await loanService.respondAsGuarantor({
    loanId: req.params.id,
    guarantorId: req.user!.id,
    accept,
  });
  await writeAudit({
    userId: req.user!.id,
    action: accept ? "GUARANTOR_ACCEPT" : "GUARANTOR_DECLINE",
    metadata: { loanId: req.params.id, result: result.status },
    ip: req.ip,
  });
  return res.json(result);
}

export async function fund(req: Request, res: Response) {
  const { amount } = req.body as z.infer<typeof fundLoanSchema>;
  await assertFundAllowed(req.user!.id, amount);
  const loan = await loanService.fundLoan({
    loanId: req.params.id,
    funderId: req.user!.id,
    amount,
  });
  await writeAudit({
    userId: req.user!.id,
    action: "LOAN_FUND",
    metadata: { loanId: loan.id, amount, status: loan.status },
    ip: req.ip,
  });
  return res.json(loan);
}

export async function repay(req: Request, res: Response) {
  const { amount } = req.body as z.infer<typeof repayLoanSchema>;
  const repayment = await loanService.repayLoan({
    loanId: req.params.id,
    borrowerId: req.user!.id,
    amount,
  });
  await writeAudit({
    userId: req.user!.id,
    action: "LOAN_REPAY",
    metadata: { loanId: req.params.id, repaymentId: repayment.id, amount },
    ip: req.ip,
  });
  return res.json(repayment);
}