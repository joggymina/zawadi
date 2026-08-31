import { prisma } from "../lib/prisma";

// Simple in-process cache — settings change rarely, but are read on
// nearly every loan/interest calculation. Invalidated on every write.
let cached: Awaited<ReturnType<typeof fetchFromDb>> | null = null;

async function fetchFromDb() {
  return prisma.adminSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}

export async function getAdminSettings() {
  if (!cached) cached = await fetchFromDb();
  return cached;
}

export async function updateAdminSettings(data: Partial<{
  investAnnualRatePct: number;
  loanAnnualRatePct: number;
  guarantorsRequired: number;
  guarantorCoverageExtraPct: number;
}>) {
  cached = await prisma.adminSettings.update({ where: { id: 1 }, data });
  return cached;
}
