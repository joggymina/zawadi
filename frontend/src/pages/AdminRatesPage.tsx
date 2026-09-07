import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as adminApi from "../api/admin";
import type { AdminSettings } from "../api/types";
import { errorMessage } from "../utils/format";
import { useToast } from "../context/ToastContext";

export function AdminRatesPage() {
  const showToast = useToast();
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setSettings(await adminApi.getSettings());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveSettings(
    patch: Partial<{
      investAnnualRatePct: number;
      loanAnnualRatePct: number;
      guarantorsRequired: number;
      guarantorCoverageExtraPct: number;
      withdrawFeePct: number;
      platformInterestSharePct: number;
      paymentProvider: "HASHPAY" | "PAYHERO";
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

  if (error) {
    return <div style={{ padding: 20, color: "var(--rust)", fontSize: 13.5 }}>{error}</div>;
  }
  if (loading || !settings) {
    return <div style={{ padding: 20, color: "var(--ink-soft)" }}>Loading…</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="display" style={{ fontSize: 18, fontWeight: 500 }}>
          Rates &amp; fees
        </div>
        <Link to="/admin" style={{ fontSize: 13, color: "var(--green-deep)", textDecoration: "none" }}>
          ← Overview
        </Link>
      </div>

      <div style={{ fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.45 }}>
        Default loan rate is used by <strong>Reset to default</strong> on Loan packages. Package
        APRs for new loans are managed under Loan packages.
      </div>


      <div
        className="card"
        style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}
      >
        <div style={{ fontSize: 13, fontWeight: 600 }}>M-Pesa STK provider</div>
        <div style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.45 }}>
          Choose which gateway sends the deposit STK prompt. Keep credentials for both in
          server env; only the selected provider is used for new deposits. Webhooks for both
          stay active so in-flight payments still complete.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["HASHPAY", "PAYHERO"] as const).map((p) => {
            const active = String(settings.paymentProvider || "HASHPAY").toUpperCase() === p;
            return (
              <button
                key={p}
                type="button"
                className="btn"
                disabled={active}
                style={{
                  padding: "10px 16px",
                  fontSize: 13,
                  background: active ? "var(--green)" : "transparent",
                  color: active ? "#f4fbf4" : "var(--ink)",
                  border: `1px solid ${active ? "var(--green)" : "var(--line)"}`,
                }}
                onClick={async () => {
                  await saveSettings({ paymentProvider: p });
                }}
              >
                {p === "HASHPAY" ? "HashPay" : "PayHero"}
                {active ? " · active" : ""}
              </button>
            );
          })}
        </div>
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
  useEffect(() => {
    setLocal(String(value));
  }, [value]);
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