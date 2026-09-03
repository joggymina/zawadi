import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as adminApi from "../api/admin";
import { fmt, errorMessage, shortDate } from "../utils/format";
import { useToast } from "../context/ToastContext";

type KycFilter = "ALL" | "PENDING" | "VERIFIED" | "REJECTED";

const REJECT_PRESETS = [
  "ID photo unclear or unreadable",
  "Selfie does not match ID photo",
  "Name or ID number does not match documents",
  "Incomplete or cropped ID (corners missing)",
  "Suspected screenshot or edited image",
];

export function AdminUsersPage() {
  const showToast = useToast();
  const [users, setUsers] = useState<adminApi.AdminUser[]>([]);
  const [q, setQ] = useState("");
  const [kyc, setKyc] = useState<KycFilter>("PENDING");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [pendingKyc, setPendingKyc] = useState<adminApi.PendingKycRow[]>([]);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [review, setReview] = useState<Awaited<
    ReturnType<typeof adminApi.getKycSubmission>
  > | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectOther, setRejectOther] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [list, pending] = await Promise.all([
        adminApi.listUsers({
          q: q.trim() || undefined,
          kyc: kyc === "ALL" ? undefined : kyc,
        }),
        adminApi.listPendingKyc().catch(() => [] as adminApi.PendingKycRow[]),
      ]);
      setUsers(list);
      setPendingKyc(pending);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [q, kyc]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function openReview(id: string) {
    setReviewId(id);
    setReview(null);
    setRejectOpen(false);
    setRejectReason("");
    setRejectOther("");
    try {
      setReview(await adminApi.getKycSubmission(id));
    } catch (err) {
      showToast(errorMessage(err));
      setReviewId(null);
    }
  }

  async function approve() {
    if (!reviewId) return;
    setReviewBusy(true);
    try {
      await adminApi.approveKyc(reviewId);
      showToast("KYC approved");
      setReviewId(null);
      setReview(null);
      await load();
    } catch (err) {
      showToast(errorMessage(err));
    } finally {
      setReviewBusy(false);
    }
  }

  async function confirmReject() {
    if (!reviewId) return;
    const reason =
      rejectReason === "OTHER" ? rejectOther.trim() : rejectReason.trim();
    if (!reason) {
      showToast("Choose or type a rejection reason");
      return;
    }
    setReviewBusy(true);
    try {
      await adminApi.rejectKyc(reviewId, reason);
      showToast("KYC rejected");
      setRejectOpen(false);
      setRejectReason("");
      setRejectOther("");
      setReviewId(null);
      setReview(null);
      await load();
    } catch (err) {
      showToast(errorMessage(err));
    } finally {
      setReviewBusy(false);
    }
  }

  async function changeKyc(id: string, kycStatus: "PENDING" | "VERIFIED" | "REJECTED") {
    if (kycStatus === "REJECTED") {
      if (!window.confirm("Reject this user? They will be blocked from money movements.")) return;
    }
    try {
      const updated = await adminApi.setUserKyc(id, kycStatus);
      setUsers((list) =>
        list.map((x) =>
          x.id === id ? { ...x, kycStatus: updated.kycStatus as typeof x.kycStatus } : x,
        ),
      );
      showToast(`@${updated.username} → ${updated.kycStatus}`);
      if (kyc !== "ALL" && kyc !== kycStatus) {
        setUsers((list) => list.filter((x) => x.id !== id));
      }
    } catch (err) {
      showToast(errorMessage(err));
    }
  }

  if (reviewId) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <button
          onClick={() => {
            setReviewId(null);
            setReview(null);
            setRejectOpen(false);
          }}
          style={{
            background: "none",
            border: "none",
            color: "var(--green-deep)",
            fontSize: 13,
            cursor: "pointer",
            textAlign: "left",
            padding: 0,
          }}
        >
          ← Back to users
        </button>
        <div className="display" style={{ fontSize: 18, fontWeight: 500 }}>
          KYC review
        </div>
        {!review ? (
          <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Loading documents…</div>
        ) : (
          <>
            <div className="card" style={{ padding: 14, fontSize: 13.5, lineHeight: 1.5 }}>
              <div>
                <strong>@{review.user.username}</strong> · {review.user.phoneNumber}
              </div>
              <div style={{ marginTop: 6 }}>Name: {review.fullName}</div>
              <div>ID number: {review.idNumber}</div>
            </div>
            {(
              [
                ["Selfie", review.selfieData],
                ["ID front", review.idFrontData],
                ["ID back", review.idBackData],
              ] as const
            ).map(([label, src]) => (
              <div key={label}>
                <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 6 }}>
                  {label}
                </div>
                <img
                  src={src}
                  alt={label}
                  style={{
                    width: "100%",
                    maxHeight: 320,
                    objectFit: "contain",
                    borderRadius: 10,
                    border: "1px solid var(--line)",
                    background: "#fff",
                  }}
                />
              </div>
            ))}

            {!rejectOpen ? (
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1, padding: "12px 0" }}
                  disabled={reviewBusy}
                  onClick={() => void approve()}
                >
                  Approve
                </button>
                <button
                  className="btn"
                  style={{
                    flex: 1,
                    padding: "12px 0",
                    background: "var(--rust-pale)",
                    color: "var(--rust)",
                  }}
                  disabled={reviewBusy}
                  onClick={() => setRejectOpen(true)}
                >
                  Reject
                </button>
              </div>
            ) : (
              <div className="card" style={{ padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                  Rejection reason
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {REJECT_PRESETS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        setRejectReason(r);
                        setRejectOther("");
                      }}
                      style={{
                        fontSize: 12,
                        padding: "6px 10px",
                        borderRadius: 999,
                        border: "1px solid var(--line)",
                        background: rejectReason === r ? "var(--rust-pale)" : "#fff",
                        color: rejectReason === r ? "var(--rust)" : "var(--ink-soft)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      {r}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setRejectReason("OTHER")}
                    style={{
                      fontSize: 12,
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: "1px solid var(--line)",
                      background: rejectReason === "OTHER" ? "var(--rust-pale)" : "#fff",
                      color: rejectReason === "OTHER" ? "var(--rust)" : "var(--ink-soft)",
                      cursor: "pointer",
                    }}
                  >
                    Other…
                  </button>
                </div>
                {rejectReason === "OTHER" && (
                  <input
                    className="field-input"
                    style={{ marginTop: 10 }}
                    placeholder="Type reason shown to user"
                    value={rejectOther}
                    onChange={(e) => setRejectOther(e.target.value)}
                  />
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button
                    className="btn"
                    style={{ flex: 1, padding: "10px 0" }}
                    onClick={() => {
                      setRejectOpen(false);
                      setRejectReason("");
                      setRejectOther("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn"
                    style={{
                      flex: 1,
                      padding: "10px 0",
                      background: "var(--rust-pale)",
                      color: "var(--rust)",
                    }}
                    disabled={reviewBusy}
                    onClick={() => void confirmReject()}
                  >
                    Confirm reject
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="display" style={{ fontSize: 18, fontWeight: 500 }}>
          Users &amp; KYC
        </div>
        <Link to="/admin" style={{ fontSize: 13, color: "var(--green-deep)", textDecoration: "none" }}>
          ← Overview
        </Link>
      </div>

      {pendingKyc.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            Awaiting document review ({pendingKyc.length})
          </div>
          <div className="card" style={{ overflow: "hidden" }}>
            {pendingKyc.map((row, i) => (
              <button
                key={row.id}
                onClick={() => void openReview(row.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  borderTop: i === 0 ? "none" : "1px solid var(--line)",
                  padding: "12px 14px",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                  @{row.user.username} · {row.fullName}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>
                  ID {row.idNumber} · {shortDate(row.createdAt)}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <input
        className="field-input"
        placeholder="Search username or phone"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(["ALL", "PENDING", "VERIFIED", "REJECTED"] as KycFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setKyc(f)}
            style={{
              border: "1px solid var(--line)",
              borderRadius: 999,
              padding: "6px 12px",
              fontSize: 12,
              cursor: "pointer",
              background: kyc === f ? "var(--green-pale)" : "#fff",
              color: kyc === f ? "var(--green-deep)" : "var(--ink-soft)",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {error && <div className="error-text">{error}</div>}
      {loading && <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Loading…</div>}

      {!loading && users.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>No users match.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {users.map((u) => (
          <div key={u.id} className="card" style={{ padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  @{u.username}{" "}
                  <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>{u.role}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>
                  {u.phoneNumber}
                </div>
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  KYC: <strong>{u.kycStatus}</strong>
                  {u.account && <> · bal {fmt(u.account.principalBalance)}</>}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button
                className="btn btn-outline"
                style={{ fontSize: 12, padding: "6px 10px" }}
                onClick={() => void changeKyc(u.id, "VERIFIED")}
              >
                Mark verified
              </button>
              <button
                className="btn btn-outline"
                style={{ fontSize: 12, padding: "6px 10px" }}
                onClick={() => void changeKyc(u.id, "PENDING")}
              >
                Mark pending
              </button>
              <button
                className="btn"
                style={{
                  fontSize: 12,
                  padding: "6px 10px",
                  background: "var(--rust-pale)",
                  color: "var(--rust)",
                }}
                onClick={() => void changeKyc(u.id, "REJECTED")}
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}