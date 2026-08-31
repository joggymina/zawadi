import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as adminApi from "../api/admin";
import type { AdminSettings, Offer, LoanRepayment, LoanPackage } from "../api/types";
import { fmt, errorMessage, formatDuration } from "../utils/format";
import { useToast } from "../context/ToastContext";

function sortPackages(list: LoanPackage[]) {
  return [...list].sort((a, b) => a.durationHours - b.durationHours);
}

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
  const [bulkRate, setBulkRate] = useState("33");
  const [error, setError] = useState("");

  async function load() {
    try {
      const [s, o, p, pkgs] = await Promise.all([
        adminApi.getSettings(),
        adminApi.listOffers(),
        adminApi.listPendingRepayments(),
        adminApi.listPackages(),
      ]);
      setSettings(s);
      setOffers(o);
      setPending(p);
      setPackages(sortPackages(pkgs));
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

  async function addPackage() {
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
    try {
      const pkg = await adminApi.createPackage({
        name: newPkg.name.trim(),
        durationHours,
        graceHours,
        interestRateApr,
        active: true,
        sortOrder: durationHours,
      });
      setPackages((list) => sortPackages([...list, pkg]));
      setNewPkg({ name: "", durationHours: "168", graceHours: "24", interestRateApr: "33" });
      showToast(
        `Package created: ${pkg.name} at ${Number(pkg.interestRateApr).toFixed(2)}% p.a.`,
      );
    } catch (err) {
      showToast(errorMessage(err));
    }
  }

  async function savePackageRate(p: LoanPackage, rateStr: string) {
    const rate = parseFloat(rateStr);
    if (Number.isNaN(rate) || rate < 0) {
      showToast("Invalid rate");
      return;
    }
    try {
      const updated = await adminApi.updatePackage(p.id, {
        name: p.name,
        durationHours: p.durationHours,
        graceHours: p.graceHours,
        interestRateApr: rate,
        active: p.active,
      });
      setPackages((list) => sortPackages(list.map((x) => (x.id === p.id ? updated : x))));
      showToast(`Saved ${p.name}: ${rate.toFixed(2)}% p.a.`);
    } catch (err) {
      showToast(errorMessage(err));
    }
  }

  async function deactivatePackage(p: LoanPackage) {
    try {
      const updated = await adminApi.deletePackage(p.id);
      setPackages((list) => sortPackages(list.map((x) => (x.id === p.id ? updated : x))));
      showToast(`${p.name} deactivated`);
    } catch (err) {
      showToast(errorMessage(err));
    }
  }

  async function activatePkg(p: LoanPackage) {
    try {
      const updated = await adminApi.activatePackage(p.id);
      setPackages((list) => sortPackages(list.map((x) => (x.id === p.id ? updated : x))));
      showToast(`${p.name} activated`);
    } catch (err) {
      showToast(errorMessage(err));
    }
  }

  async function applyBulkRate() {
    const rate = parseFloat(bulkRate);
    if (Number.isNaN(rate) || rate < 0) {
      showToast("Enter a valid rate");
      return;
    }
    if (
      !window.confirm(
        `Set ALL packages to ${rate.toFixed(2)}% p.a.? This only affects new loans under each package.`,
      )
    ) {
      return;
    }
    try {
      const res = await adminApi.bulkSetPackageRates(rate);
      setPackages(sortPackages(res.packages));
      showToast(`Saved ${rate.toFixed(2)}% p.a. on ${res.count} package(s)`);
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
        <Link
          to="/admin/users"
          className="card"
          style={{ display: "block", padding: "14px 16px", textDecoration: "none", color: "inherit" }}
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
        <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 8 }}>
          Ordered by duration. Each package has its own interest rate for new loans.
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
          <input
            className="field-input mono"
            type="number"
            placeholder="Bulk APR %"
            value={bulkRate}
            onChange={(e) => setBulkRate(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            className="btn btn-outline"
            style={{ padding: "8px 12px", whiteSpace: "nowrap", fontSize: 12.5 }}
            onClick={applyBulkRate}
          >
            Apply to all
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {packages.map((p) => (
            <div
              key={p.id}
              className="card"
              style={{ padding: "10px 12px", opacity: p.active ? 1 : 0.65 }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 8,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                    {p.name} {!p.active && "(inactive)"}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                    {formatDuration(p.durationHours)}
                    {p.graceHours ? ` · ${formatDuration(p.graceHours)} grace` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                    <input
                      className="field-input mono"
                      type="number"
                      defaultValue={Number(p.interestRateApr ?? 0)}
                      key={`${p.id}-${p.interestRateApr}`}
                      id={`rate-${p.id}`}
                      style={{ width: 88, padding: "6px 8px", fontSize: 12 }}
                    />
                    <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>% p.a.</span>
                    <button
                      className="btn btn-outline"
                      style={{ padding: "5px 10px", fontSize: 11 }}
                      onClick={() => {
                        const el = document.getElementById(
                          `rate-${p.id}`,
                        ) as HTMLInputElement | null;
                        savePackageRate(p, el?.value ?? "");
                      }}
                    >
                      Save rate
                    </button>
                  </div>
                </div>
                <div>
                  {p.active ? (
                    <button
                      className="btn btn-outline"
                      style={{ padding: "6px 10px", fontSize: 11.5 }}
                      onClick={() => deactivatePackage(p)}
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary"
                      style={{ padding: "6px 10px", fontSize: 11.5 }}
                      onClick={() => activatePkg(p)}
                    >
                      Activate
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          <input
            className="field-input"
            placeholder="Package name (e.g. 7 days)"
            value={newPkg.name}
            onChange={(e) => setNewPkg((x) => ({ ...x, name: e.target.value }))}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              className="field-input mono"
              type="number"
              placeholder="Hours"
              value={newPkg.durationHours}
              onChange={(e) => setNewPkg((x) => ({ ...x, durationHours: e.target.value }))}
              style={{ flex: 1, minWidth: 72 }}
            />
            <input
              className="field-input mono"
              type="number"
              placeholder="Grace h"
              value={newPkg.graceHours}
              onChange={(e) => setNewPkg((x) => ({ ...x, graceHours: e.target.value }))}
              style={{ flex: 1, minWidth: 72 }}
            />
            <input
              className="field-input mono"
              type="number"
              placeholder="APR %"
              value={newPkg.interestRateApr}
              onChange={(e) => setNewPkg((x) => ({ ...x, interestRateApr: e.target.value }))}
              style={{ flex: 1, minWidth: 72 }}
            />
            <button className="btn btn-primary" style={{ padding: "0 14px" }} onClick={addPackage}>
              Add
            </button>
          </div>
        </div>
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
            label="Default loan rate for new packages only (% p.a.)"
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