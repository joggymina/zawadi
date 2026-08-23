import { useEffect, useMemo, useState } from "react";
import * as accountApi from "../api/account";
import * as publicApi from "../api/public";
import type { AccountSummary, AdminSettings, Transaction } from "../api/types";
import { fmt, pct, shortDate, errorMessage } from "../utils/format";

export function creditColor(type: Transaction["type"]) {
  const creditTypes = new Set(["DEPOSIT", "INTEREST", "LOAN_RETURN", "LOAN_DISBURSEMENT", "ADJUSTMENT"]);
  return creditTypes.has(type) ? "var(--green)" : "var(--rust)";
}

export function PerformancePage() {
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [view, setView] = useState<"day" | "month" | "year">("month");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [acc, s, t] = await Promise.all([accountApi.getMe(), publicApi.getPublicSettings(), accountApi.getTransactions()]);
        setAccount(acc);
        setSettings(s);
        setTxs(t);
      } catch (err) {
        setError(errorMessage(err));
      }
    })();
  }, []);

  const grouped = useMemo(() => {
    const map: Record<string, { invested: number; interest: number }> = {};
    for (const t of txs) {
      const key = shortDate(t.createdAt).split(" ").slice(1).join(" "); // "Mon YYYY"
      if (!map[key]) map[key] = { invested: 0, interest: 0 };
      const amt = Number(t.amount);
      if (t.type === "DEPOSIT" || t.type === "LOAN_RETURN" || t.type === "LOAN_DISBURSEMENT") map[key].invested += amt;
      if (t.type === "WITHDRAWAL" || t.type === "LOAN_FUND" || t.type === "LOAN_REPAYMENT") map[key].invested -= amt;
      if (t.type === "INTEREST") map[key].interest += amt;
    }
    return Object.entries(map).map(([month, v]) => ({ month, ...v }));
  }, [txs]);

  if (error) return <div style={{ padding: 20, color: "var(--rust)", fontSize: 13.5 }}>{error}</div>;
  if (!account || !settings) return <div style={{ padding: 20, color: "var(--ink-soft)" }}>Loading…</div>;

  const dailyRate = Math.pow(1 + Number(settings.investAnnualRatePct) / 100, 1 / 365) - 1;
  const principal = Number(account.principalBalance);
  const projections = {
    day: principal * (Math.pow(1 + dailyRate, 1) - 1),
    month: principal * (Math.pow(1 + dailyRate, 30) - 1),
    year: principal * (Math.pow(1 + dailyRate, 365) - 1),
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 10 }}>
        <div className="card" style={{ flex: 1, padding: "14px 16px" }}>
          <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Principal</div>
          <div className="mono" style={{ fontSize: 17, marginTop: 6 }}>{fmt(account.principalBalance)}</div>
        </div>
        <div style={{ flex: 1, padding: "14px 16px", background: "var(--green-pale)", borderRadius: 14 }}>
          <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Interest earned</div>
          <div className="mono" style={{ fontSize: 17, marginTop: 6, color: "var(--green-deep)" }}>{fmt(account.interestBalance)}</div>
        </div>
      </div>

      <div className="display" style={{ fontSize: 16, fontWeight: 500, marginTop: 18 }}>Projected interest</div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        {(["day", "month", "year"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className="btn" style={{
            flex: 1, background: v === view ? "var(--green)" : "transparent",
            color: v === view ? "#f4fbf4" : "var(--ink)", border: `1px solid ${v === view ? "var(--green)" : "var(--line)"}`,
          }}>
            {v === "day" ? "Per day" : v === "month" ? "Per month" : "Per year"}
          </button>
        ))}
      </div>
      <div style={{ background: "var(--green-pale)", borderRadius: 14, padding: 16, marginTop: 10, textAlign: "center" }}>
        <div className="mono" style={{ fontSize: 22, color: "var(--green-deep)" }}>{fmt(projections[view])}</div>
        <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>
          at {pct(settings.investAnnualRatePct)} p.a., compounded daily on your current principal
        </div>
      </div>

      <div style={{ marginTop: 22, fontSize: 12, color: "var(--ink-soft)", display: "flex", justifyContent: "space-between", padding: "0 4px" }}>
        <span>MONTH</span>
        <span style={{ display: "flex", gap: 24 }}><span>NET FLOW</span><span>INTEREST</span></span>
      </div>
      <div className="card" style={{ marginTop: 8, overflow: "hidden" }}>
        {grouped.length === 0 ? (
          <div style={{ padding: "18px 16px", color: "var(--ink-soft)", fontSize: 13 }}>No activity yet.</div>
        ) : grouped.map((m, i) => (
          <div key={m.month} style={{ display: "flex", justifyContent: "space-between", padding: "13px 16px", borderTop: i === 0 ? "none" : "1px solid var(--line)", fontSize: 13.5 }}>
            <span>{m.month}</span>
            <span className="mono" style={{ display: "flex", gap: 24 }}>
              <span style={{ minWidth: 70, textAlign: "right" }}>{m.invested.toFixed(2)}</span>
              <span style={{ minWidth: 60, textAlign: "right", color: "var(--green)" }}>{m.interest.toFixed(2)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
