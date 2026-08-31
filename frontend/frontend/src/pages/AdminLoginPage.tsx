import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { errorMessage } from "../utils/format";

export function AdminLoginPage() {
  const { login, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: Location } };
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const user = await login(username, password);
      if (user.role !== "ADMIN") {
        // Don't leave a valid-but-wrong-surface session sitting around —
        // reject cleanly rather than quietly landing them in the
        // customer app from the admin login screen.
        await logout();
        setError("This account doesn't have admin access.");
        return;
      }
      navigate(location.state?.from?.pathname ?? "/admin", { replace: true });
    } catch (err) {
      setError(errorMessage(err, "Couldn't log in — check your username and password."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "var(--bg)" }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 360 }} className="card">
        <div style={{ padding: "28px 26px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--green-deep)", display: "flex", alignItems: "center", justifyContent: "center", color: "#f4fbf4", fontSize: 14 }}>⚙</div>
            <span className="display" style={{ fontSize: 18, fontWeight: 600 }}>Admin access</span>
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 10 }}>
            This is a separate sign-in from the customer app. Only accounts with admin privileges can get past this screen.
          </div>

          <div style={{ marginTop: 20 }}>
            <label className="field-label">Username</label>
            <input className="field-input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </div>
          <div style={{ marginTop: 14 }}>
            <label className="field-label">Password</label>
            <input className="field-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>

          {error && <div className="error-text">{error}</div>}

          <button className="btn btn-primary-deep" style={{ width: "100%", marginTop: 20, padding: "13px 0", fontSize: 15 }} disabled={busy}>
            {busy ? "Checking…" : "Log in"}
          </button>
        </div>
      </form>
    </div>
  );
}
