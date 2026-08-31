import { prisma } from "../lib/prisma";
import { Prisma } from "@prisma/client";

export async function writeAudit(params: {
  userId?: string | null;
  action: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        metadata: params.metadata ?? undefined,
        ip: params.ip ?? null,
      },
    });
  } catch (err) {
    // Never fail a money operation because auditing failed.
    // eslint-disable-next-line no-console
    console.error("audit log write failed", err);
  }
}