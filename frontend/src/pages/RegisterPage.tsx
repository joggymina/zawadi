import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { errorMessage } from "../utils/format";

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const refUsername = (search.get("ref") || "").replace(/^@/, "").trim();

  const [username, setUsername] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("+254");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await register(username, phoneNumber, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorMessage(err, "Couldn't create your account."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 380 }} className="card">
        <div style={{ padding: "28px 26px" }}>
          <div className="display" style={{ fontSize: 22, fontWeight: 600 }}>
            Create your account
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 6 }}>
            Invest, borrow, and lend with Zawadi.
          </div>

          {refUsername ? (
            <div
              style={{
                marginTop: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: "var(--green-pale)",
                color: "var(--green-deep)",
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              Invited by <strong>@{refUsername}</strong> — invest so you can guarantee their loans.
            </div>
          ) : null}

          <div style={{ marginTop: 20 }}>
            <label className="field-label">Username</label>
            <input
              className="field-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              pattern="[a-zA-Z0-9_]{3,32}"
              title="3-32 letters, numbers, or underscores"
              required
            />
          </div>
          <div style={{ marginTop: 14 }}>
            <label className="field-label">Phone number</label>
            <input
              className="field-input"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+254712345678"
              pattern="\+254\d{9}"
              title="Format: +254XXXXXXXXX"
              required
            />
          </div>
          <div style={{ marginTop: 14 }}>
            <label className="field-label">Password</label>
            <input
              className="field-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={10}
              required
            />
            <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 4 }}>
              At least 10 characters, with a letter and a number.
            </div>
          </div>

          {error && <div className="error-text">{error}</div>}

          <button
            className="btn btn-primary-deep"
            style={{ width: "100%", marginTop: 20, padding: "13px 0", fontSize: 15 }}
            disabled={busy}
          >
            {busy ? "Creating account…" : "Create account"}
          </button>

          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 16, textAlign: "center" }}>
            Already have an account?{" "}
            <Link to="/login" style={{ color: "var(--green-deep)", fontWeight: 500 }}>
              Log in
            </Link>
          </div>
        </div>
      </form>
    </div>
  );
}