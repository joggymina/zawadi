import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import * as adminApi from "../api/admin";

// Deliberately minimal and separate from AppLayout: no bottom nav, no
// customer branding decisions shared with it. If you're not logged in,
// or you are logged in but aren't an admin, you're sent to /admin/login
// — never redirected into the customer app, so this surface never
// silently hands off to the wrong experience.
export function AdminLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  // Polls independently of whatever admin page is currently rendered in
  // the Outlet, so the notification badge stays live even if more admin
  // pages get added later that don't themselves fetch this.
  useEffect(() => {
    if (!user || user.role !== "ADMIN") return;
    let cancelled = false;
    async function poll() {
      try {
        const pending = await adminApi.listPendingRepayments();
        if (!cancelled) setPendingCount(pending.length);
      } catch {
        // Silent — a failed poll shouldn't disrupt the admin's session;
        // the next interval tick will just try again.
      }
    }
    poll();
    const interval = setInterval(poll, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)" }}>Loading…</div>;
  }
  if (!user || user.role !== "ADMIN") {
    return <Navigate to="/admin/login" replace state={{ from: location }} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header style={{ padding: "20px 24px", borderBottom: "1px solid var(--line)", background: "var(--surface)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--green-deep)", display: "flex", alignItems: "center", justifyContent: "center", color: "#f4fbf4", fontSize: 14 }}>⚙</div>
          <span className="display" style={{ fontWeight: 600, fontSize: 18 }}>Zawadi Admin</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ position: "relative", display: "flex" }} title={pendingCount ? `${pendingCount} repayment(s) awaiting approval` : "No pending repayments"}>
            <span style={{ fontSize: 18 }}>🔔</span>
            {!!pendingCount && (
              <span style={{
                position: "absolute", top: -4, right: -6, minWidth: 16, height: 16, borderRadius: 999,
                background: "var(--rust)", color: "#fff", fontSize: 10, fontWeight: 600,
                display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px",
              }}>
                {pendingCount > 9 ? "9+" : pendingCount}
              </span>
            )}
          </div>
          <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>@{user.username}</span>
        </div>
      </header>
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "24px 20px 60px" }}>
        <Outlet />
      </main>
    </div>
  );
}
