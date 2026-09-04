import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as adminApi from "../api/admin";
import type { LoanRepayment } from "../api/types";
import { fmt, errorMessage } from "../utils/format";
import { useToast } from "../context/ToastContext";

type DefaultCandidate = {
  id: string;
  amount: string;
  dueAt: string | null;
  principalOwed: string;
  interestOwed: string;
  borrower?: { id: string; username: string };
  package?: { id: string; name: string; graceHours: number } | null;
};

type ConfirmState =
  | null
  | {
      title: string;
      body: string;
      confirmLabel: string;
      onConfirm: () => Promise<void>;
    };

export function AdminPage() {
  const showToast = useToast();
  const [pending, setPending] = useState<LoanRepayment[]>([]);
  const [defaults, setDefaults] = useState<DefaultCandidate[]>([]);
  const [fundingClosed, setFundingClosed] = useState<
    Awaited<ReturnType<typeof adminApi.listFundingWindowClosed>>
  >([]);
  const [platformBal, setPlatformBal] = useState<{
    principalBalance: string;
    lifetimeInflow: string;
    lifetimeOutflow: string;
  } | null>(null);
  const [topUpAmt, setTopUpAmt] = useState("");
  /** loanId → which panel is open: null | "extend" | "fund" */
  const [closedPanel, setClosedPanel] = useState<Record<string, "extend" | "fund" | null>>({});
  const [extendHours, setExtendHours] = useState<Record<string, string>>({});
  const [extendMins, setExtendMins] = useState<Record<string, string>>({});
  const [fundAmounts, setFundAmounts] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [pendingList, defaultList, closedList, plat] = await Promise.all([
        adminApi.listPendingRepayments(),
        adminApi.listDefaultCandidates(),
        adminApi.listFundingWindowClosed().catch(() => []),
        adminApi.getPlatformAccount().catch(() => null),
      ]);
      setPending(pendingList);
      setDefaults(defaultList);
      setFundingClosed(closedList);
      setPlatformBal(plat);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function runConfirm() {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      await confirm.onConfirm();
      setConfirm(null);
    } catch (err) {
      showToast(errorMessage(err));
    } finally {
      setConfirmBusy(false);
    }
  }

  function approve(id: string) {
    setConfirm({
      title: "Approve repayment?",
      body: "Funders will be credited immediately.",
      confirmLabel: "Approve",
      onConfirm: async () => {
        await adminApi.approveRepayment(id);
        setPending((p) => p.filter((r) => r.id !== id));
        showToast("Approved — funders credited");
      },
    });
  }

  function reject(id: string) {
    setConfirm({
      title: "Reject repayment?",
      body: "The borrower will be refunded.",
      confirmLabel: "Reject",
      onConfirm: async () => {
        await adminApi.rejectRepayment(id);
        setPending((p) => p.filter((r) => r.id !== id));
        showToast("Rejected — borrower refunded");
      },
    });
  }

  function settleOne(loanId: string) {
    setConfirm({
      title: "Settle this default?",
      body: "Borrower balance, then guarantor holds, will be used to credit funders. This cannot be undone.",
      confirmLabel: "Settle default",
      onConfirm: async () => {
        const r = await adminApi.settleDefault(loanId);
        showToast(`Settled → ${r.status}`);
        await load();
      },
    });
  }

  function settleAll() {
    setConfirm({
      title: "Settle all past-due loans?",
      body: `Run default settlement for ${defaults.length} loan(s). Borrower and guarantor funds may be drawn.`,
      confirmLabel: "Settle all",
      onConfirm: async () => {
        await adminApi.runAllDefaultSettlements();
        showToast("Default settlement run finished");
        await load();
      },
    });
  }

  function toggleClosedPanel(loanId: string, panel: "extend" | "fund") {
    setClosedPanel((prev) => ({
      ...prev,
      [loanId]: prev[loanId] === panel ? null : panel,
    }));
  }

  function submitExtend(loanId: string, borrower: string) {
    const h = parseInt(extendHours[loanId] ?? "0", 10) || 0;
    const m = parseInt(extendMins[loanId] ?? "0", 10) || 0;
    const extraMinutes = h * 60 + m;
    if (extraMinutes < 1) {
      showToast("Enter at least 1 minute to extend");
      return;
    }
    const parts: string[] = [];
    if (h > 0) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
    if (m > 0) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
    const label = parts.join(" ");
    setConfirm({
      title: "Extend funding window?",
      body: `Put @${borrower}'s loan back on the marketplace for ${label}. Members can fund again until the new close time.`,
      confirmLabel: "Extend",
      onConfirm: async () => {
        await adminApi.extendFundingWindow(loanId, extraMinutes);
        showToast(`Funding window extended by ${label}`);
        setClosedPanel((p) => ({ ...p, [loanId]: null }));
        await load();
      },
    });
  }

  function submitAdminFund(loanId: string, borrower: string, remaining: number) {
    const raw = fundAmounts[loanId] ?? String(remaining);
    const amount = parseFloat(raw);
    if (Number.isNaN(amount) || amount <= 0) {
      showToast("Enter a valid fund amount");
      return;
    }
    if (amount > remaining + 0.001) {
      showToast(`Only ${fmt(remaining)} still needed`);
      return;
    }
    setConfirm({
      title: "Fund this loan?",
      body: `Fund ${fmt(amount)} toward @${borrower}'s loan from the platform account. When the loan is fully funded, the full loan amount is credited to the borrower.`,
      confirmLabel: "Fund",
      onConfirm: async () => {
        const updated = await adminApi.adminFundClosedLoan(loanId, amount);
        showToast(
          updated.status === "REPAYING"
            ? `Fully funded — loan is now repaying`
            : `Funded ${fmt(amount)}`,
        );
        setClosedPanel((p) => ({ ...p, [loanId]: null }));
        await load();
      },
    });
  }

  if (error) {
    return (
      <div style={{ padding: 20, color: "var(--rust)", fontSize: 13.5 }}>{error}</div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 20, color: "var(--ink-soft)" }}>Loading…</div>
    );
  }

  const card = (to: string, title: string, subtitle: string) => (
    <Link
      to={to}
      className="card"
      style={{
        display: "block",
        padding: "14px 16px",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 500 }}>{title}</div>
      <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>{subtitle}</div>
    </Link>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {confirm && (
        <div
          className="modal-backdrop"
          style={{ zIndex: 1000 }}
          onClick={() => !confirmBusy && setConfirm(null)}
        >
          <div
            className="modal-sheet"
            style={{ maxWidth: 400 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="display" style={{ fontSize: 17, fontWeight: 500 }}>
              {confirm.title}
            </div>
            <div style={{ marginTop: 12, fontSize: 13.5, color: "var(--ink-soft)" }}>
              {confirm.body}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <button
                className="btn btn-outline"
                style={{ flex: 1, padding: "10px 0" }}
                disabled={confirmBusy}
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1, padding: "10px 0" }}
                disabled={confirmBusy}
                onClick={runConfirm}
              >
                {confirmBusy ? "Saving…" : confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      <section>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <div className="display" style={{ fontSize: 16, fontWeight: 500 }}>
            Past-due loans
          </div>
          {defaults.length > 0 && (
            <button
              className="btn btn-outline"
              style={{ padding: "6px 12px", fontSize: 12 }}
              onClick={settleAll}
            >
              Settle all
            </button>
          )}
        </div>
        {defaults.length === 0 ? (
          <div
            style={{
              fontSize: 12.5,
              color: "var(--ink-soft)",
              background: "var(--surface)",
              borderRadius: 10,
              padding: 12,
            }}
          >
            No loans past due + grace.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {defaults.map((l) => (
              <div key={l.id} className="card" style={{ padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>@{l.borrower?.username}</span>
                  <span className="mono">{fmt(l.amount)}</span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 4 }}>
                  Due {l.dueAt ? new Date(l.dueAt).toLocaleString() : "—"}
                  {l.package ? ` · ${l.package.name}` : ""}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 2 }}>
                  Outstanding {fmt(Number(l.principalOwed) + Number(l.interestOwed))}
                </div>
                <button
                  className="btn btn-primary"
                  style={{ width: "100%", marginTop: 8, padding: "8px 0", fontSize: 12.5 }}
                  onClick={() => settleOne(l.id)}
                >
                  Settle default
                </button>
              </div>
            ))}
          </div>
        )}
      </section>


      <section>
        <div className="display" style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
          Platform account
        </div>
        <div className="card" style={{ padding: "12px 14px", marginBottom: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Available balance</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 600 }}>
                {platformBal ? fmt(platformBal.principalBalance) : "—"}
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-soft)", textAlign: "right" }}>
              <div>Lifetime in: {platformBal ? fmt(platformBal.lifetimeInflow) : "—"}</div>
              <div>Lifetime out: {platformBal ? fmt(platformBal.lifetimeOutflow) : "—"}</div>
            </div>
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              className="field-input mono"
              type="number"
              min={0}
              step="0.01"
              placeholder="Top-up amount"
              value={topUpAmt}
              onChange={(e) => setTopUpAmt(e.target.value)}
              style={{ width: 140, padding: "8px 10px", fontSize: 13 }}
            />
            <button
              className="btn btn-outline"
              style={{ padding: "8px 12px", fontSize: 12.5 }}
              onClick={() => {
                const amt = parseFloat(topUpAmt);
                if (Number.isNaN(amt) || amt <= 0) {
                  showToast("Enter a valid top-up amount");
                  return;
                }
                setConfirm({
                  title: "Top up platform account?",
                  body: `Add ${fmt(amt)} to the platform treasury. Use this for residual funding of closed-window loans.`,
                  confirmLabel: "Top up",
                  onConfirm: async () => {
                    await adminApi.topUpPlatform(amt);
                    showToast(`Platform topped up by ${fmt(amt)}`);
                    setTopUpAmt("");
                    await load();
                  },
                });
              }}
            >
              Top up
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 8 }}>
            Closed-window residual funding draws from this balance — not an admin personal account. Graphs and fee breakdown come later.
          </div>
        </div>
      </section>

      <section>
        <div className="display" style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
          Funding window closed
        </div>
        {fundingClosed.length === 0 ? (
          <div
            style={{
              fontSize: 12.5,
              color: "var(--ink-soft)",
              background: "var(--surface)",
              borderRadius: 10,
              padding: 12,
            }}
          >
            No open loans past their funding window.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {fundingClosed.map((l) => {
              const remaining = Math.max(0, Number(l.amount) - Number(l.fundedAmount));
              const panel = closedPanel[l.id] ?? null;
              const borrower = l.borrower?.username ?? "borrower";
              return (
                <div key={l.id} className="card" style={{ padding: "10px 12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span>@{borrower}</span>
                    <span className="mono">
                      {fmt(l.fundedAmount)} / {fmt(l.amount)}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 4 }}>
                    {l.package?.name ?? "Package"} · closed{" "}
                    {l.fundingClosesAt ? new Date(l.fundingClosesAt).toLocaleString() : "—"}
                    {remaining > 0 ? ` · ${fmt(remaining)} still needed` : ""}
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <button
                      className="btn btn-outline"
                      style={{ padding: "7px 12px", fontSize: 12 }}
                      onClick={() => toggleClosedPanel(l.id, "extend")}
                    >
                      {panel === "extend" ? "Hide extend ▴" : "Extend window ▾"}
                    </button>
                    {remaining > 0 && (
                      <button
                        className="btn btn-primary"
                        style={{ padding: "7px 12px", fontSize: 12 }}
                        onClick={() => {
                          setFundAmounts((a) => ({
                            ...a,
                            [l.id]: a[l.id] ?? String(remaining),
                          }));
                          toggleClosedPanel(l.id, "fund");
                        }}
                      >
                        {panel === "fund" ? "Hide fund ▴" : "Fund remainder ▾"}
                      </button>
                    )}
                  </div>

                  {panel === "extend" && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: 12,
                        background: "var(--bg)",
                        borderRadius: 10,
                        border: "1px solid var(--line)",
                      }}
                    >
                      <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 8 }}>
                        Add time back on the marketplace
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <input
                          className="field-input mono"
                          type="number"
                          min={0}
                          placeholder="Hours"
                          value={extendHours[l.id] ?? ""}
                          onChange={(e) =>
                            setExtendHours((h) => ({ ...h, [l.id]: e.target.value }))
                          }
                          style={{ width: 88, padding: "8px 10px", fontSize: 13 }}
                        />
                        <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>h</span>
                        <input
                          className="field-input mono"
                          type="number"
                          min={0}
                          max={59}
                          placeholder="Minutes"
                          value={extendMins[l.id] ?? ""}
                          onChange={(e) =>
                            setExtendMins((m) => ({ ...m, [l.id]: e.target.value }))
                          }
                          style={{ width: 88, padding: "8px 10px", fontSize: 13 }}
                        />
                        <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>min</span>
                        <button
                          className="btn btn-primary"
                          style={{ padding: "8px 14px", fontSize: 12.5 }}
                          onClick={() => submitExtend(l.id, borrower)}
                        >
                          Submit
                        </button>
                      </div>
                    </div>
                  )}

                  {panel === "fund" && remaining > 0 && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: 12,
                        background: "var(--bg)",
                        borderRadius: 10,
                        border: "1px solid var(--line)",
                      }}
                    >
                      <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 8 }}>
                        Fund from platform account (max {fmt(remaining)})
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <input
                          className="field-input mono"
                          type="number"
                          min={0}
                          step="0.01"
                          value={fundAmounts[l.id] ?? String(remaining)}
                          onChange={(e) =>
                            setFundAmounts((a) => ({ ...a, [l.id]: e.target.value }))
                          }
                          style={{ flex: 1, minWidth: 120, padding: "8px 10px", fontSize: 13 }}
                        />
                        <button
                          className="btn btn-outline"
                          style={{ padding: "8px 12px", fontSize: 12 }}
                          onClick={() =>
                            setFundAmounts((a) => ({ ...a, [l.id]: String(remaining) }))
                          }
                        >
                          Max
                        </button>
                        <button
                          className="btn btn-primary"
                          style={{ padding: "8px 14px", fontSize: 12.5 }}
                          onClick={() => submitAdminFund(l.id, borrower, remaining)}
                        >
                          Fund
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div className="display" style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
          Pending loan repayments
        </div>
        {pending.length === 0 ? (
          <div
            style={{
              fontSize: 12.5,
              color: "var(--ink-soft)",
              background: "var(--surface)",
              borderRadius: 10,
              padding: 12,
            }}
          >
            Nothing waiting on approval right now.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pending.map((r) => (
              <div key={r.id} className="card" style={{ padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>@{r.loan?.borrower?.username} repaid</span>
                  <span className="mono">{fmt(r.amount)}</span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 4 }}>
                  To be split:{" "}
                  {r.distributions
                    .map((d) => `@${d.funder?.username ?? d.funderId} ${fmt(d.amount)}`)
                    .join(", ")}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    className="btn btn-primary"
                    style={{ flex: 1, padding: "7px 0", fontSize: 12.5 }}
                    onClick={() => approve(r.id)}
                  >
                    Approve
                  </button>
                  <button
                    className="btn btn-outline"
                    style={{
                      flex: 1,
                      padding: "7px 0",
                      fontSize: 12.5,
                      color: "var(--rust)",
                      borderColor: "var(--rust)",
                    }}
                    onClick={() => reject(r.id)}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="display" style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
          Manage
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {card("/admin/users", "Users & KYC →", "Search, filter, verification")}
          {card(
            "/admin/packages",
            "Loan packages →",
            "Terms, interest rates, activate/deactivate, reset",
          )}
          {card("/admin/rates", "Rates & fees →", "Investment rate, fees, guarantor rules")}
          {card("/admin/offers", "Grand offers →", "Home-screen promotions")}
        </div>
      </section>
    </div>
  );
}