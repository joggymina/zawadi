import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as adminApi from "../api/admin";
import type { AdminSettings, LoanPackage } from "../api/types";
import { errorMessage, formatDuration } from "../utils/format";
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

export function AdminPackagesPage() {
  const showToast = useToast();
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [packages, setPackages] = useState<LoanPackage[]>([]);
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
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [s, pkgs] = await Promise.all([
        adminApi.getSettings(),
        adminApi.listPackages(),
      ]);
      setSettings(s);
      const sorted = sortPackages(pkgs);
      setPackages(sorted);
      const drafts: Record<string, string> = {};
      sorted.forEach((pkg) => {
        drafts[pkg.id] = String(Number(pkg.interestRateApr ?? 0));
      });
      setRateDrafts(drafts);
      setNewPkg((x) => ({
        ...x,
        interestRateApr: String(Number(s.loanAnnualRatePct ?? 33)),
      }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (error) {
    return <div style={{ padding: 20, color: "var(--rust)", fontSize: 13.5 }}>{error}</div>;
  }
  if (loading || !settings) {
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
      body: `Create “${newPkg.name.trim()}” (${formatDuration(durationHours)}) at ${interestRateApr.toFixed(2)}% p.a.?`,
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="display" style={{ fontSize: 18, fontWeight: 500 }}>
          Loan packages
        </div>
        <Link to="/admin" style={{ fontSize: 13, color: "var(--green-deep)", textDecoration: "none" }}>
          ← Overview
        </Link>
      </div>

      <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
        Sorted by duration. Saving a rate updates <strong>all</strong> packages so rates stay
        balanced (no leakage). Default rate:{" "}
        <strong>{defaultLoanRate.toFixed(2)}% p.a.</strong> (from Rates &amp; fees).
      </div>

      {packages.length > 0 && (!ratesInSync || !matchesDefault) && (
        <div
          style={{
            background: "var(--amber-pale)",
            border: "1px solid #e0c080",
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 12.5,
            color: "#7a5a2e",
            lineHeight: 1.45,
          }}
        >
          {!ratesInSync ? (
            <>
              <strong>Rate leakage detected.</strong> Packages are not on the same APR (
              {uniqueRates.map((r) => `${r}%`).join(", ")}). Use <strong>Save rate</strong> or{" "}
              <strong>Reset to default</strong>.
            </>
          ) : (
            <>
              <strong>Rates differ from default.</strong> Packages are at{" "}
              {Number(syncedRate).toFixed(2)}% p.a.; default is {defaultLoanRate.toFixed(2)}% p.a.
            </>
          )}
        </div>
      )}

      {packages.length > 0 && ratesInSync && matchesDefault && (
        <div
          style={{
            background: "var(--green-pale)",
            borderRadius: 10,
            padding: "8px 12px",
            fontSize: 12.5,
            color: "var(--green-deep)",
          }}
        >
          All packages balanced at {defaultLoanRate.toFixed(2)}% p.a. (matches default).
        </div>
      )}

      <div>
        <button
          className="btn btn-outline"
          style={{ padding: "8px 14px", fontSize: 12.5 }}
          onClick={requestResetToDefault}
          disabled={packages.length === 0}
        >
          Reset to default ({defaultLoanRate.toFixed(2)}%)
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {packages.map((p) => (
          <div
            key={p.id}
            className="card"
            style={{
              padding: "12px 14px",
              opacity: p.active ? 1 : 0.7,
              border: p.active ? undefined : "1px dashed var(--line)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {p.name}
                  {!p.active && (
                    <span style={{ fontWeight: 400, color: "var(--ink-soft)" }}> (inactive)</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>
                  {formatDuration(p.durationHours)}
                  {p.graceHours ? ` · ${formatDuration(p.graceHours)} grace` : ""}
                  {" · "}
                  {Number(p.interestRateApr ?? 0).toFixed(2)}% p.a.
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 10,
                    alignItems: "center",
                  }}
                >
                  <input
                    className="field-input mono"
                    type="number"
                    step="0.1"
                    min={0}
                    max={100}
                    value={rateDrafts[p.id] ?? ""}
                    onChange={(e) =>
                      setRateDrafts((d) => ({ ...d, [p.id]: e.target.value }))
                    }
                    style={{ width: 96, padding: "7px 8px", fontSize: 13 }}
                  />
                  <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>% p.a.</span>
                  <button
                    className="btn btn-outline"
                    style={{ padding: "6px 12px", fontSize: 12 }}
                    onClick={() =>
                      requestRateChange(p.name, rateDrafts[p.id] ?? String(p.interestRateApr))
                    }
                  >
                    Save rate
                  </button>
                </div>
              </div>
              <div style={{ flexShrink: 0 }}>
                {p.active ? (
                  <button
                    className="btn btn-outline"
                    style={{ padding: "7px 12px", fontSize: 12 }}
                    onClick={() => requestDeactivate(p)}
                  >
                    Deactivate
                  </button>
                ) : (
                  <button
                    className="btn btn-primary"
                    style={{ padding: "7px 12px", fontSize: 12 }}
                    onClick={() => requestActivate(p)}
                  >
                    Activate
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>Add package</div>
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
            style={{ flex: 1, minWidth: 70 }}
          />
          <input
            className="field-input mono"
            type="number"
            placeholder="Grace h"
            value={newPkg.graceHours}
            onChange={(e) => setNewPkg((x) => ({ ...x, graceHours: e.target.value }))}
            style={{ flex: 1, minWidth: 70 }}
          />
          <input
            className="field-input mono"
            type="number"
            placeholder="APR %"
            value={newPkg.interestRateApr}
            onChange={(e) => setNewPkg((x) => ({ ...x, interestRateApr: e.target.value }))}
            style={{ flex: 1, minWidth: 70 }}
          />
          <button className="btn btn-primary" style={{ padding: "0 14px" }} onClick={requestAddPackage}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}