import { useEffect, useState } from "react";
import * as adminApi from "../api/admin";
import type { AdminSettings, Offer, LoanRepayment } from "../api/types";
import { fmt, errorMessage } from "../utils/format";
import { useToast } from "../context/ToastContext";

export function AdminPage() {
  const showToast = useToast();
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [pending, setPending] = useState<LoanRepayment[]>([]);
  const [users, setUsers] = useState<adminApi.AdminUser[]>([]);
  const [newOffer, setNewOffer] = useState({ title: "", description: "" });
  const [error, setError] = useState("");

  async function load() {
    try {
      const [s, o, p, u] = await Promise.all([
        adminApi.getSettings(),
        adminApi.listOffers(),
        adminApi.listPendingRepayments(),
        adminApi.listUsers(),
      ]);
      setSettings(s);
      setOffers(o);
      setPending(p);
      setUsers(u);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (error) return <div style={{ padding: 20, color: "var(--rust)", fontSize: 13.5 }}>{error}</div>;
  if (!settings) return <div style={{ padding: 20, color: "var(--ink-soft)" }}>Loading…</div>;

  async function saveSettings(
    patch: Partial<{
      investAnnualRatePct: number;
      loanAnnualRatePct: number;
      guarantorsRequired: number;
      guarantorCoverageExtraPct: number;
    }>,
  ) {
    try {
      const updated = await adminApi.updateSettings(patch);
      setSettings(updated);
      showToast("Settings updated");
    } catch (err) {
      showToast(errorMessage(err));
    }
  }

  async function addOffer() {
    if (!newOffer.title.trim() || !newOffer.description.trim()) return;
    try {
      const offer = await adminApi.createOffer(newOffer);
      setOffers((o) => [offer, ...o]);
      setNewOffer({ title: "", description: "" });
    } catch (err) {
      showToast(errorMessage(err));
    }
  }

  async function removeOffer(id: string) {
    try {
      await adminApi.deleteOffer(id);
      setOffers((o) => o.filter((x) => x.id !== id));
    } catch (err) {
      showToast(errorMessage(err));
    }
  }

  async function approve(id: string) {
    if (!window.confirm("Approve this repayment? Funders will be credited immediately.")) return;
    try {
      await adminApi.approveRepayment(id);
      setPending((p) => p.filter((r) => r.id !== id));
      showToast("Approved — funders credited");
    } catch (err) {
      showToast(errorMessage(err));
    }
  }

  async function reject(id: string) {
    if (!window.confirm("Reject this repayment? The borrower will be refunded.")) return;
    try {
      await adminApi.rejectRepayment(id);
      setPending((p) => p.filter((r) => r.id !== id));
      showToast("Rejected — borrower refunded");
    } catch (err) {
      showToast(errorMessage(err));
    }
  }

  async function changeKyc(id: string, kycStatus: "PENDING" | "VERIFIED" | "REJECTED") {
    try {
      const updated = await adminApi.setUserKyc(id, kycStatus);
      setUsers((list) =>
        list.map((x) =>
          x.id === id ? { ...x, kycStatus: updated.kycStatus as typeof x.kycStatus } : x,
        ),
      );
      showToast(`@${updated.username} → ${updated.kycStatus}`);
    } catch (err) {
      showToast(errorMessage(err));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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
          Users &amp; KYC
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {users.map((u) => (
            <div
              key={u.id}
              className="card"
              style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                    @{u.username}
                    {u.role === "ADMIN" ? " · admin" : ""}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                    {u.phoneNumber}
                    {u.account
                      ? ` · bal ${fmt(Number(u.account.principalBalance) + Number(u.account.interestBalance))}`
                      : ""}
                  </div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-soft)" }}>
                  {u.kycStatus}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {(["PENDING", "VERIFIED", "REJECTED"] as const).map((status) => (
                  <button
                    key={status}
                    className="btn"
                    disabled={u.kycStatus === status}
                    style={{
                      flex: 1,
                      padding: "6px 0",
                      fontSize: 11,
                      background: u.kycStatus === status ? "var(--green)" : "transparent",
                      color: u.kycStatus === status ? "#f4fbf4" : "var(--ink)",
                      border: `1px solid ${u.kycStatus === status ? "var(--green)" : "var(--line)"}`,
                    }}
                    onClick={() => changeKyc(u.id, status)}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="display" style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
          Rates &amp; rules
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <NumField
            label="Investment interest rate (% p.a.)"
            value={Number(settings.investAnnualRatePct)}
            onSave={(v) => saveSettings({ investAnnualRatePct: v })}
          />
          <NumField
            label="Loan interest rate (% p.a.)"
            value={Number(settings.loanAnnualRatePct)}
            onSave={(v) => saveSettings({ loanAnnualRatePct: v })}
          />
          <NumField
            label="Guarantors required per loan"
            value={settings.guarantorsRequired}
            onSave={(v) => saveSettings({ guarantorsRequired: Math.max(1, Math.round(v)) })}
          />
          <NumField
            label="Guarantor coverage buffer (%)"
            value={Number(settings.guarantorCoverageExtraPct)}
            onSave={(v) => saveSettings({ guarantorCoverageExtraPct: v })}
          />
        </div>
      </section>

      <section>
        <div className="display" style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
          Grand offers
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {offers.map((o) => (
            <div
              key={o.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "var(--amber-pale)",
                borderRadius: 10,
                padding: "8px 12px",
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{o.title}</div>
                <div style={{ fontSize: 11.5, color: "#7a5a2e" }}>{o.description}</div>
              </div>
              <button
                onClick={() => removeOffer(o.id)}
                aria-label="Remove offer"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--rust)",
                  fontSize: 16,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            className="field-input"
            value={newOffer.title}
            onChange={(e) => setNewOffer((o) => ({ ...o, title: e.target.value }))}
            placeholder="Offer title"
            style={{ flex: 1 }}
          />
          <input
            className="field-input"
            value={newOffer.description}
            onChange={(e) => setNewOffer((o) => ({ ...o, description: e.target.value }))}
            placeholder="Description"
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary" style={{ padding: "0 14px" }} onClick={addOffer}>
            Add
          </button>
        </div>
      </section>
    </div>
  );
}

function NumField({
  label,
  value,
  onSave,
}: {
  label: string;
  value: number;
  onSave: (v: number) => void;
}) {
  const [local, setLocal] = useState(String(value));
  return (
    <div>
      <label className="field-label">{label}</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="field-input mono"
          type="number"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          style={{ flex: 1 }}
        />
        <button
          className="btn btn-outline"
          style={{ padding: "0 14px" }}
          onClick={() => onSave(parseFloat(local) || 0)}
        >
          Save
        </button>
      </div>
    </div>
  );
}