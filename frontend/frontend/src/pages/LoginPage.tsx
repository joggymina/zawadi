import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { errorMessage } from "../utils/format";

export function LoginPage() {
  const { login } = useAuth();
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
      await login(username, password);
      navigate(location.state?.from?.pathname ?? "/", { replace: true });
    } catch (err) {
      setError(errorMessage(err, "Couldn't log in — check your username and password."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 380 }} className="card">
        <div style={{ padding: "28px 26px" }}>
          <div className="display" style={{ fontSize: 22, fontWeight: 600 }}>Welcome back</div>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 6 }}>Log in to your Zawadi account.</div>

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
            {busy ? "Logging in…" : "Log in"}
          </button>

          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 16, textAlign: "center" }}>
            New here? <Link to="/register" style={{ color: "var(--green-deep)", fontWeight: 500 }}>Create an account</Link>
          </div>
        </div>
      </form>
    </div>
  );
}
