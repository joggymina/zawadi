import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const TITLES: Record<string, string> = {
  "/": "Good to see you",
  "/performance": "Investment performance",
  "/loans": "Loans",
  "/account": "My account",
};

// This layout is the customer-facing shell only. It intentionally has no
// knowledge of the admin role or an /admin link — the admin surface lives
// entirely under AdminLayout, with its own login route and its own guard
// (see components/AdminLayout.tsx). Keeping them separate means a bug in
// this file's logic can't expose the admin panel, because there's no
// admin-related logic here to have a bug in.
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
          <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>@{user.username}</span>
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
