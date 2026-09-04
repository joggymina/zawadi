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
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [pendingList, defaultList, closedList] = await Promise.all([
        adminApi.listPendingRepayments(),
        adminApi.listDefaultCandidates(),
        adminApi.listFundingWindowClosed().catch(() => []),
      ]);
      setPending(pendingList);
      setDefaults(defaultList);
      setFundingClosed(closedList);
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

  function extendFunding(loanId: string, borrower: string, extraMinutes: number, label: string) {
    setConfirm({
      title: "Extend funding window?",
      body: `Put @${borrower}'s loan back on the marketplace for ${label}. Members can fund again until the new close time.`,
      confirmLabel: "Extend",
      onConfirm: async () => {
        await adminApi.extendFundingWindow(loanId, extraMinutes);
        showToast(`Funding window extended by ${label}`);
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
              const remaining = Number(l.amount) - Number(l.fundedAmount);
              return (
                <div key={l.id} className="card" style={{ padding: "10px 12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span>@{l.borrower?.username ?? "borrower"}</span>
                    <span className="mono">
                      {fmt(l.fundedAmount)} / {fmt(l.amount)}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 4 }}>
                    {l.package?.name ?? "Package"} · closed{" "}
                    {l.fundingClosesAt ? new Date(l.fundingClosesAt).toLocaleString() : "—"}
                    {remaining > 0 ? ` · ${fmt(remaining)} still needed` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <button
                      className="btn btn-outline"
                      style={{ padding: "7px 10px", fontSize: 12 }}
                      onClick={() =>
                        extendFunding(
                          l.id,
                          l.borrower?.username ?? "borrower",
                          60,
                          "1 hour",
                        )
                      }
                    >
                      +1 hour
                    </button>
                    <button
                      className="btn btn-outline"
                      style={{ padding: "7px 10px", fontSize: 12 }}
                      onClick={() =>
                        extendFunding(
                          l.id,
                          l.borrower?.username ?? "borrower",
                          24 * 60,
                          "24 hours",
                        )
                      }
                    >
                      +24 hours
                    </button>
                    <button
                      className="btn btn-primary"
                      style={{ padding: "7px 10px", fontSize: 12 }}
                      onClick={() =>
                        extendFunding(
                          l.id,
                          l.borrower?.username ?? "borrower",
                          72 * 60,
                          "72 hours",
                        )
                      }
                    >
                      +72 hours
                    </button>
                  </div>
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