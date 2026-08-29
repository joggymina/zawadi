import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const TITLES: Record<string, string> = {
  "/": "Good to see you",
  "/performance": "Investment performance",
  "/loans": "Loans",
  "/account": "My account",
};

// Customer-facing shell. Renders a small "Admin" link in the header only
// when the logged-in user's own role is ADMIN — purely a convenience so
// an admin doesn't have to know the /admin URL by heart. This is *not*
// the security boundary: /admin is still independently guarded by
// AdminLayout (which re-checks role itself) and by requireAdmin on every
// admin API route server-side, so this link's presence or absence never
// changes who can actually get in.
export function AppLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)" }}>Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const title = TITLES[location.pathname] ?? "";

  return (
    <div className="app-shell">
      <header style={{ padding: "20px 20px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: "var(--green)", display: "flex", alignItems: "center", justifyContent: "center", color: "#f4fbf4", fontSize: 15 }}>✦</div>
            <span className="display" style={{ fontWeight: 600, fontSize: 20, letterSpacing: -0.3 }}>Zawadi</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>@{user.username}</span>
            {/* Shown only because this specific user's JWT role is ADMIN
                — this is a convenience affordance, not the security
                boundary. The actual boundary is enforced server-side by
                requireAdmin and re-checked by AdminLayout's own guard,
                so this link existing (or not) changes nothing about who
                can actually get into /admin. */}
            {user.role === "ADMIN" && (
              <Link to="/admin" style={{ fontSize: 12.5, color: "var(--green-deep)", fontWeight: 500, textDecoration: "none", display: "flex", alignItems: "center", gap: 3 }}>
                ⚙ Admin
              </Link>
            )}
          </div>
        </div>
        {title && <div className="display" style={{ fontSize: 22, marginTop: 12, fontWeight: 500 }}>{title}</div>}
      </header>

      <div className="page-content">
        <Outlet />
      </div>

      <BottomNav />
    </div>
  );
}

function BottomNav() {
  const items = [
    { to: "/", label: "Home", icon: "⌂" },
    { to: "/performance", label: "Performance", icon: "↗" },
    { to: "/loans", label: "Loans", icon: "◈" },
    { to: "/account", label: "Account", icon: "◔" },
  ];
  return (
    <nav className="bottom-nav">
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
          <span style={{ fontSize: 18 }}>{item.icon}</span>
          <span style={{ fontSize: 10.5 }}>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
