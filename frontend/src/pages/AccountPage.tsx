import { useEffect, useState } from "react";
import * as accountApi from "../api/account";
import * as kycApi from "../api/kyc";
import type { Transaction } from "../api/types";
import { shortDate, errorMessage } from "../utils/format";
import { useAuth } from "../context/AuthContext";
import { fileToCompressedDataUrl } from "../utils/image";
import { useToast } from "../context/ToastContext";

const CREDIT_TYPES = new Set([
  "DEPOSIT",
  "INTEREST",
  "LOAN_RETURN",
  "LOAN_DISBURSEMENT",
  "ADJUSTMENT",
]);

type Panel = "statement" | "terms" | "faq" | "kyc" | null;

export function AccountPage() {
  const { logout, user } = useAuth();
  const showToast = useToast();
  const [panel, setPanel] = useState<Panel>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [error, setError] = useState("");

  const [kycInfo, setKycInfo] = useState<kycApi.MyKyc | null>(null);
  const [kycLoading, setKycLoading] = useState(false);
  const [fullName, setFullName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [selfie, setSelfie] = useState<string | null>(null);
  const [idFront, setIdFront] = useState<string | null>(null);
  const [idBack, setIdBack] = useState<string | null>(null);
  const [kycBusy, setKycBusy] = useState(false);
  const [kycError, setKycError] = useState("");

  useEffect(() => {
    if (panel !== "statement") return;
    accountApi.getTransactions().then(setTxs).catch((err) => setError(errorMessage(err)));
  }, [panel]);

  useEffect(() => {
    if (panel !== "kyc") return;
    setKycLoading(true);
    setKycError("");
    kycApi
      .getMine()
      .then(setKycInfo)
      .catch((err) => setKycError(errorMessage(err)))
      .finally(() => setKycLoading(false));
  }, [panel]);

  const items: { id: Exclude<Panel, null>; label: string }[] = [
    { id: "kyc", label: "Verify identity" },
    { id: "statement", label: "View statement" },
    { id: "terms", label: "Terms and conditions" },
    { id: "faq", label: "FAQs" },
  ];

  async function onPick(file: File | undefined, setter: (v: string | null) => void) {
    if (!file) return;
    try {
      const data = await fileToCompressedDataUrl(file);
      setter(data);
    } catch (err) {
      setKycError(errorMessage(err));
    }
  }

  async function submitKyc() {
    setKycError("");
    if (!fullName.trim() || !idNumber.trim() || !selfie || !idFront || !idBack) {
      setKycError("Fill all fields and upload selfie, ID front, and ID back.");
      return;
    }
    setKycBusy(true);
    try {
      await kycApi.submit({
        fullName: fullName.trim(),
        idNumber: idNumber.trim(),
        selfieData: selfie,
        idFrontData: idFront,
        idBackData: idBack,
      });
      showToast("KYC submitted — under review");
      const info = await kycApi.getMine();
      setKycInfo(info);
      setSelfie(null);
      setIdFront(null);
      setIdBack(null);
    } catch (err) {
      setKycError(errorMessage(err));
    } finally {
      setKycBusy(false);
    }
  }

  if (panel) {
    return (
      <div>
        <button
          onClick={() => setPanel(null)}
          style={{
            background: "none",
            border: "none",
            color: "var(--green)",
            fontSize: 13.5,
            cursor: "pointer",
            padding: "10px 0",
          }}
        >
          ← Back
        </button>

        {panel === "statement" &&
          (error ? (
            <div className="error-text">{error}</div>
          ) : txs.length === 0 ? (
            <div style={{ padding: "24px 4px", color: "var(--ink-soft)", fontSize: 13.5 }}>
              Nothing here yet.
            </div>
          ) : (
            <div className="card" style={{ overflow: "hidden" }}>
              {txs.map((t, i) => (
                <div
                  key={t.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "13px 16px",
                    borderTop: i === 0 ? "none" : "1px solid var(--line)",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 500, textTransform: "capitalize" }}>
                      {t.type.replace(/_/g, " ").toLowerCase()}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>
                      {t.note || shortDate(t.createdAt)}
                    </div>
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 13.5,
                      color: CREDIT_TYPES.has(t.type) ? "var(--green)" : "var(--rust)",
                    }}
                  >
                    {CREDIT_TYPES.has(t.type) ? "+" : "-"}
                    {Number(t.amount).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          ))}

        {panel === "kyc" && (
          <div>
            <div className="display" style={{ fontSize: 17, fontWeight: 500, marginBottom: 8 }}>
              Verify identity
            </div>
            <p style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5, marginBottom: 14 }}>
              Use real photos of yourself and your national ID. No screenshots, filters, or
              AI-generated images. Face must be clear and match the ID. ID corners must be visible
              and text readable. Your documents are reviewed before higher limits apply.
            </p>

            {kycLoading && (
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Loading…</div>
            )}

            {!kycLoading && kycInfo?.kycStatus === "VERIFIED" && (
              <div
                className="card"
                style={{ padding: 14, background: "var(--green-pale)", fontSize: 13.5 }}
              >
                Your identity is verified{user?.username ? ` (@${user.username})` : ""}.
              </div>
            )}

            {!kycLoading && kycInfo?.latest?.status === "PENDING_REVIEW" && (
              <div className="card" style={{ padding: 14, fontSize: 13.5 }}>
                Submission under review (submitted {shortDate(kycInfo.latest.createdAt)}). You will
                get a notification when it is reviewed.
              </div>
            )}

            {!kycLoading &&
              kycInfo?.latest?.status === "REJECTED" &&
              kycInfo.kycStatus !== "VERIFIED" && (
                <div
                  className="card"
                  style={{
                    padding: 14,
                    fontSize: 13.5,
                    marginBottom: 12,
                    background: "var(--rust-pale)",
                    color: "var(--rust)",
                  }}
                >
                  Not approved
                  {kycInfo.latest.rejectReason ? `: ${kycInfo.latest.rejectReason}` : "."} You can
                  submit again below.
                </div>
              )}

            {!kycLoading &&
              kycInfo?.kycStatus !== "VERIFIED" &&
              kycInfo?.latest?.status !== "PENDING_REVIEW" && (
                <div className="card" style={{ padding: 16 }}>
                  <label className="field-label">Full legal name</label>
                  <input
                    className="field-input"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="As on your ID"
                  />

                  <label className="field-label" style={{ marginTop: 12 }}>
                    ID number
                  </label>
                  <input
                    className="field-input"
                    value={idNumber}
                    onChange={(e) => setIdNumber(e.target.value)}
                    placeholder="National ID number"
                  />

                  {(
                    [
                      [
                        "Selfie (face clear)",
                        "Front-facing, good light, no sunglasses or hat.",
                        selfie,
                        setSelfie,
                        "user" as const,
                      ],
                      [
                        "ID front",
                        "Full card in frame, no glare, all text readable.",
                        idFront,
                        setIdFront,
                        "environment" as const,
                      ],
                      [
                        "ID back",
                        "Full back of the card; barcodes or chip visible if present.",
                        idBack,
                        setIdBack,
                        "environment" as const,
                      ],
                    ] as const
                  ).map(([label, hint, preview, setter, capture]) => (
                    <div key={label} style={{ marginTop: 12 }}>
                      <label className="field-label">{label}</label>
                      <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 4 }}>
                        {hint}
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        capture={capture}
                        onChange={(e) => void onPick(e.target.files?.[0], setter)}
                      />
                      {preview && (
                        <img
                          src={preview}
                          alt={label}
                          style={{
                            marginTop: 8,
                            maxWidth: "100%",
                            maxHeight: 140,
                            borderRadius: 8,
                            border: "1px solid var(--line)",
                          }}
                        />
                      )}
                    </div>
                  ))}

                  {kycError && (
                    <div className="error-text" style={{ marginTop: 10 }}>
                      {kycError}
                    </div>
                  )}

                  <button
                    className="btn btn-primary"
                    style={{ width: "100%", marginTop: 16, padding: "12px 0" }}
                    disabled={kycBusy}
                    onClick={() => void submitKyc()}
                  >
                    {kycBusy ? "Submitting…" : "Submit for review"}
                  </button>
                </div>
              )}

            {kycError && kycInfo?.latest?.status === "PENDING_REVIEW" && (
              <div className="error-text" style={{ marginTop: 10 }}>
                {kycError}
              </div>
            )}
          </div>
        )}

        {panel === "terms" && (
          <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--ink-soft)" }}>
            <p style={{ fontWeight: 500, color: "var(--ink)", marginBottom: 8 }}>
              How your money works on Zawadi
            </p>
            <p>
              When you invest, funds sit in your investment balance and can earn daily interest.
              That balance stays yours until you choose to fund a loan on the marketplace.
            </p>
            <p style={{ marginTop: 10 }}>
              Funding a loan commits part of your balance to that loan. When the borrower repays,
              the platform credits repayments to funders according to each funder&apos;s share. A
              portion of loan interest may be retained by the platform as a service fee, as
              configured in platform settings.
            </p>
            <p style={{ marginTop: 10 }}>
              If a loan does not raise enough funding while it is open, money you did not commit is
              never taken from your balance. Only amounts you successfully fund are tied to that
              loan.
            </p>
            <p style={{ marginTop: 10 }}>
              Loans are supported by guarantors, not a formal credit check. A loan request is only
              accepted when the chosen guarantors&apos; combined coverage meets the loan amount plus
              the required security buffer. Under-covered requests are rejected and never open for
              funding.
            </p>
            <p style={{ marginTop: 10 }}>
              Once a loan is funded, guarantors&apos; pledged coverage stays held until the loan is
              repaid or cancelled. If the borrower defaults, recovery uses the borrower&apos;s
              available balance first, then held guarantor coverage, to credit funders. Daily
              interest and fees can still change what is owed over time, so funders should treat
              lending as carrying some residual risk even with these controls.
            </p>
            <p style={{ marginTop: 10 }}>
              Identity documents you upload are used only by the platform for verification and are
              not shared with other users.
            </p>
          </div>
        )}

        {panel === "faq" && (
          <div
            className="card"
            style={{ padding: "8px 16px 12px", display: "flex", flexDirection: "column", gap: 2 }}
          >
            <Faq
              q="How is interest calculated?"
              a="Interest accrues daily on your principal, compounding at the annual rate set by the platform."
            />
            <Faq
              q="Is my investment balance locked?"
              a="No. It stays in your account and can earn interest until you fund a loan. Amounts pledged as a guarantor may be held until that loan is repaid or cancelled."
            />
            <Faq
              q="How do I qualify for a loan?"
              a="You need a set number of guarantors who are active investors. Their invested principal, added together, must cover the loan amount plus the required security buffer. Under-covered requests are rejected."
            />
            <Faq
              q="Can someone borrow more than guarantors cover?"
              a="No. A loan request is only accepted when guarantors’ combined coverage meets the loan amount plus the platform security buffer."
            />
            <Faq
              q="What if a loan doesn’t get fully funded?"
              a="Only amounts you successfully fund are committed to that loan. Money you never committed stays in your investment balance."
            />
            <Faq
              q="How does loan repayment work?"
              a="Once fully funded, interest accrues daily on the outstanding balance. Repayments are applied immediately, then held awaiting approval before funders are credited by share. The platform may keep a configured share of loan interest."
            />
            <Faq
              q="Why verify identity?"
              a="Verified members can access higher invest and borrow limits. You upload your name, ID number, selfie, and both sides of your ID for platform verification."
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="card" style={{ overflow: "hidden" }}>
        {items.map((it, i) => (
          <button
            key={it.id}
            onClick={() => setPanel(it.id)}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              background: "none",
              border: "none",
              borderTop: i === 0 ? "none" : "1px solid var(--line)",
              padding: "15px 16px",
              cursor: "pointer",
              textAlign: "left",
              fontSize: 14,
            }}
          >
            <span style={{ flex: 1 }}>{it.label}</span>
            <span style={{ color: "var(--ink-soft)" }}>›</span>
          </button>
        ))}
      </div>

      <button
        className="btn"
        style={{
          width: "100%",
          marginTop: 16,
          background: "var(--rust-pale)",
          color: "var(--rust)",
          padding: "12px 0",
        }}
        onClick={() => logout()}
      >
        Log out
      </button>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        borderBottom: "1px solid var(--line)",
        paddingBottom: 10,
        paddingTop: 8,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          gap: 10,
          background: "none",
          border: "none",
          padding: "4px 0",
          cursor: "pointer",
          textAlign: "left",
        }}
        aria-expanded={open}
      >
        <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>{q}</span>
        <span
          style={{
            fontSize: 12,
            color: "var(--ink-soft)",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.15s ease",
          }}
        >
          ▾
        </span>
      </button>
      {open && (
        <div
          style={{
            fontSize: 13,
            color: "var(--ink-soft)",
            marginTop: 6,
            lineHeight: 1.6,
            paddingRight: 8,
          }}
        >
          {a}
        </div>
      )}
    </div>
  );
}