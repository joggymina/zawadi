import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import * as notificationsApi from "../api/notifications";
import type { AppNotification } from "../api/notifications";

const TITLES: Record<string, string> = {
  "/": "Good to see you",
  "/performance": "Investment performance",
  "/loans": "Loans",
  "/account": "My account",
};

export function AppLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const loadNotes = useCallback(async () => {
    if (!user) return;
    try {
      const data = await notificationsApi.list();
      setItems(data.items);
      setUnread(data.unread);
    } catch {
      // ignore
    }
  }, [user]);

  useEffect(() => {
    loadNotes();
    const t = setInterval(loadNotes, 60_000);
    return () => clearInterval(t);
  }, [loadNotes]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)" }}>
        Loading…
      </div>
    );
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
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                background: "var(--green)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#f4fbf4",
                fontSize: 15,
              }}
            >
              ✦
            </div>
            <span className="display" style={{ fontWeight: 600, fontSize: 20, letterSpacing: -0.3 }}>
              Zawadi
            </span>
          </div>

            <div ref={panelRef} style={{ position: "relative" }}>
              <button
                type="button"
                className="btn btn-outline"
                style={{ padding: "4px 10px", fontSize: 14, position: "relative" }}
                onClick={() => {
                  setOpen((v) => !v);
                  if (!open) loadNotes();
                }}
                aria-label="Notifications"
              >
                🔔
                {unread > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: -4,
                      right: -4,
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
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </button>

              {open && (
                <div
                  style={{
                    /* Same centering pattern as .bottom-nav — stays inside the 430px shell */
                    position: "fixed",
                    top: 52,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: "min(406px, calc(100vw - 24px))",
                    maxHeight: "min(70vh, 400px)",
                    overflowY: "auto",
                    WebkitOverflowScrolling: "touch",
                    background: "var(--surface, #fff)",
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    boxShadow: "0 12px 32px rgba(0,0,0,0.16)",
                    zIndex: 100,
                    padding: 10,
                    boxSizing: "border-box",
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "4px 4px 10px",
                      borderBottom: "1px solid var(--line)",
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 600 }}>Notifications</span>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {unread > 0 && (
                        <button
                          type="button"
                          className="btn"
                          style={{ fontSize: 11, padding: "4px 8px" }}
                          onClick={async () => {
                            await notificationsApi.markAllRead();
                            await loadNotes();
                          }}
                        >
                          Mark all read
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn"
                        style={{ fontSize: 16, padding: "0 8px", lineHeight: 1 }}
                        onClick={() => setOpen(false)}
                        aria-label="Close"
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  {items.length === 0 ? (
                    <div
                      style={{
                        padding: "20px 12px",
                        fontSize: 13,
                        color: "var(--ink-soft)",
                        textAlign: "left",
                        lineHeight: 1.45,
                      }}
                    >
                      No notifications yet.
                    </div>
                  ) : (
                    items.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={async () => {
                          if (!n.readAt) {
                            await notificationsApi.markRead(n.id);
                            await loadNotes();
                          }
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          border: "none",
                          background: n.readAt ? "transparent" : "var(--green-pale)",
                          borderRadius: 10,
                          padding: "12px 10px",
                          marginBottom: 4,
                          cursor: "pointer",
                          boxSizing: "border-box",
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>
                          {n.title}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--ink-soft)",
                            marginTop: 4,
                            lineHeight: 1.4,
                            wordBreak: "break-word",
                          }}
                        >
                          {n.body}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 6 }}>
                          {new Date(n.createdAt).toLocaleString()}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <span
              style={{
                fontSize: 12.5,
                color: "var(--ink-soft)",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              @{user.username}
              {user.kycStatus === "VERIFIED" && (
                <span
                  title="Verified"
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: "var(--green-deep)",
                    background: "rgba(22, 101, 52, 0.1)",
                    borderRadius: 999,
                    padding: "2px 7px",
                    letterSpacing: 0.2,
                  }}
                >
                  ✓ Verified
                </span>
              )}
              {user.kycStatus === "REJECTED" && (
                <span
                  title="Restricted"
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: "var(--rust)",
                    background: "rgba(180, 60, 40, 0.1)",
                    borderRadius: 999,
                    padding: "2px 7px",
                  }}
                >
                  Restricted
                </span>
              )}
            </span>

            {user.role === "ADMIN" && (
              <Link
                to="/admin"
                style={{
                  fontSize: 12.5,
                  color: "var(--green-deep)",
                  fontWeight: 500,
                  textDecoration: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                ⚙ Admin
              </Link>
            )}
          </div>
        </div>

        {title && (
          <div className="display" style={{ fontSize: 22, marginTop: 12, fontWeight: 500 }}>
            {title}
          </div>
        )}
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
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          className={({ isActive }) => (isActive ? "active" : "")}
        >
          <span style={{ fontSize: 18 }}>{item.icon}</span>
          <span style={{ fontSize: 10.5 }}>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}