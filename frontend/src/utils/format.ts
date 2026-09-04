export function fmt(amount: string | number | null | undefined): string {
  const n = Number(amount ?? 0);
  return (
    "KSH " +
    n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

export function pct(amount: string | number | null | undefined): string {
  return Number(amount ?? 0).toFixed(2) + "%";
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDuration(hours: number): string {
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = hours / 24;
  if (Number.isInteger(days)) {
    if (days === 365) return "1 year";
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  return `${hours} hours`;
}

export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
  if (err && typeof err === "object" && "message" in err) return String((err as Error).message);
  return fallback;
}

/** Live-friendly remaining time until fundingClosesAt (or empty if none/expired). */
export function fundingCountdown(closesAt: string | null | undefined, nowMs = Date.now()): string {
  if (!closesAt) return "";
  const ms = new Date(closesAt).getTime() - nowMs;
  if (ms <= 0) return "Closed";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m left`;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s left`;
  if (mins > 0) return `${mins}m ${secs}s left`;
  return `${secs}s left`;
}

/** Format package funding window for admin display. */
export function formatFundingWindow(minutes: number | undefined | null, durationHours: number): string {
  const m = minutes ?? 4320;
  if (durationHours < 24) {
    return `${m} min funding window`;
  }
  const h = m / 60;
  if (Number.isInteger(h)) return `${h}h funding window`;
  return `${m} min funding window`;
}
