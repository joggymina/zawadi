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