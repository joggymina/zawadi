import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as adminApi from "../api/admin";
import type { LoanRepayment } from "../api/types";
import { fmt, errorMessage } from "../utils/format";
import { useToast } from "../context/ToastContext";

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
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setPending(await adminApi.listPendingRepayments());
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