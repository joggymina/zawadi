import { Decimal } from "@prisma/client/runtime/library";

const DAY_MS = 86_400_000;

// Daily rate implied by a nominal annual rate, compounded daily.
// Still used for investor account accrual (savings yield).
export function annualToDaily(annualPct: number | Decimal): number {
  const a = Number(annualPct) / 100;
  return Math.pow(1 + a, 1 / 365) - 1;
}

export function compoundInterest(principal: Decimal | number, dailyRate: number, days: number): number {
  if (days <= 0) return 0;
  const p = Number(principal);
  if (p <= 0) return 0;
  return p * (Math.pow(1 + dailyRate, days) - 1);
}

export function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

export function roundMoney(n: number): Decimal {
  return new Decimal(n.toFixed(2));
}

// ── Loan term interest (flat % of amount for the package) ───────────────

/** Full interest charged if the loan runs to the end of its package term. */
export function termInterestTotal(
  principal: Decimal | number,
  ratePct: Decimal | number,
): Decimal {
  const p = Number(principal);
  const r = Number(ratePct);
  if (p <= 0 || r <= 0) return new Decimal(0);
  return new Decimal(((p * r) / 100).toFixed(2));
}

/**
 * Duration of a package expressed in days (fractional OK).
 * Minimum 1 hour equivalent so sub-day packages still divide cleanly.
 */
export function packageDurationDays(durationHours: number): number {
  if (!durationHours || durationHours <= 0) return 1;
  return Math.max(durationHours / 24, 1 / 24);
}

/**
 * Linear interest due after `elapsedHours`, capped at the full term interest.
 * Early repayment uses this so borrowers only pay for time used.
 */
export function linearInterestDue(params: {
  principal: Decimal | number;
  ratePct: Decimal | number;
  durationHours: number;
  elapsedHours: number;
}): Decimal {
  const total = termInterestTotal(params.principal, params.ratePct);
  if (total.lessThanOrEqualTo(0)) return new Decimal(0);
  const dur = params.durationHours > 0 ? params.durationHours : 24;
  const fraction = Math.min(1, Math.max(0, params.elapsedHours / dur));
  return total.mul(fraction).toDecimalPlaces(2);
}

/**
 * Interest to add for `wholeDays` of daily accrual:
 * (total term interest / durationDays) * wholeDays, not exceeding remaining room to total.
 */
export function dailyTermAccrualSlice(params: {
  principal: Decimal | number;
  ratePct: Decimal | number;
  durationHours: number;
  wholeDays: number;
  interestAlreadyOwed: Decimal | number;
}): Decimal {
  const total = termInterestTotal(params.principal, params.ratePct);
  const already = new Decimal(params.interestAlreadyOwed);
  const remaining = total.minus(already);
  if (remaining.lessThanOrEqualTo(0) || params.wholeDays <= 0) return new Decimal(0);

  const daysInTerm = packageDurationDays(params.durationHours);
  const perDay = total.div(daysInTerm);
  const gained = perDay.mul(params.wholeDays).toDecimalPlaces(2);
  return gained.greaterThan(remaining) ? remaining : gained;
}
