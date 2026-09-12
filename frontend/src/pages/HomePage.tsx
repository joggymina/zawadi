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
import { useAuth } from "../context/AuthContext";
import * as paymentsApi from "../api/payments";

function relativeTime(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const sectionTitle = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 0.04,
  textTransform: "uppercase" as const,
  color: "var(--ink-soft)",
  marginBottom: 8,
};

export function HomePage() {
  const showToast = useToast();
  const { user } = useAuth();
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
      const verified = user?.kycStatus === "VERIFIED";
      const [acc, s, o, loans, eng, st, act] = await Promise.all([
        accountApi.getMe(),
        publicApi.getPublicSettings(),
        publicApi.getPublicOffers(),
        loansApi.marketplace(),
        accountApi.getEngagement().catch(() => null),
        verified
          ? publicApi.getPlatformStats().catch(() => null)
          : Promise.resolve(null),
        verified
          ? publicApi.getPlatformActivity(6).catch(() => [])
          : Promise.resolve([] as ActivityItem[]),
      ]);
      setAccount(acc);
      setSettings(s);
      setOffers(o);
      setOpenLoans(loans.slice(0, 3));
      setEngagement(eng);
      setStats(st);
      setActivity(act);
      if (eng && eng.completedSteps >= 3) setChecklistOpen(false);
    } catch (err) {
      setError(errorMessage(err, "Couldn't load your dashboard."));
    }
  }, [user?.kycStatus]);

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
          hint: "Usually within ~24 hours",
        },
        {
          key: "firstDeposit",
          done: engagement.steps.firstDeposit,
          label: "Fund your wallet",
          action: () => setModal("invest"),
          hint: "Deposit via M-Pesa STK",
        },
        {
          key: "fundedOrGuaranteed",
          done: engagement.steps.fundedOrGuaranteed,
          label: "Fund or guarantee a loan",
          to: "/loans",
          hint: "Earn from the marketplace",
        },
        {
          key: "requestedLoan",
          done: engagement.steps.requestedLoan,
          label: "Request a loan (optional)",
          to: "/loans",
          hint: "When you need capital",
        },
      ]
    : [];

  const showChecklist =
    engagement && engagement.completedSteps < engagement.totalSteps;

  return (
    <div style={{ paddingBottom: 8 }}>
      {/* Balance hero */}
      <div
        style={{
          background: `linear-gradient(160deg, var(--green), var(--green-deep))`,
          borderRadius: 20,
          padding: "20px 20px 22px",
          color: "#f4fbf4",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, opacity: 0.85 }}>
          Investment balance
          <button
            type="button"
            onClick={() => setHidden((h) => !h)}
            style={{
              background: "rgba(244,251,244,0.15)",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: 999,
            }}
          >
            {hidden ? "Show" : "Hide"}
          </button>
        </div>
        <div
          className="mono"
          style={{ fontSize: 30, fontWeight: 600, marginTop: 6, letterSpacing: -0.5 }}
        >
          {hidden ? "••••••" : fmt(account.totalBalance)}
        </div>
        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
          Principal {hidden ? "••••" : fmt(account.principalBalance)} · Interest{" "}
          {hidden ? "••••" : fmt(account.interestBalance)}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
            marginTop: 14,
            padding: "10px 12px",
            borderRadius: 12,
            background: "rgba(0,0,0,0.12)",
            fontSize: 12,
          }}
        >
          <div>
            <div style={{ opacity: 0.75 }}>Available</div>
            <div className="mono" style={{ fontWeight: 600, marginTop: 2 }}>
              {hidden ? "—" : fmt(available)}
            </div>
          </div>
          <div>
            <div style={{ opacity: 0.75 }}>Held as guarantor</div>
            <div className="mono" style={{ fontWeight: 600, marginTop: 2 }}>
              {hidden ? "—" : fmt(held)}
            </div>
          </div>
          <div>
            <div style={{ opacity: 0.75 }}>Est. / day</div>
            <div className="mono" style={{ fontWeight: 600, marginTop: 2 }}>
              {hidden ? "—" : projectedDaily.toFixed(2)}
            </div>
          </div>
          <div>
            <div style={{ opacity: 0.75 }}>Rate</div>
            <div className="mono" style={{ fontWeight: 600, marginTop: 2 }}>
              {pct(settings.investAnnualRatePct)}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button
            type="button"
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
            type="button"
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

      {/* Checklist — compact */}
      {showChecklist && (
        <div className="card" style={{ marginTop: 12, padding: "12px 14px" }}>
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
              Get started · {engagement!.completedSteps}/{engagement!.totalSteps}
            </span>
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
              {checklistOpen ? "Hide" : "Show"}
            </span>
          </button>
          {/* progress bar */}
          <div
            style={{
              marginTop: 10,
              height: 6,
              borderRadius: 4,
              background: "var(--line)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${(engagement!.completedSteps / engagement!.totalSteps) * 100}%`,
                height: "100%",
                background: "var(--green)",
                borderRadius: 4,
              }}
            />
          </div>
          {checklistOpen && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {checklistItems.map((s) => (
                <div
                  key={s.key}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    padding: "8px 10px",
                    borderRadius: 10,
                    background: s.done ? "var(--green-pale)" : "transparent",
                    border: `1px solid ${s.done ? "transparent" : "var(--line)"}`,
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 11,
                      fontWeight: 700,
                      background: s.done ? "var(--green)" : "var(--line)",
                      color: s.done ? "#fff" : "var(--ink-soft)",
                      flexShrink: 0,
                    }}
                  >
                    {s.done ? "✓" : ""}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{s.label}</div>
                    {!s.done && (
                      <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{s.hint}</div>
                    )}
                  </div>
                  {!s.done && s.to && (
                    <Link
                      to={s.to}
                      style={{ fontSize: 12, color: "var(--green-deep)", fontWeight: 600 }}
                    >
                      Go
                    </Link>
                  )}
                  {!s.done && s.action && (
                    <button
                      type="button"
                      onClick={s.action}
                      style={{
                        fontSize: 12,
                        color: "var(--green-deep)",
                        fontWeight: 600,
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                      }}
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

      {/* Open loans — high engagement, above stats */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={sectionTitle}>Open for funding</div>
          <Link to="/loans" style={{ fontSize: 12.5, color: "var(--green-deep)", fontWeight: 500 }}>
            See all
          </Link>
        </div>
        {openLoans.length === 0 ? (
          <div
            className="card"
            style={{ padding: 14, color: "var(--ink-soft)", fontSize: 13 }}
          >
            No loans open right now. Check back soon.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {openLoans.map((l) => {
              const cd = l.fundingClosesAt
                ? fundingCountdown(l.fundingClosesAt, nowTick)
                : "";
              const funded = Number(l.fundedAmount ?? 0);
              const target = Number(l.amount);
              const pctFunded =
                target > 0 ? Math.min(100, Math.round((funded / target) * 100)) : 0;
              return (
                <Link
                  key={l.id}
                  to="/loans"
                  className="card"
                  style={{
                    display: "block",
                    padding: "12px 14px",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      @{l.borrower?.username ?? "borrower"}
                    </span>
                    <span className="mono" style={{ fontWeight: 600 }}>
                      {fmt(l.amount)}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      height: 5,
                      borderRadius: 3,
                      background: "var(--line)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${pctFunded}%`,
                        height: "100%",
                        background: "var(--green)",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginTop: 6,
                      fontSize: 11.5,
                      color: "var(--ink-soft)",
                    }}
                  >
                    <span>{pctFunded}% funded</span>
                    {cd && cd !== "Closed" && (
                      <span style={{ color: "#b8860b", fontWeight: 500 }}>{cd}</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Stats + activity side-by-side feel via stacked compact cards */}
      {user?.kycStatus === "VERIFIED" ? (
        <>
          {stats && (
            <div style={{ marginTop: 16 }}>
              <div style={sectionTitle}>Platform</div>
              <div
                className="card"
                style={{
                  padding: 12,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "12px 10px",
                }}
              >
                {(
                  [
                    ["Under management", fmt(stats.underManagement)],
                    ["Members", String(stats.members)],
                    ["Repaid this month", String(stats.loansRepaidThisMonth)],
                    ["Open for funding", String(stats.openForFunding)],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>{label}</div>
                    <div className="mono" style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activity.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={sectionTitle}>Recent activity</div>
              <div className="card" style={{ padding: "4px 0", overflow: "hidden" }}>
                {activity.slice(0, 5).map((a, i) => (
                  <div
                    key={`${a.at}-${i}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "10px 14px",
                      borderTop: i === 0 ? "none" : "1px solid var(--line)",
                      fontSize: 12.5,
                    }}
                  >
                    <span style={{ color: "var(--ink)", lineHeight: 1.35 }}>{a.text}</span>
                    <span
                      style={{
                        color: "var(--ink-soft)",
                        whiteSpace: "nowrap",
                        fontSize: 11.5,
                      }}
                    >
                      {relativeTime(a.at)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div
          className="card"
          style={{
            marginTop: 16,
            padding: "14px 14px",
            border: "1px dashed var(--line)",
            background: "var(--green-pale)",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--green-deep)" }}>
            Unlock platform insights
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 6, lineHeight: 1.45 }}>
            Verify your identity to see under management totals, member activity, and live
            marketplace signals.
          </div>
          <Link
            to="/account"
            style={{
              display: "inline-block",
              marginTop: 10,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--green-deep)",
            }}
          >
            Verify identity →
          </Link>
        </div>
      )}


      {/* Invite compact */}
      {engagement && (
        <div
          className="card"
          style={{
            marginTop: 16,
            padding: "12px 14px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Invite friends</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>
              {engagement.referralCount > 0
                ? `${engagement.referralCount} joined with your link`
                : "Share so they can invest & guarantee you"}
            </div>
          </div>
          <button
            type="button"
            className="btn"
            style={{ fontSize: 12, padding: "8px 12px", flexShrink: 0 }}
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
            Copy link
          </button>
        </div>
      )}

      {offers.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={sectionTitle}>Offers</div>
          {offers.slice(0, 2).map((o) => (
            <div key={o.id} className="card" style={{ padding: 12, marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{o.title}</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 4, lineHeight: 1.4 }}>
                {o.description}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 18, textAlign: "center" }}>
        <Link
          to="/performance"
          style={{ fontSize: 13, color: "var(--green-deep)", fontWeight: 500 }}
        >
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
            showToast(
              `Withdraw ${fmt(amt)} (fee ${fmt(fee)}; ${fmt(total)} left your balance)`,
            );
            setModal(null);
          }}
        />
      )}
    </div>
  );
}
