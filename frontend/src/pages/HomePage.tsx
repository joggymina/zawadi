import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as accountApi from "../api/account";
import type { Engagement } from "../api/account";
import * as loansApi from "../api/loans";
import * as publicApi from "../api/public";
import type { PlatformStats, ActivityItem } from "../api/public";
import type { AccountSummary, Loan, AdminSettings, Offer } from "../api/types";
import { AmountModal } from "../components/AmountModal";
import { fmt, pct, errorMessage, fundingCountdown } from "../utils/format";
import { useToast } from "../context/ToastContext";
import * as paymentsApi from "../api/payments";

function relativeTime(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function HomePage() {
  const showToast = useToast();
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [openLoans, setOpenLoans] = useState<Loan[]>([]);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [modal, setModal] = useState<"invest" | "withdraw" | null>(null);
  const [error, setError] = useState("");
  const [hidden, setHidden] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(true);

  const load = useCallback(async () => {
    try {
      const [acc, s, o, loans, st, act, eng] = await Promise.all([
        accountApi.getMe(),
        publicApi.getPublicSettings(),
        publicApi.getPublicOffers(),
        loansApi.marketplace(),
        publicApi.getPlatformStats().catch(() => null),
        publicApi.getPlatformActivity(10).catch(() => []),
        accountApi.getEngagement().catch(() => null),
      ]);
      setAccount(acc);
      setSettings(s);
      setOffers(o);
      setOpenLoans(loans.slice(0, 2));
      setStats(st);
      setActivity(act);
      setEngagement(eng);
      if (eng && eng.completedSteps >= eng.totalSteps) setChecklistOpen(false);
    } catch (err) {
      setError(errorMessage(err, "Couldn't load your dashboard."));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (error)
    return (
      <div style={{ padding: 20, color: "var(--rust)", fontSize: 13.5 }}>{error}</div>
    );
  if (!account || !settings)
    return <div style={{ padding: 20, color: "var(--ink-soft)" }}>Loading…</div>;

  const dailyRate = Math.pow(1 + Number(settings.investAnnualRatePct) / 100, 1 / 365) - 1;
  const projectedDaily = Number(account.principalBalance) * dailyRate;
  const held = Number(account.heldAsGuarantor ?? 0);
  const available = Number(
    account.availablePrincipal ?? Number(account.principalBalance) - held,
  );

  const checklistItems = engagement
    ? [
        {
          key: "verified",
          done: engagement.steps.verified,
          label: "Verify your identity",
          to: "/account",
          hint: "Usually reviewed within about 24 hours",
        },
        {
          key: "firstDeposit",
          done: engagement.steps.firstDeposit,
          label: "Make your first deposit",
          action: () => setModal("invest"),
          hint: "Start small via M-Pesa STK",
        },
        {
          key: "fundedOrGuaranteed",
          done: engagement.steps.fundedOrGuaranteed,
          label: "Fund a loan or accept a guarantee",
          to: "/loans",
          hint: "See open loans and guarantee requests",
        },
        {
          key: "requestedLoan",
          done: engagement.steps.requestedLoan,
          label: "Optional: request a loan",
          to: "/loans",
          hint: "When you need capital and have guarantors",
        },
      ]
    : [];

  return (
    <div>
      <div
        style={{
          background: `linear-gradient(160deg, var(--green), var(--green-deep))`,
          borderRadius: 20,
          padding: "22px 22px 26px",
          color: "#f4fbf4",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, opacity: 0.85 }}>
          Investment balance
          <button
            onClick={() => setHidden((h) => !h)}
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              opacity: 0.9,
            }}
            aria-label={hidden ? "Show balance" : "Hide balance"}
          >
            {hidden ? "Show" : "Hide"}
          </button>
        </div>
        <div className="mono" style={{ fontSize: 32, fontWeight: 600, marginTop: 6, letterSpacing: -0.5 }}>
          {hidden ? "••••••" : fmt(account.totalBalance)}
        </div>
        <div style={{ fontSize: 12.5, opacity: 0.8, marginTop: 4 }}>
          Principal {hidden ? "••••" : fmt(account.principalBalance)} · Interest{" "}
          {hidden ? "••••" : fmt(account.interestBalance)}
        </div>
        <div
          style={{
            display: "flex",
            gap: 18,
            marginTop: 14,
            fontSize: 12,
            opacity: 0.9,
          }}
        >
          <div>
            <div style={{ opacity: 0.75 }}>Est. interest / day</div>
            <div className="mono" style={{ fontWeight: 600 }}>
              {hidden ? "—" : projectedDaily.toFixed(2)}
            </div>
          </div>
          <div>
            <div style={{ opacity: 0.75 }}>Net rate</div>
            <div className="mono" style={{ fontWeight: 600 }}>
              {pct(settings.investAnnualRatePct)}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button
            className="btn"
            style={{
              flex: 1,
              background: "#f4fbf4",
              color: "var(--green-deep)",
              fontWeight: 600,
            }}
            onClick={() => setModal("invest")}
          >
            Invest
          </button>
          <button
            className="btn"
            style={{
              flex: 1,
              background: "rgba(244,251,244,0.14)",
              color: "#f4fbf4",
              border: "1px solid rgba(244,251,244,0.4)",
            }}
            onClick={() => setModal("withdraw")}
          >
            Withdraw
          </button>
        </div>
      </div>

      {/* Money map */}
      <div className="card" style={{ marginTop: 14, padding: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Where your money is</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12.5 }}>
          <div>
            <div style={{ color: "var(--ink-soft)" }}>Available</div>
            <div className="mono" style={{ fontWeight: 600 }}>
              {fmt(available)}
            </div>
          </div>
          <div>
            <div style={{ color: "var(--ink-soft)" }}>Held as guarantor</div>
            <div className="mono" style={{ fontWeight: 600 }}>
              {fmt(held)}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 8, lineHeight: 1.4 }}>
          Available can be withdrawn or used to fund loans. Guarantor holds unlock when those loans
          are repaid or cancelled.
        </div>
      </div>

      {/* Onboarding checklist */}
      {engagement && engagement.completedSteps < engagement.totalSteps && (
        <div className="card" style={{ marginTop: 14, padding: 14 }}>
          <button
            type="button"
            onClick={() => setChecklistOpen((o) => !o)}
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--ink)",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              Get started · {engagement.completedSteps}/{engagement.totalSteps}
            </span>
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
              {checklistOpen ? "Hide" : "Show"}
            </span>
          </button>
          {checklistOpen && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {checklistItems.map((s) => (
                <div
                  key={s.key}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    padding: "8px 10px",
                    borderRadius: 10,
                    background: s.done ? "var(--green-pale)" : "var(--bg)",
                    border: "1px solid var(--line)",
                  }}
                >
                  <span style={{ fontSize: 14 }}>{s.done ? "✓" : "○"}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{s.label}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{s.hint}</div>
                  </div>
                  {!s.done && s.to && (
                    <Link to={s.to} style={{ fontSize: 12, color: "var(--green-deep)", fontWeight: 500 }}>
                      Go
                    </Link>
                  )}
                  {!s.done && s.action && (
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: 12, padding: "4px 10px" }}
                      onClick={s.action}
                    >
                      Go
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Platform proof */}
      {stats && (
        <div className="card" style={{ marginTop: 14, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Platform at a glance</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 12.5 }}>
            <div>
              <div style={{ color: "var(--ink-soft)" }}>Under management</div>
              <div className="mono" style={{ fontWeight: 600 }}>
                {fmt(stats.underManagement)}
              </div>
            </div>
            <div>
              <div style={{ color: "var(--ink-soft)" }}>Members</div>
              <div className="mono" style={{ fontWeight: 600 }}>
                {stats.members}
              </div>
            </div>
            <div>
              <div style={{ color: "var(--ink-soft)" }}>Repaid this month</div>
              <div className="mono" style={{ fontWeight: 600 }}>
                {stats.loansRepaidThisMonth}
              </div>
            </div>
            <div>
              <div style={{ color: "var(--ink-soft)" }}>Open for funding</div>
              <div className="mono" style={{ fontWeight: 600 }}>
                {stats.openForFunding}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Live activity */}
      {activity.length > 0 && (
        <div className="card" style={{ marginTop: 14, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Recent activity</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {activity.slice(0, 8).map((a, i) => (
              <div
                key={`${a.at}-${i}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  fontSize: 12.5,
                  borderTop: i === 0 ? "none" : "1px solid var(--line)",
                  paddingTop: i === 0 ? 0 : 8,
                }}
              >
                <span style={{ color: "var(--ink)" }}>{a.text}</span>
                <span style={{ color: "var(--ink-soft)", whiteSpace: "nowrap" }}>
                  {relativeTime(a.at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite */}
      {engagement && (
        <div className="card" style={{ marginTop: 14, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Invite friends</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 6, lineHeight: 1.45 }}>
            Share your link so they can create an account and invest — then they can guarantee your
            loans. {engagement.referralCount > 0
              ? `${engagement.referralCount} joined with your link.`
              : "No referrals yet."}
          </div>
          <button
            type="button"
            className="btn"
            style={{ marginTop: 10, fontSize: 13 }}
            onClick={async () => {
              const url = `${window.location.origin}${engagement.invitePath}`;
              try {
                await navigator.clipboard.writeText(url);
                showToast("Invite link copied");
              } catch {
                showToast(url);
              }
            }}
          >
            Copy invite link
          </button>
        </div>
      )}

      {offers.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Offers</div>
          {offers.map((o) => (
            <div key={o.id} className="card" style={{ padding: 14, marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{o.title}</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 4 }}>{o.description}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Open loans</div>
        <Link to="/loans" style={{ fontSize: 12.5, color: "var(--green-deep)" }}>
          See all
        </Link>
      </div>
      {openLoans.length === 0 ? (
        <div className="card" style={{ marginTop: 8, padding: 16, color: "var(--ink-soft)", fontSize: 13 }}>
          No loans open for funding right now.
        </div>
      ) : (
        openLoans.map((l) => {
          const cd = l.fundingClosesAt ? fundingCountdown(l.fundingClosesAt, nowTick) : "";
          return (
            <Link
              key={l.id}
              to="/loans"
              className="card"
              style={{
                display: "block",
                marginTop: 8,
                padding: 14,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 600 }}>@{l.borrower?.username ?? "borrower"}</span>
                <span className="mono">{fmt(l.amount)}</span>
              </div>
              {cd && cd !== "Closed" && (
                <div style={{ fontSize: 11.5, color: "#b8860b", marginTop: 4 }}>{cd}</div>
              )}
            </Link>
          );
        })
      )}

      <div style={{ marginTop: 16, textAlign: "center" }}>
        <Link to="/performance" style={{ fontSize: 13, color: "var(--green-deep)", fontWeight: 500 }}>
          See your performance →
        </Link>
      </div>

      {modal === "invest" && (
        <AmountModal
          title="Invest via M-Pesa"
          balanceLabel="Amount is credited after you complete the STK prompt on your phone."
          confirmLabel="Continue"
          onClose={() => setModal(null)}
          onSubmit={async (amt) => {
            await paymentsApi.deposit(amt);
            await load();
            showToast("Check your phone for the M-Pesa prompt");
            setModal(null);
          }}
        />
      )}
      {modal === "withdraw" && (
        <AmountModal
          title="Withdraw"
          balanceLabel={`Available principal: ${fmt(available)} · amount below is what you receive; ${Number(settings.withdrawFeePct ?? 2.5)}% fee is taken on top from your balance`}
          confirmLabel="Withdraw"
          needsConfirm
          confirmHint={`You receive the amount entered. An extra ${Number(settings.withdrawFeePct ?? 2.5)}% fee is deducted from your balance and kept by the platform.`}
          onClose={() => setModal(null)}
          onSubmit={async (amt) => {
            const feePct = Number(settings.withdrawFeePct ?? 2.5);
            const fee = (amt * feePct) / 100;
            const total = amt + fee;
            await accountApi.withdraw(amt);
            await load();
            showToast(`Withdraw ${fmt(amt)} (fee ${fmt(fee)}; ${fmt(total)} left your balance)`);
            setModal(null);
          }}
        />
      )}
    </div>
  );
}
