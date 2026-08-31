import { useEffect, useState } from "react";
import * as accountApi from "../api/account";
import type { Transaction } from "../api/types";
import { fmt, shortDate, errorMessage } from "../utils/format";
import { useAuth } from "../context/AuthContext";

const CREDIT_TYPES = new Set(["DEPOSIT", "INTEREST", "LOAN_RETURN", "LOAN_DISBURSEMENT", "ADJUSTMENT"]);

export function AccountPage() {
  const { logout } = useAuth();
  const [panel, setPanel] = useState<"statement" | "terms" | "faq" | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (panel !== "statement") return;
    accountApi.getTransactions().then(setTxs).catch((err) => setError(errorMessage(err)));
  }, [panel]);

  const items: { id: "statement" | "terms" | "faq"; label: string }[] = [
    { id: "statement", label: "View statement" },
    { id: "terms", label: "Terms and conditions" },
    { id: "faq", label: "FAQs" },
  ];

  if (panel) {
    return (
      <div>
        <button onClick={() => setPanel(null)} style={{ background: "none", border: "none", color: "var(--green)", fontSize: 13.5, cursor: "pointer", padding: "10px 0" }}>← Back</button>

        {panel === "statement" && (
          error ? <div className="error-text">{error}</div> :
          txs.length === 0 ? <div style={{ padding: "24px 4px", color: "var(--ink-soft)", fontSize: 13.5 }}>Nothing here yet.</div> : (
            <div className="card" style={{ overflow: "hidden" }}>
              {txs.map((t, i) => (
                <div key={t.id} style={{ display: "flex", justifyContent: "space-between", padding: "13px 16px", borderTop: i === 0 ? "none" : "1px solid var(--line)" }}>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 500, textTransform: "capitalize" }}>{t.type.replace(/_/g, " ").toLowerCase()}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>{t.note || shortDate(t.createdAt)}</div>
                  </div>
                  <div className="mono" style={{ fontSize: 13.5, color: CREDIT_TYPES.has(t.type) ? "var(--green)" : "var(--rust)" }}>
                    {CREDIT_TYPES.has(t.type) ? "+" : "-"}{Number(t.amount).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {panel === "terms" && (
          <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--ink-soft)" }}>
            <p>Investing carries risk, and past performance doesn't guarantee future results. Loans funded through the marketplace are backed by guarantor verification, not a formal credit check, and repayment isn't guaranteed.</p>
          </div>
        )}

        {panel === "faq" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Faq q="How is interest calculated?" a="Interest accrues daily on your principal, compounding at the annual rate set by the admin." />
            <Faq q="How do I qualify for a loan?" a="You need a set number of guarantors who are active investors. Their invested principal, added together, must cover the loan amount plus the required buffer." />
            <Faq q="How does loan repayment work?" a="Once fully funded, interest accrues daily on the outstanding balance. Repayments are applied immediately, but an admin must approve each one before funders are credited." />
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="card" style={{ overflow: "hidden" }}>
        {items.map((it, i) => (
          <button key={it.id} onClick={() => setPanel(it.id)} style={{
            display: "flex", alignItems: "center", width: "100%", background: "none", border: "none",
            borderTop: i === 0 ? "none" : "1px solid var(--line)", padding: "15px 16px", cursor: "pointer", textAlign: "left", fontSize: 14,
          }}>
            <span style={{ flex: 1 }}>{it.label}</span>
            <span style={{ color: "var(--ink-soft)" }}>›</span>
          </button>
        ))}
      </div>

      <button className="btn" style={{ width: "100%", marginTop: 16, background: "var(--rust-pale)", color: "var(--rust)", padding: "12px 0" }} onClick={() => logout()}>
        Log out
      </button>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 500 }}>{q}</div>
      <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 4, lineHeight: 1.6 }}>{a}</div>
    </div>
  );
}
