import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as adminApi from "../api/admin";
import { fmt, errorMessage } from "../utils/format";
import { useToast } from "../context/ToastContext";

type KycFilter = "ALL" | "PENDING" | "VERIFIED" | "REJECTED";

export function AdminUsersPage() {
  const showToast = useToast();
  const [users, setUsers] = useState<adminApi.AdminUser[]>([]);
  const [q, setQ] = useState("");
  const [kyc, setKyc] = useState<KycFilter>("PENDING");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await adminApi.listUsers({
        q: q.trim() || undefined,
        kyc: kyc === "ALL" ? undefined : kyc,
      });
      setUsers(list);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [q, kyc]);

  useEffect(() => {
    const t = setTimeout(() => {
      load();
    }, 250);
    return () => clearTimeout(t);
  }, [load]);

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
      // If filtering by status, reload so the row leaves the list when appropriate
      if (kyc !== "ALL" && kyc !== kycStatus) {
        setUsers((list) => list.filter((x) => x.id !== id));
      }
    } catch (err) {
      showToast(errorMessage(err));
    }
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

      <input
        className="field-input"
        placeholder="Search username or phone…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ width: "100%" }}
      />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(["ALL", "PENDING", "VERIFIED", "REJECTED"] as const).map((f) => (
          <button
            key={f}
            className="btn"
            onClick={() => setKyc(f)}
            style={{
              padding: "6px 12px",
              fontSize: 12,
              background: kyc === f ? "var(--green)" : "transparent",
              color: kyc === f ? "#f4fbf4" : "var(--ink)",
              border: `1px solid ${kyc === f ? "var(--green)" : "var(--line)"}`,
            }}
          >
            {f === "ALL" ? "All" : f}
          </button>
        ))}
      </div>

      {error && <div style={{ color: "var(--rust)", fontSize: 13 }}>{error}</div>}
      {loading && <div style={{ color: "var(--ink-soft)", fontSize: 13 }}>Loading…</div>}

      {!loading && users.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>No users match this filter.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {users.map((u) => (
          <div
            key={u.id}
            className="card"
            style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                  @{u.username}
                  {u.role === "ADMIN" ? " · admin" : ""}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                  {u.phoneNumber}
                  {u.account
                    ? ` · bal ${fmt(Number(u.account.principalBalance) + Number(u.account.interestBalance))}`
                    : ""}
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-soft)" }}>{u.kycStatus}</span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {(["PENDING", "VERIFIED", "REJECTED"] as const).map((status) => (
                <button
                  key={status}
                  className="btn"
                  disabled={u.kycStatus === status}
                  style={{
                    flex: 1,
                    padding: "6px 0",
                    fontSize: 11,
                    background: u.kycStatus === status ? "var(--green)" : "transparent",
                    color: u.kycStatus === status ? "#f4fbf4" : "var(--ink)",
                    border: `1px solid ${u.kycStatus === status ? "var(--green)" : "var(--line)"}`,
                  }}
                  onClick={() => changeKyc(u.id, status)}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}