import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { writeAudit } from "../services/audit.service";

export const packageSchema = z.object({
  name: z.string().min(1).max(80),
  durationHours: z.number().int().positive().max(24 * 365 * 5),
  graceHours: z.number().int().min(0).max(24 * 90).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export async function listPublicPackages(_req: Request, res: Response) {
  const packages = await prisma.loanPackage.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });
  return res.json(packages);
}

export async function listAdminPackages(_req: Request, res: Response) {
  const packages = await prisma.loanPackage.findMany({
    orderBy: { sortOrder: "asc" },
  });
  return res.json(packages);
}

export async function createPackage(req: Request, res: Response) {
  const body = req.body as z.infer<typeof packageSchema>;
  const pkg = await prisma.loanPackage.create({
    data: {
      name: body.name,
      durationHours: body.durationHours,
      graceHours: body.graceHours ?? 0,
      active: body.active ?? true,
      sortOrder: body.sortOrder ?? 0,
    },
  });
  await writeAudit({
    userId: req.user!.id,
    action: "ADMIN_PACKAGE_CREATE",
    metadata: { id: pkg.id, name: pkg.name },
    ip: req.ip,
  });
  return res.status(201).json(pkg);
}

export async function updatePackage(req: Request, res: Response) {
  const body = req.body as z.infer<typeof packageSchema>;
  const existing = await prisma.loanPackage.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new AppError("Package not found.", 404);

  const pkg = await prisma.loanPackage.update({
    where: { id: req.params.id },
    data: {
      name: body.name,
      durationHours: body.durationHours,
      graceHours: body.graceHours ?? existing.graceHours,
      active: body.active ?? existing.active,
      sortOrder: body.sortOrder ?? existing.sortOrder,
    },
  });
  await writeAudit({
    userId: req.user!.id,
    action: "ADMIN_PACKAGE_UPDATE",
    metadata: { id: pkg.id },
    ip: req.ip,
  });
  return res.json(pkg);
}

export async function deletePackage(req: Request, res: Response) {
  const existing = await prisma.loanPackage.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new AppError("Package not found.", 404);

  await prisma.loanPackage.update({
    where: { id: req.params.id },
    data: { active: false },
  });
  await writeAudit({
    userId: req.user!.id,
    action: "ADMIN_PACKAGE_DEACTIVATE",
    metadata: { id: req.params.id },
    ip: req.ip,
  });
  return res.status(204).send();
}