import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Deliberately minimal and separate from AppLayout: no bottom nav, no
// customer branding decisions shared with it. If you're not logged in,
// or you are logged in but aren't an admin, you're sent to /admin/login
// — never redirected into the customer app, so this surface never
// silently hands off to the wrong experience.
export function AdminLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();

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
        <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>@{user.username}</span>
      </header>
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "24px 20px 60px" }}>
        <Outlet />
      </main>
    </div>
  );
}
