import { Decimal } from "@prisma/client/runtime/library";

const DAY_MS = 86_400_000;

// Daily rate implied by a nominal annual rate, compounded daily.
// (1 + annualPct/100)^(1/365) - 1
export function annualToDaily(annualPct: number | Decimal): number {
  const a = Number(annualPct) / 100;
  return Math.pow(1 + a, 1 / 365) - 1;
}

// Compound interest earned on `principal` over `days` whole days at
// `dailyRate`. Returns a plain number in currency units — callers should
// wrap the result in `new Decimal(...)` before persisting.
export function compoundInterest(principal: Decimal | number, dailyRate: number, days: number): number {
  if (days <= 0) return 0;
  const p = Number(principal);
  if (p <= 0) return 0;
  return p * (Math.pow(1 + dailyRate, days) - 1);
}

export function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

// Round to 2dp using half-up rounding, consistent with how we display
// and store currency. Never use Math.round on raw floats for money in
// places that persist the result — always go through this.
export function roundMoney(n: number): Decimal {
  return new Decimal(n.toFixed(2));
}
