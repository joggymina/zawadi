import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as accountApi from "../api/account";
import * as loansApi from "../api/loans";
import * as publicApi from "../api/public";
import type { AccountSummary, Loan, AdminSettings, Offer } from "../api/types";
import { AmountModal } from "../components/AmountModal";
import { fmt, pct, errorMessage } from "../utils/format";
import { useToast } from "../context/ToastContext";

export function HomePage() {
  const showToast = useToast();
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [openLoans, setOpenLoans] = useState<Loan[]>([]);
  const [modal, setModal] = useState<"invest" | "withdraw" | null>(null);
  const [error, setError] = useState("");
  const [hidden, setHidden] = useState(false);

  const load = useCallback(async () => {
    try {
      const [acc, s, o, loans] = await Promise.all([
        accountApi.getMe(),
        publicApi.getPublicSettings(),
        publicApi.getPublicOffers(),
        loansApi.marketplace(),
      ]);
      setAccount(acc);
      setSettings(s);
      setOffers(o);
      setOpenLoans(loans.slice(0, 2));
    } catch (err) {
      setError(errorMessage(err, "Couldn't load your dashboard."));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <div style={{ padding: 20, color: "var(--rust)", fontSize: 13.5 }}>{error}</div>;
  if (!account || !settings) return <div style={{ padding: 20, color: "var(--ink-soft)" }}>Loading…</div>;

  const dailyRate = Math.pow(1 + Number(settings.investAnnualRatePct) / 100, 1 / 365) - 1;
  const projectedDaily = Number(account.principalBalance) * dailyRate;

  return (
    <div>
      <div style={{ background: `linear-gradient(160deg, var(--green), var(--green-deep))`, borderRadius: 20, padding: "22px 22px 26px", color: "#f4fbf4" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, opacity: 0.85 }}>
          Investment balance
          <button onClick={() => setHidden((h) => !h)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit" }} aria-label="Toggle balance visibility">
            {hidden ? "🙈" : "👁"}
          </button>
        </div>
        <div className="display" style={{ fontSize: 34, fontWeight: 600, marginTop: 6, letterSpacing: -0.5 }}>
          {hidden ? "KSH ••••••" : fmt(account.totalBalance)}
        </div>
        {!hidden && (
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
            Principal {fmt(account.principalBalance)} · Interest {fmt(account.interestBalance)}
          </div>
        )}

        <div style={{ display: "flex", gap: 22, marginTop: 18 }}>
          <div>
            <div style={{ fontSize: 11, opacity: 0.75 }}>Est. interest per day</div>
            <div className="mono" style={{ fontSize: 15, marginTop: 3 }}>{projectedDaily.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, opacity: 0.75 }}>Net rate p.a.</div>
            <div className="mono" style={{ fontSize: 15, marginTop: 3 }}>{pct(settings.investAnnualRatePct)}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button className="btn" style={{ flex: 1, background: "#f4fbf4", color: "var(--green-deep)" }} onClick={() => setModal("invest")}>Invest</button>
          <button className="btn" style={{ flex: 1, background: "rgba(244,251,244,0.14)", color: "#f4fbf4", border: "1px solid rgba(244,251,244,0.4)" }} onClick={() => setModal("withdraw")}>Withdraw</button>
        </div>
      </div>

      {offers.length > 0 && (
        <div style={{ display: "flex", gap: 10, overflowX: "auto", marginTop: 14, paddingBottom: 2 }}>
          {offers.map((o) => (
            <div key={o.id} style={{ minWidth: 220, background: "var(--amber-pale)", borderRadius: 14, padding: "12px 14px", flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>🎁 {o.title}</div>
              <div style={{ fontSize: 12, color: "#7a5a2e", marginTop: 4 }}>{o.description}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 22 }}>
        <div className="display" style={{ fontSize: 17, fontWeight: 500 }}>Borrow requests</div>
        <Link to="/loans" style={{ color: "var(--green)", fontSize: 13, textDecoration: "none" }}>See all</Link>
      </div>
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        {openLoans.length === 0 ? (
          <div className="card" style={{ padding: "16px 14px", fontSize: 13, color: "var(--ink-soft)" }}>
            No open loan requests right now.
          </div>
        ) : openLoans.map((l) => (
          <Link key={l.id} to="/loans" className="card" style={{ padding: "12px 14px", textDecoration: "none", color: "inherit", display: "block" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>@{l.borrower?.username}</span>
              <span className="mono" style={{ fontSize: 13.5 }}>{fmt(l.amount)}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>{l.purpose || "General purpose loan"} · {pct(l.interestRateApr)} p.a.</div>
          </Link>
        ))}
      </div>

      {modal === "invest" && (
        <AmountModal title="Invest" onClose={() => setModal(null)}
          onSubmit={async (amt) => { await accountApi.invest(amt); await load(); showToast(`Invested ${fmt(amt)}`); setModal(null); }} />
      )}
      {modal === "withdraw" && (
        <AmountModal title="Withdraw" balanceLabel={`Available balance: ${fmt(account.principalBalance)}`} onClose={() => setModal(null)}
          onSubmit={async (amt) => { await accountApi.withdraw(amt); await load(); showToast(`Withdrew ${fmt(amt)}`); setModal(null); }} />
      )}
    </div>
  );
}
