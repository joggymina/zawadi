import { useState } from "react";
import { errorMessage } from "../utils/format";

interface AmountModalProps {
  title: string;
  balanceLabel?: string;
  confirmLabel?: string;
  onClose: () => void;
  onSubmit: (amount: number) => Promise<unknown>;
}

export function AmountModal({ title, balanceLabel, confirmLabel = "Confirm", onClose, onSubmit }: AmountModalProps) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const val = parseFloat(amount);
    if (!amount || isNaN(val) || val <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSubmit(val);
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
          <div className="display" style={{ fontSize: 18, fontWeight: 500 }}>{title}</div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-soft)", fontSize: 20 }}>×</button>
        </div>

        {balanceLabel && <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 10 }}>{balanceLabel}</div>}

        <div style={{ marginTop: 16 }}>
          <label className="field-label">Amount (KSH)</label>
          <input
            className={`field-input mono ${error ? "error" : ""}`}
            style={{ fontSize: 18 }}
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            autoFocus
          />
          {error && <div className="error-text">{error}</div>}
        </div>

        <button className="btn btn-primary" style={{ width: "100%", marginTop: 18, padding: "13px 0", fontSize: 15 }} onClick={submit} disabled={busy}>
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </div>
  );
}
