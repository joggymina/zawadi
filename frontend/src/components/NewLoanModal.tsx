import { useEffect, useMemo, useState } from "react";
import type { AdminSettings, LoanPackage } from "../api/types";
import * as publicApi from "../api/public";
import { fmt, errorMessage, formatDuration } from "../utils/format";

interface NewLoanModalProps {
  settings: AdminSettings;
  onClose: () => void;
  onSubmit: (params: {
    amount: number;
    purpose?: string;
    guarantorUsernames: string[];
    packageId: string;
  }) => Promise<unknown>;
}

/** Match backend utils/money.ts annualToDaily */
function annualToDaily(annualPct: number): number {
  const a = annualPct / 100;
  return Math.pow(1 + a, 1 / 365) - 1;
}

/**
 * Expected interest if the full principal stays outstanding for the
 * package term (compound daily — same idea as dailyAccrual.job).
 */
function estimateInterest(principal: number, aprPct: number, durationHours: number): number {
  if (principal <= 0 || durationHours <= 0) return 0;
  const days = durationHours / 24;
  const daily = annualToDaily(aprPct);
  const interest = principal * (Math.pow(1 + daily, days) - 1);
  return Math.round(interest * 100) / 100;
}

export function NewLoanModal({ settings, onClose, onSubmit }: NewLoanModalProps) {
  const required = settings.guarantorsRequired;
  const [packages, setPackages] = useState<LoanPackage[]>([]);
  const [packageId, setPackageId] = useState("");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [guarantors, setGuarantors] = useState<string[]>(Array(required).fill(""));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    publicApi
      .getPackages()
      .then((list) => {
        const sorted = [...list].sort((a, b) => a.durationHours - b.durationHours);
        setPackages(sorted);
        if (sorted[0]) setPackageId(sorted[0].id);
      })
      .catch(() => setError("Could not load loan packages."));
  }, []);

  const val = parseFloat(amount) || 0;
  const threshold = val * (1 + Number(settings.guarantorCoverageExtraPct) / 100);
  const selected = packages.find((p) => p.id === packageId);

  const repaymentPreview = useMemo(() => {
    if (!selected || val <= 0) return null;
    const apr = Number(selected.interestRateApr ?? 0);
    const interest = estimateInterest(val, apr, selected.durationHours);
    const total = Math.round((val + interest) * 100) / 100;
    return {
      apr,
      days: selected.durationHours / 24,
      durationLabel: formatDuration(selected.durationHours),
      graceLabel: selected.graceHours ? formatDuration(selected.graceHours) : null,
      principal: val,
      interest,
      total,
    };
  }, [selected, val]);

  function updateGuarantor(i: number, value: string) {
    setGuarantors((g) => g.map((existing, idx) => (idx === i ? value : existing)));
  }

  async function submit() {
    if (!packageId) {
      setError("Choose a loan package.");
      return;
    }
    if (val <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }
    const trimmed = guarantors.map((g) => g.trim()).filter(Boolean);
    if (trimmed.length !== required) {
      setError(`Enter all ${required} guarantor usernames.`);
      return;
    }
    if (new Set(trimmed).size !== trimmed.length) {
      setError("Guarantors must be distinct usernames.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await onSubmit({
        amount: val,
        purpose: purpose || undefined,
        guarantorUsernames: trimmed,
        packageId,
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="display" style={{ fontSize: 18, fontWeight: 500 }}>
            Request a loan
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--ink-soft)",
              fontSize: 20,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ marginTop: 16 }}>
          <label className="field-label">Package / term</label>
          <select
            className="field-input"
            value={packageId}
            onChange={(e) => setPackageId(e.target.value)}
          >
            {packages.length === 0 && <option value="">Loading packages…</option>}
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({formatDuration(p.durationHours)}
                {p.graceHours ? ` · ${formatDuration(p.graceHours)} grace` : ""} ·{" "}
                {Number(p.interestRateApr ?? 0).toFixed(1)}% p.a.)
              </option>
            ))}
          </select>
          {selected && (
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>
              Repay within {formatDuration(selected.durationHours)} after the loan is fully funded ·{" "}
              {Number(selected.interestRateApr ?? 0).toFixed(2)}% p.a.
            </div>
          )}
        </div>

        <div style={{ marginTop: 14 }}>
          <label className="field-label">Amount you wish to borrow (KSH)</label>
          <input
            className="field-input mono"
            style={{ fontSize: 18 }}
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </div>

        {/* Expected repayment at end of package term */}
        {repaymentPreview && (
          <div
            style={{
              marginTop: 12,
              padding: "12px 14px",
              borderRadius: 12,
              background: "var(--surface-2, #f8fafc)",
              border: "1px solid var(--line, #e5e7eb)",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-soft)", marginBottom: 8 }}>
              If you repay at the end of {repaymentPreview.durationLabel}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: "6px 12px",
                fontSize: 14,
              }}
            >
              <span style={{ color: "var(--ink-soft)" }}>Principal</span>
              <span className="mono" style={{ fontWeight: 600 }}>
                {fmt(repaymentPreview.principal)}
              </span>
              <span style={{ color: "var(--ink-soft)" }}>
                Est. interest ({repaymentPreview.apr.toFixed(2)}% p.a.)
              </span>
              <span className="mono" style={{ fontWeight: 600 }}>
                {fmt(repaymentPreview.interest)}
              </span>
              <span style={{ fontWeight: 600 }}>Expected total to repay</span>
              <span className="mono" style={{ fontWeight: 700, fontSize: 16, color: "var(--accent, #0d6efd)" }}>
                {fmt(repaymentPreview.total)}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 8, lineHeight: 1.4 }}>
              Estimate assumes the full amount stays outstanding for the whole term
              (compound daily). Early repayment may cost less; late repayment after due
              date can cost more
              {repaymentPreview.graceLabel ? ` (grace: ${repaymentPreview.graceLabel})` : ""}.
            </div>
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <label className="field-label">Purpose (optional)</label>
          <input
            className="field-input"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="School fees, stock top-up, etc."
          />
        </div>

        <div style={{ marginTop: 18, fontSize: 13, color: "var(--ink-soft)" }}>
          Guarantors must together hold at least{" "}
          {val > 0 ? fmt(threshold) : "the loan amount"} (
          {100 + Number(settings.guarantorCoverageExtraPct)}% of the loan).
        </div>

        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {guarantors.map((g, i) => (
            <input
              key={i}
              className="field-input"
              value={g}
              onChange={(e) => updateGuarantor(i, e.target.value)}
              placeholder={`Guarantor ${i + 1} username`}
            />
          ))}
        </div>

        {error && (
          <div className="error-text" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}

        <button
          className="btn btn-primary-deep"
          style={{ width: "100%", marginTop: 14, padding: "13px 0", fontSize: 15 }}
          onClick={submit}
          disabled={busy || packages.length === 0}
        >
          {busy ? "Submitting…" : "Publish loan request"}
        </button>
      </div>
    </div>
  );
}