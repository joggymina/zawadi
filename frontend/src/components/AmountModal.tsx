import { useState } from "react";
import { errorMessage } from "../utils/format";

interface AmountModalProps {
  title: string;
  balanceLabel?: string;
  confirmLabel?: string;
  /** When true, user must confirm the amount on a second step before submit. */
  needsConfirm?: boolean;
  /** Extra line on the confirm step, e.g. "Pending admin approval". */
  confirmHint?: string;
  /** Pre-fill the amount field (e.g. full outstanding). */
  defaultAmount?: number;
  onClose: () => void;
  onSubmit: (amount: number) => Promise<unknown>;
}

export function AmountModal({
  title,
  balanceLabel,
  confirmLabel = "Confirm",
  needsConfirm = false,
  confirmHint,
  defaultAmount,
  onClose,
  onSubmit,
}: AmountModalProps) {
  const [amount, setAmount] = useState(
    defaultAmount != null && defaultAmount > 0 ? defaultAmount.toFixed(2) : "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"enter" | "confirm">("enter");

  const parsed = parseFloat(amount);
  const validAmount = amount !== "" && !isNaN(parsed) && parsed > 0;

  function goToConfirm() {
    if (!validAmount) {
      setError("Enter an amount greater than 0.");
      return;
    }
    setError("");
    if (needsConfirm) {
      setStep("confirm");
      return;
    }
    void submit(parsed);
  }

  async function submit(val: number) {
    setBusy(true);
    setError("");
    try {
      await onSubmit(val);
    } catch (err) {
      setError(errorMessage(err));
      setStep("enter");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="display" style={{ fontSize: 18, fontWeight: 500 }}>
            {step === "confirm" ? "Confirm" : title}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-soft)", fontSize: 20 }}
          >
            ×
          </button>
        </div>

        {step === "enter" && (
          <>
            {balanceLabel && (
              <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 10, lineHeight: 1.45 }}>
                {balanceLabel}
              </div>
            )}

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
              {defaultAmount != null && defaultAmount > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(defaultAmount.toFixed(2))}
                  style={{
                    marginTop: 8,
                    background: "none",
                    border: "none",
                    color: "var(--green)",
                    fontSize: 12.5,
                    fontWeight: 500,
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  Use full amount due ({defaultAmount.toFixed(2)})
                </button>
              )}
              {error && <div className="error-text">{error}</div>}
            </div>

            <button
              className="btn btn-primary"
              style={{ width: "100%", marginTop: 18, padding: "13px 0", fontSize: 15 }}
              onClick={goToConfirm}
              disabled={busy}
            >
              {needsConfirm ? "Continue" : busy ? "Working…" : confirmLabel}
            </button>
          </>
        )}

        {step === "confirm" && (
          <>
            <div style={{ marginTop: 16, fontSize: 14, color: "var(--ink)", lineHeight: 1.45 }}>
              {title}:{" "}
              <strong className="mono">
                KSH {parsed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </strong>
              ?
            </div>
            {confirmHint && (
              <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--ink-soft)" }}>{confirmHint}</div>
            )}
            {error && <div className="error-text" style={{ marginTop: 10 }}>{error}</div>}

            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button
                className="btn btn-outline"
                style={{ flex: 1, padding: "13px 0", fontSize: 15 }}
                onClick={() => setStep("enter")}
                disabled={busy}
              >
                Back
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1, padding: "13px 0", fontSize: 15 }}
                onClick={() => submit(parsed)}
                disabled={busy}
              >
                {busy ? "Working…" : confirmLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
