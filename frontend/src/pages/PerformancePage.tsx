import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as accountApi from "../api/account";
import * as publicApi from "../api/public";
import type { AccountSummary, AdminSettings, Transaction } from "../api/types";
import { fmt, pct, errorMessage } from "../utils/format";

type View = "day" | "month" | "year";

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function PerformancePage() {
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [view, setView] = useState<View>("day");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([accountApi.getMe(), publicApi.getPublicSettings(), accountApi.getTransactions()])
      .then(([a, s, t]) => {
        setAccount(a);
        setSettings(s);
        setTxs(t);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const interestAll = useMemo(
    () =>
      txs
        .filter((t) => t.type === "INTEREST")
        .reduce((s, t) => s + Number(t.amount), 0),
    [txs],
  );

  const interestThisMonth = useMemo(() => {
    const now = new Date();
    const key = monthKey(now);
    return txs
      .filter((t) => t.type === "INTEREST" && monthKey(new Date(t.createdAt)) === key)
      .reduce((s, t) => s + Number(t.amount), 0);
  }, [txs]);

  const grouped = useMemo(() => {
    const map = new Map<string, { month: string; invested: number; interest: number }>();
    for (const t of txs) {
      const d = new Date(t.createdAt);
      const key = monthKey(d);
      const label = d.toLocaleString(undefined, { month: "short", year: "numeric" });
      if (!map.has(key)) map.set(key, { month: label, invested: 0, interest: 0 });
      const row = map.get(key)!;
      if (t.type === "DEPOSIT") row.invested += Number(t.amount);
      if (t.type === "WITHDRAWAL") row.invested -= Number(t.amount);
      if (t.type === "INTEREST") row.interest += Number(t.amount);
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([, v]) => v)
      .slice(0, 12);
  }, [txs]);

  const maxInterest = Math.max(1, ...grouped.map((g) => g.interest));

  if (error) return <div style={{ padding: 20, color: "var(--rust)" }}>{error}</div>;
  if (!account || !settings)
    return <div style={{ padding: 20, color: "var(--ink-soft)" }}>Loading…</div>;

  const principal = Number(account.principalBalance);
  const dailyRate = Math.pow(1 + Number(settings.investAnnualRatePct) / 100, 1 / 365) - 1;
  const projections = {
    day: principal * dailyRate,
    month: principal * (Math.pow(1 + Number(settings.investAnnualRatePct) / 100, 1 / 12) - 1),
    year: principal * (Number(settings.investAnnualRatePct) / 100),
  };

  // What-if: if principal stayed for 30 more days at current rate
  const whatIf30 = principal * (Math.pow(1 + dailyRate, 30) - 1);

  return (
    <div>
      <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>
        Performance
      </div>
      <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 4 }}>
        Interest earned and projections on your current principal.
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          marginTop: 16,
        }}
      >
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Interest this month</div>
          <div className="mono" style={{ fontSize: 20, fontWeight: 600, color: "var(--green-deep)" }}>
            {fmt(interestThisMonth)}
          </div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Interest all time</div>
          <div className="mono" style={{ fontSize: 20, fontWeight: 600, color: "var(--green-deep)" }}>
            {fmt(interestAll)}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12, padding: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>If you leave your principal as is</div>
        <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 4 }}>
          About {fmt(whatIf30)} more interest over the next 30 days at {pct(settings.investAnnualRatePct)}{" "}
          p.a. (estimate, compounded daily).
        </div>
        <Link
          to="/"
          style={{ display: "inline-block", marginTop: 10, fontSize: 13, color: "var(--green-deep)" }}
        >
          Add to your balance →
        </Link>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        {(["day", "month", "year"] as View[]).map((v) => (
          <button
            key={v}
            type="button"
            className="btn"
            onClick={() => setView(v)}
            style={{
              flex: 1,
              fontSize: 13,
              background: v === view ? "var(--green-pale)" : "transparent",
              color: "var(--ink)",
              border: `1px solid ${v === view ? "var(--green)" : "var(--line)"}`,
            }}
          >
            {v === "day" ? "Per day" : v === "month" ? "Per month" : "Per year"}
          </button>
        ))}
      </div>
      <div
        style={{
          background: "var(--green-pale)",
          borderRadius: 14,
          padding: 16,
          marginTop: 10,
          textAlign: "center",
        }}
      >
        <div className="mono" style={{ fontSize: 22, color: "var(--green-deep)" }}>
          {fmt(projections[view])}
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>
          at {pct(settings.investAnnualRatePct)} p.a., compounded daily on your current principal
        </div>
      </div>

      {/* Simple interest bars */}
      {grouped.some((g) => g.interest > 0) && (
        <div className="card" style={{ marginTop: 18, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Interest by month</div>
          {grouped
            .filter((g) => g.interest > 0)
            .slice(0, 6)
            .reverse()
            .map((g) => (
              <div key={g.month} style={{ marginBottom: 10 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 12,
                    marginBottom: 4,
                  }}
                >
                  <span>{g.month}</span>
                  <span className="mono">{fmt(g.interest)}</span>
                </div>
                <div
                  style={{
                    height: 8,
                    borderRadius: 4,
                    background: "var(--line)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(6, (g.interest / maxInterest) * 100)}%`,
                      height: "100%",
                      background: "var(--green)",
                      borderRadius: 4,
                    }}
                  />
                </div>
              </div>
            ))}
        </div>
      )}

      <div
        style={{
          marginTop: 22,
          fontSize: 12,
          color: "var(--ink-soft)",
          display: "flex",
          justifyContent: "space-between",
          padding: "0 4px",
        }}
      >
        <span>MONTH</span>
        <span style={{ display: "flex", gap: 24 }}>
          <span>NET FLOW</span>
          <span>INTEREST</span>
        </span>
      </div>
      <div className="card" style={{ marginTop: 8, overflow: "hidden" }}>
        {grouped.length === 0 ? (
          <div style={{ padding: "18px 16px", color: "var(--ink-soft)", fontSize: 13 }}>
            No activity yet. Deposit to start earning.
          </div>
        ) : (
          grouped.map((m, i) => (
            <div
              key={m.month}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "13px 16px",
                borderTop: i === 0 ? "none" : "1px solid var(--line)",
                fontSize: 13.5,
              }}
            >
              <span>{m.month}</span>
              <span className="mono" style={{ display: "flex", gap: 24 }}>
                <span style={{ minWidth: 70, textAlign: "right" }}>{m.invested.toFixed(2)}</span>
                <span style={{ minWidth: 60, textAlign: "right", color: "var(--green)" }}>
                  {m.interest.toFixed(2)}
                </span>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
