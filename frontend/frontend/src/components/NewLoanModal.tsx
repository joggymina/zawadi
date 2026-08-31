import { useState } from "react";
import type { AdminSettings } from "../api/types";
import { fmt, errorMessage } from "../utils/format";

interface NewLoanModalProps {
  settings: AdminSettings;
  onClose: () => void;
  onSubmit: (params: { amount: number; purpose?: string; guarantorUsernames: string[] }) => Promise<unknown>;
}

export function NewLoanModal({ settings, onClose, onSubmit }: NewLoanModalProps) {
  const required = settings.guarantorsRequired;
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [guarantors, setGuarantors] = useState<string[]>(Array(required).fill(""));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const val = parseFloat(amount) || 0;
  const threshold = val * (1 + Number(settings.guarantorCoverageExtraPct) / 100);

  function updateGuarantor(i: number, value: string) {
    setGuarantors((g) => g.map((existing, idx) => (idx === i ? value : existing)));
  }

  async function submit() {
    if (val <= 0) { setError("Enter an amount greater than 0."); return; }
    const trimmed = guarantors.map((g) => g.trim()).filter(Boolean);
    if (trimmed.length !== required) { setError(`Enter all ${required} guarantor usernames.`); return; }
    if (new Set(trimmed).size !== trimmed.length) { setError("Guarantors must be distinct usernames."); return; }

    setBusy(true);
    setError("");
    try {
      await onSubmit({ amount: val, purpose: purpose || undefined, guarantorUsernames: trimmed });
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
          <div className="display" style={{ fontSize: 18, fontWeight: 500 }}>Request a loan</div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-soft)", fontSize: 20 }}>×</button>
        </div>

        <div style={{ marginTop: 16 }}>
          <label className="field-label">Amount you wish to borrow (KSH)</label>
          <input className="field-input mono" style={{ fontSize: 18 }} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </div>

        <div style={{ marginTop: 14 }}>
          <label className="field-label">Purpose (optional)</label>
          <input className="field-input" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="School fees, stock top-up, etc." />
        </div>

        <div style={{ marginTop: 18, fontSize: 13.5, fontWeight: 500 }}>Enter {required} guarantors</div>
        <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 3 }}>
          These should be active investors who've agreed to guarantee this loan. Together, their invested
          principal must cover at least {val > 0 ? fmt(threshold) : "the loan amount"} ({100 + Number(settings.guarantorCoverageExtraPct)}% of the loan) —
          we'll check this when you submit, without showing you their individual balances.
        </div>

        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {guarantors.map((g, i) => (
            <input key={i} className="field-input" value={g} onChange={(e) => updateGuarantor(i, e.target.value)} placeholder={`Guarantor ${i + 1} username`} />
          ))}
        </div>

        {error && <div className="error-text" style={{ marginTop: 10 }}>{error}</div>}

        <button className="btn btn-primary-deep" style={{ width: "100%", marginTop: 14, padding: "13px 0", fontSize: 15 }} onClick={submit} disabled={busy}>
          {busy ? "Submitting…" : "Publish loan request"}
        </button>
      </div>
    </div>
  );
}
