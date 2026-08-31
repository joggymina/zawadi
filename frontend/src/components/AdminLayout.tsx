import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import * as adminApi from "../api/admin";

export function AdminLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  useEffect(() => {
    if (!user || user.role !== "ADMIN") return;
    let cancelled = false;
    async function poll() {
      try {
        const pending = await adminApi.listPendingRepayments();
        if (!cancelled) setPendingCount(pending.length);
      } catch {
        // silent
      }
    }
    poll();
    const interval = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)" }}>Loading…</div>
    );
  }
  if (!user || user.role !== "ADMIN") {
    return <Navigate to="/admin/login" replace state={{ from: location }} />;
  }

  const navStyle = ({ isActive }: { isActive: boolean }) => ({
    fontSize: 13,
    fontWeight: isActive ? 600 : 500,
    color: isActive ? "var(--green-deep)" : "var(--ink-soft)",
    textDecoration: "none" as const,
    padding: "4px 0",
    borderBottom: isActive ? "2px solid var(--green)" : "2px solid transparent",
  });

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid var(--line)",
          background: "var(--surface)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: "var(--green-deep)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#f4fbf4",
                fontSize: 14,
              }}
            >
              ⚙
            </div>
            <Link
              to="/admin"
              className="display"
              style={{ fontWeight: 600, fontSize: 18, textDecoration: "none", color: "inherit" }}
            >
              Zawadi Admin
            </Link>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Link
              to="/"
              style={{
                fontSize: 12.5,
                color: "var(--green-deep)",
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              Open app →
            </Link>
            <div
              style={{ position: "relative", display: "flex" }}
              title={
                pendingCount
                  ? `${pendingCount} repayment(s) awaiting approval`
                  : "No pending repayments"
              }
            >
              <span style={{ fontSize: 18 }}>🔔</span>
              {!!pendingCount && (
                <span
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -6,
                    minWidth: 16,
                    height: 16,
                    borderRadius: 999,
                    background: "var(--rust)",
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 4px",
                  }}
                >
                  {pendingCount > 9 ? "9+" : pendingCount}
                </span>
              )}
            </div>
            <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>@{user.username}</span>
          </div>
        </div>
        <nav style={{ display: "flex", gap: 20, marginTop: 14 }}>
          <NavLink to="/admin" end style={navStyle}>
            Overview
          </NavLink>
          <NavLink to="/admin/users" style={navStyle}>
            Users &amp; KYC
          </NavLink>
          <NavLink to="/admin/packages" style={navStyle}>
            Loan packages
          </NavLink>

        </nav>
      </header>
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "24px 20px 60px" }}>
        <Outlet />
      </main>
    </div>
  );
}