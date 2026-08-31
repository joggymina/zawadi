import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as adminApi from "../api/admin";
import type { AdminSettings, Offer, LoanRepayment, LoanPackage } from "../api/types";
import { fmt, errorMessage, formatDuration } from "../utils/format";
import { useToast } from "../context/ToastContext";

function sortPackages(list: LoanPackage[]) {
  return [...list].sort((a, b) => a.durationHours - b.durationHours);
}

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
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [pending, setPending] = useState<LoanRepayment[]>([]);
  const [packages, setPackages] = useState<LoanPackage[]>([]);
  const [newOffer, setNewOffer] = useState({ title: "", description: "" });
  const [newPkg, setNewPkg] = useState({
    name: "",
    durationHours: "168",
    graceHours: "24",
    interestRateApr: "33",
  });
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [error, setError] = useState("");

async function load() {
  try {
    const [s, o, p] = await Promise.all([
      adminApi.getSettings(),
      adminApi.listOffers(),
      adminApi.listPendingRepayments(),
    ]);
    setSettings(s);
    setOffers(o);
    setPending(p);
  } catch (err) {
    setError(errorMessage(err));
  }
}

  useEffect(() => {
    load();
  }, []);

  if (error) {
    return <div style={{ padding: 20, color: "var(--rust)", fontSize: 13.5 }}>{error}</div>;
  }
  if (!settings) {
    return <div style={{ padding: 20, color: "var(--ink-soft)" }}>Loading…</div>;
  }

  const defaultLoanRate = Number(settings.loanAnnualRatePct ?? 0);
  const packageRates = packages.map((p) => Number(p.interestRateApr ?? 0));
  const uniqueRates = Array.from(new Set(packageRates.map((r) => r.toFixed(3))));
  const ratesInSync = uniqueRates.length <= 1;
  const syncedRate = packageRates[0];
  const matchesDefault =
    ratesInSync &&
    packages.length > 0 &&
    Math.abs((syncedRate ?? 0) - defaultLoanRate) < 0.001;

  async function saveSettings(
    patch: Partial<{
      investAnnualRatePct: number;
      loanAnnualRatePct: number;
      guarantorsRequired: number;
      guarantorCoverageExtraPct: number;
      withdrawFeePct: number;
      platformInterestSharePct: number;
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

  function askConfirm(state: Exclude<ConfirmState, null>) {
    setConfirm(state);
  }

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

  function applyRatesToState(list: LoanPackage[], rate: number) {
    const sorted = sortPackages(list);
    setPackages(sorted);
    const drafts: Record<string, string> = {};
    sorted.forEach((pkg) => {
      drafts[pkg.id] = String(Number(pkg.interestRateApr ?? rate));
    });
    setRateDrafts(drafts);
  }

  /** Changing any package rate applies the same APR to every package. */
  function requestRateChange(sourceName: string, rateStr: string) {
    const rate = parseFloat(rateStr);
    if (Number.isNaN(rate) || rate < 0 || rate > 100) {
      showToast("Enter a rate between 0 and 100");
      return;
    }
    askConfirm({
      title: "Update interest rates?",
      body: `Set every loan package to ${rate.toFixed(2)}% p.a.?\n\nTriggered from “${sourceName}”.\nThis keeps package rates balanced (no leakage). Only new loans use the new rate.`,
      confirmLabel: "Save all rates",
      onConfirm: async () => {
        const res = await adminApi.bulkSetPackageRates(rate);
        applyRatesToState(res.packages, rate);
        showToast(`All packages set to ${rate.toFixed(2)}% p.a. (${res.count} updated)`);
      },
    });
  }

  function requestResetToDefault() {
    const rate = defaultLoanRate;
    askConfirm({
      title: "Reset all package rates?",
      body: `Set every package to the default loan rate of ${rate.toFixed(2)}% p.a.?\n\nThis aligns packages with Rates & fees and avoids rate leakage on new loans.`,
      confirmLabel: "Reset to default",
      onConfirm: async () => {
        const res = await adminApi.bulkSetPackageRates(rate);
        applyRatesToState(res.packages, rate);
        showToast(`All packages reset to ${rate.toFixed(2)}% p.a.`);
      },
    });
  }

  function requestDeactivate(p: LoanPackage) {
    askConfirm({
      title: "Deactivate package?",
      body: `“${p.name}” will no longer appear when users request a loan. Existing loans are unchanged.`,
      confirmLabel: "Deactivate",
      onConfirm: async () => {
        const updated = await adminApi.deletePackage(p.id);
        setPackages((list) => sortPackages(list.map((x) => (x.id === p.id ? updated : x))));
        showToast(`${p.name} deactivated`);
      },
    });
  }

  function requestActivate(p: LoanPackage) {
    askConfirm({
      title: "Activate package?",
      body: `“${p.name}” will be available again for new loan requests at ${Number(p.interestRateApr ?? 0).toFixed(2)}% p.a.`,
      confirmLabel: "Activate",
      onConfirm: async () => {
        const updated = await adminApi.activatePackage(p.id);
        setPackages((list) => sortPackages(list.map((x) => (x.id === p.id ? updated : x))));
        showToast(`${p.name} activated`);
      },
    });
  }

  function requestAddPackage() {
    const durationHours = parseInt(newPkg.durationHours, 10);
    const graceHours = parseInt(newPkg.graceHours, 10) || 0;
    const interestRateApr = parseFloat(newPkg.interestRateApr);
    if (!newPkg.name.trim() || !durationHours || durationHours <= 0) {
      showToast("Name and positive duration hours required");
      return;
    }
    if (Number.isNaN(interestRateApr) || interestRateApr < 0) {
      showToast("Enter a valid interest rate");
      return;
    }
    askConfirm({
      title: "Add package?",
      body: `Create “${newPkg.name.trim()}” (${formatDuration(durationHours)}) at ${interestRateApr.toFixed(2)}% p.a.?\n\nTip: after adding, use Save rate or Reset to default if you want all packages on the same APR.`,
      confirmLabel: "Add package",
      onConfirm: async () => {
        const pkg = await adminApi.createPackage({
          name: newPkg.name.trim(),
          durationHours,
          graceHours,
          interestRateApr,
          active: true,
          sortOrder: durationHours,
        });
        setPackages((list) => sortPackages([...list, pkg]));
        setRateDrafts((d) => ({ ...d, [pkg.id]: String(interestRateApr) }));
        setNewPkg({
          name: "",
          durationHours: "168",
          graceHours: "24",
          interestRateApr: String(defaultLoanRate || 33),
        });
        showToast(`Added ${pkg.name} at ${interestRateApr.toFixed(2)}% p.a.`);
      },
    });
  }

  function approve(id: string) {
    askConfirm({
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
    askConfirm({
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
            <div
              style={{
                marginTop: 12,
                fontSize: 13.5,
                color: "var(--ink-soft)",
                whiteSpace: "pre-wrap",
                lineHeight: 1.45,
              }}
            >
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
          Users &amp; KYC
        </div>
        <Link
          to="/admin/users"
          className="card"
          style={{
            display: "block",
            padding: "14px 16px",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 500 }}>Open user list →</div>
          <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>
            Search, filter by status, and update verification
          </div>
        </Link>
      </section>

      <section>
        <div className="display" style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
          Loan packages
        </div>
        <Link
          to="/admin/packages"
          className="card"
          style={{
            display: "block",
            padding: "14px 16px",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 500 }}>Manage packages →</div>
          <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>
            Terms, interest rates, activate/deactivate, reset to default
          </div>
        </Link>
      </section>

      <section>
        <div className="display" style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
          Rates &amp; fees
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <NumField
            label="Investment interest rate (% p.a.)"
            value={Number(settings.investAnnualRatePct)}
            onSave={(v) => saveSettings({ investAnnualRatePct: v })}
          />
          <NumField
            label="Default loan rate (% p.a.) — used by Reset to default"
            value={Number(settings.loanAnnualRatePct)}
            onSave={(v) => saveSettings({ loanAnnualRatePct: v })}
          />
          <NumField
            label="Withdrawal fee (%)"
            value={Number(settings.withdrawFeePct ?? 2.5)}
            onSave={(v) => saveSettings({ withdrawFeePct: v })}
          />
          <NumField
            label="Platform share of loan interest (%)"
            value={Number(settings.platformInterestSharePct ?? 10)}
            onSave={(v) => saveSettings({ platformInterestSharePct: v })}
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