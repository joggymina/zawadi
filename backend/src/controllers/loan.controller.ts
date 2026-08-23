import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import * as loanService from "../services/loan.service";

export const createLoanSchema = z.object({
  amount: z.number().positive().max(10_000_000),
  purpose: z.string().max(200).optional(),
  guarantorUsernames: z.array(z.string()).min(1).max(20),
});

export const fundLoanSchema = z.object({ amount: z.number().positive() });
export const repayLoanSchema = z.object({ amount: z.number().positive() });

export async function createLoan(req: Request, res: Response) {
  const body = req.body as z.infer<typeof createLoanSchema>;
  const loan = await loanService.createLoanRequest({
    borrowerId: req.user!.id,
    amount: body.amount,
    purpose: body.purpose,
    guarantorUsernames: body.guarantorUsernames,
  });
  return res.status(201).json(loan);
}

export async function listMarketplace(req: Request, res: Response) {
  const loans = await prisma.loan.findMany({
    where: { status: "OPEN", borrowerId: { not: req.user!.id } },
    include: { guarantors: { include: { user: { select: { username: true } } } }, borrower: { select: { username: true } } },
    orderBy: { createdAt: "desc" },
  });
  return res.json(loans);
}

export async function listMine(req: Request, res: Response) {
  const loans = await prisma.loan.findMany({
    where: { borrowerId: req.user!.id },
    include: {
      guarantors: { include: { user: { select: { username: true } } } },
      repayments: { include: { distributions: true }, orderBy: { createdAt: "desc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json(loans);
}

export async function fund(req: Request, res: Response) {
  const { amount } = req.body as z.infer<typeof fundLoanSchema>;
  const loan = await loanService.fundLoan({ loanId: req.params.id, funderId: req.user!.id, amount });
  return res.json(loan);
}

export async function repay(req: Request, res: Response) {
  const { amount } = req.body as z.infer<typeof repayLoanSchema>;
  const repayment = await loanService.repayLoan({ loanId: req.params.id, borrowerId: req.user!.id, amount });
  return res.json(repayment);
}
