export function fmt(amount: string | number | null | undefined): string {
  const n = Number(amount ?? 0);
  return "KSH " + n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function pct(amount: string | number | null | undefined): string {
  return Number(amount ?? 0).toFixed(2) + "%";
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
}

/** Extracts a user-facing message from anything `request()` might throw. */
export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
  if (err && typeof err === "object" && "message" in err) return String((err as Error).message);
  return fallback;
}
