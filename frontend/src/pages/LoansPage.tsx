import { useCallback, useEffect, useState } from "react";
import * as loansApi from "../api/loans";
import * as accountApi from "../api/account";
import * as publicApi from "../api/public";
import type { Loan, AccountSummary, AdminSettings } from "../api/types";
import { AmountModal } from "../components/AmountModal";
import { fmt, pct, errorMessage } from "../utils/format";
import { useToast } from "../context/ToastContext";
import { NewLoanModal } from "../components/NewLoanModal";

export function LoansPage() {
  const showToast = useToast();
  const [sub, setSub] = useState<"marketplace" | "mine">("marketplace");
  const [marketLoans, setMarketLoans] = useState<Loan[]>([]);
  const [myLoans, setMyLoans] = useState<Loan[]>([]);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [error, setError] = useState("");
  const [fundModal, setFundModal] = useState<Loan | null>(null);
  const [repayModal, setRepayModal] = useState<Loan | null>(null);
  const [newLoanOpen, setNewLoanOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [market, mine, acc, s] = await Promise.all([
        loansApi.marketplace(), loansApi.mine(), accountApi.getMe(), publicApi.getPublicSettings(),
      ]);
      setMarketLoans(market);
      setMyLoans(mine);
      setAccount(acc);
      setSettings(s);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <div style={{ padding: 20, color: "var(--rust)", fontSize: 13.5 }}>{error}</div>;
  if (!account || !settings) return <div style={{ padding: 20, color: "var(--ink-soft)" }}>Loading…</div>;

  return (
    <div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" onClick={() => setSub("marketplace")} style={{ flex: 1, background: sub === "marketplace" ? "var(--green)" : "transparent", color: sub === "marketplace" ? "#f4fbf4" : "var(--ink)", border: `1px solid ${sub === "marketplace" ? "var(--green)" : "var(--line)"}` }}>
          Fund a loan
        </button>
        <button className="btn" onClick={() => setSub("mine")} style={{ flex: 1, background: sub === "mine" ? "var(--green)" : "transparent", color: sub === "mine" ? "#f4fbf4" : "var(--ink)", border: `1px solid ${sub === "mine" ? "var(--green)" : "var(--line)"}` }}>
          My requests
        </button>
      </div>

      {sub === "marketplace" && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {marketLoans.length === 0 ? (
            <div className="card" style={{ padding: "18px 16px", fontSize: 13, color: "var(--ink-soft)" }}>No open loan requests right now.</div>
          ) : marketLoans.map((l) => {
            const progress = Math.min(100, Math.round((Number(l.fundedAmount) / Number(l.amount)) * 100));
            return (
              <div key={l.id} className="card" style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>@{l.borrower?.username}</span>
                  <span className="mono" style={{ fontSize: 14 }}>{fmt(l.amount)}</span>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 4 }}>{l.purpose || "General purpose loan"}</div>
                <div style={{ fontSize: 12, color: "var(--green-deep)", marginTop: 8 }}>
                  🛡 {l.guarantors.length}/{settings.guarantorsRequired} guarantors verified · {pct(l.interestRateApr)} p.a.
                </div>
                <div style={{ height: 5, background: "var(--line)", borderRadius: 999, marginTop: 8, overflow: "hidden" }}>
                  <div style={{ width: `${progress}%`, height: "100%", background: "var(--green)" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                  <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{fmt(Number(l.amount) - Number(l.fundedAmount))} still needed</span>
                  <button className="btn btn-primary" style={{ padding: "7px 16px", fontSize: 12.5 }} onClick={() => setFundModal(l)}>Fund</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {sub === "mine" && (
        <div style={{ marginTop: 16 }}>
          <button className="btn btn-primary-deep" style={{ width: "100%", padding: "12px 0", fontSize: 14 }} onClick={() => setNewLoanOpen(true)}>
            💰 Request a loan
          </button>
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {myLoans.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>You haven't requested a loan yet.</div>
            ) : myLoans.map((l) => {
              const outstanding = Number(l.principalOwed) + Number(l.interestOwed);
              const statusMeta = l.status === "OPEN"
                ? { label: "Open for funding", bg: "var(--amber-pale)", fg: "#7a5a2e" }
                : l.status === "REPAYING"
                ? { label: "Repaying", bg: "#e6f0fb", fg: "#0c447c" }
                : l.status === "REPAID"
                ? { label: "Fully repaid", bg: "var(--green-pale)", fg: "var(--green-deep)" }
                : { label: l.status, bg: "var(--line)", fg: "var(--ink-soft)" };
              return (
                <div key={l.id} className="card" style={{ padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span className="mono" style={{ fontSize: 14 }}>{fmt(l.amount)}</span>
                    <span className="badge" style={{ background: statusMeta.bg, color: statusMeta.fg }}>{statusMeta.label}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 4 }}>{l.purpose || "General purpose loan"}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 6 }}>
                    Guarantors: {l.guarantors.map((g) => "@" + (g.user?.username ?? g.userId)).join(", ")}
                  </div>

                  {(l.status === "REPAYING" || l.status === "REPAID") && (
                    <div style={{ marginTop: 10, background: "var(--bg)", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                        <span style={{ color: "var(--ink-soft)" }}>Outstanding balance</span>
                        <span className="mono">{fmt(outstanding)}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 4 }}>
                        Principal {fmt(l.principalOwed)} + interest {fmt(l.interestOwed)}
                      </div>
                      {l.status === "REPAYING" && (
                        <button className="btn btn-primary" style={{ width: "100%", marginTop: 10, padding: "9px 0", fontSize: 12.5 }} onClick={() => setRepayModal(l)}>
                          Make a repayment
                        </button>
                      )}
                      {(l.repayments?.length ?? 0) > 0 && (
                        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                          {l.repayments!.map((r) => {
                            const badge = r.status === "APPROVED"
                              ? { label: "Credited to funders", bg: "var(--green-pale)", fg: "var(--green-deep)" }
                              : r.status === "REJECTED"
                              ? { label: "Rejected · refunded", bg: "var(--rust-pale)", fg: "var(--rust)" }
                              : { label: "Awaiting admin approval", bg: "var(--amber-pale)", fg: "#7a5a2e" };
                            return (
                              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
                                <span style={{ color: "var(--ink-soft)" }}>{fmt(r.amount)}</span>
                                <span className="badge" style={{ background: badge.bg, color: badge.fg }}>{badge.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {fundModal && (
        <AmountModal title="Fund this loan" balanceLabel={`Your available balance: ${fmt(account.principalBalance)}`}
          onClose={() => setFundModal(null)}
          onSubmit={async (amt) => { await loansApi.fund(fundModal.id, amt); await load(); showToast(`Funded ${fmt(amt)} toward ${fundModal.borrower?.username}'s loan`); setFundModal(null); }} />
      )}
      {repayModal && (
        <AmountModal title="Repay loan" balanceLabel={`Outstanding: ${fmt(Number(repayModal.principalOwed) + Number(repayModal.interestOwed))}`}
          onClose={() => setRepayModal(null)}
          onSubmit={async (amt) => { await loansApi.repay(repayModal.id, amt); await load(); showToast(`Repaid ${fmt(amt)} — awaiting admin approval`); setRepayModal(null); }} />
      )}
      {newLoanOpen && (
        <NewLoanModal settings={settings} onClose={() => setNewLoanOpen(false)}
          onSubmit={async (params) => { await loansApi.createLoan(params); await load(); showToast("Loan request published"); setNewLoanOpen(false); }} />
      )}
    </div>
  );
}
