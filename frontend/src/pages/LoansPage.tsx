import { useCallback, useEffect, useState } from "react";
import * as loansApi from "../api/loans";
import * as accountApi from "../api/account";
import * as publicApi from "../api/public";
import type { Loan, AccountSummary, AdminSettings, MyFunding } from "../api/types";
import type { PendingGuarantee } from "../api/loans";
import { AmountModal } from "../components/AmountModal";
import { fmt, pct, errorMessage, formatDuration, fundingCountdown } from "../utils/format";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { NewLoanModal } from "../components/NewLoanModal";

type SubTab = "marketplace" | "funded" | "mine" | "guarantees";

function funderLabel(username?: string | null) {
  if (!username || username === "__platform__") return "Platform";
  return `@${username}`;
}

function statusMeta(status: Loan["status"] | string) {
  if (status === "PENDING_GUARANTORS") {
    return { label: "Waiting on guarantors", bg: "var(--amber-pale)", fg: "#7a5a2e" };
  }
  if (status === "OPEN") {
    return { label: "Open for funding", bg: "var(--amber-pale)", fg: "#7a5a2e" };
  }
  if (status === "REPAYING") {
    return { label: "Repaying", bg: "#e6f0fb", fg: "#0c447c" };
  }
  if (status === "REPAID") {
    return { label: "Fully repaid", bg: "var(--green-pale)", fg: "var(--green-deep)" };
  }
  if (status === "CANCELLED") {
    return { label: "Cancelled", bg: "var(--line)", fg: "var(--ink-soft)" };
  }
  if (status === "DEFAULTED") {
    return { label: "Defaulted", bg: "var(--rust-pale)", fg: "var(--rust)" };
  }
  return { label: String(status), bg: "var(--line)", fg: "var(--ink-soft)" };
}

function guarantorStatusLabel(status?: string) {
  if (status === "ACCEPTED") return "accepted";
  if (status === "DECLINED") return "declined";
  if (status === "PENDING") return "pending";
  return status ?? "";
}

function packageLine(l: Loan) {
  if (l.package) return l.package.name;
  if (l.packageId) return "Package";
  return null;
}

export function LoansPage() {
  const showToast = useToast();
  const { user } = useAuth();
  const [sub, setSub] = useState<SubTab>("marketplace");
  const [marketLoans, setMarketLoans] = useState<Loan[]>([]);
  const [myLoans, setMyLoans] = useState<Loan[]>([]);
  const [myFundings, setMyFundings] = useState<MyFunding[]>([]);
  const [pendingGuarantees, setPendingGuarantees] = useState<PendingGuarantee[]>([]);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [error, setError] = useState("");
  const [fundModal, setFundModal] = useState<Loan | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [repayModal, setRepayModal] = useState<Loan | null>(null);
  const [newLoanOpen, setNewLoanOpen] = useState(false);
  const [respondBusy, setRespondBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [market, mine, funded, guarantees, acc, s] = await Promise.all([
        loansApi.marketplace(),
        loansApi.mine(),
        loansApi.funded(),
        loansApi.listPendingGuarantees(),
        accountApi.getMe(),
        publicApi.getPublicSettings(),
      ]);
      setMarketLoans(market);
      setMyLoans(mine);
      setMyFundings(funded);
      setPendingGuarantees(guarantees);
      setAccount(acc);
      setSettings(s);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (error) {
    return <div style={{ padding: 20, color: "var(--rust)", fontSize: 13.5 }}>{error}</div>;
  }
  if (!account || !settings) {
    return <div style={{ padding: 20, color: "var(--ink-soft)" }}>Loading…</div>;
  }

  const tabBtn = (id: SubTab, label: string) => (
    <button
      className="btn"
      onClick={() => setSub(id)}
      style={{
        flex: 1,
        background: sub === id ? "var(--green)" : "transparent",
        color: sub === id ? "#f4fbf4" : "var(--ink)",
        border: `1px solid ${sub === id ? "var(--green)" : "var(--line)"}`,
        fontSize: 12,
        padding: "8px 4px",
      }}
    >
      {label}
    </button>
  );

  async function respond(loanId: string, accept: boolean) {
    if (
      !window.confirm(
        accept
          ? "Accept as guarantor? Your pledged investment will be held until this loan is repaid or cancelled. If the borrower defaults, up to that held amount may be used to cover funders."
          : "Decline this guarantee request? The loan will be cancelled for the borrower.",
      )
    ) {
      return;
    }
    setRespondBusy(loanId);
    try {
      const result = await loansApi.respondGuarantor(loanId, accept);
      await load();
      if (accept) {
        showToast(
          result.status === "OPEN"
            ? "You accepted — loan is now open for funding"
            : "You accepted — waiting on other guarantors",
        );
      } else {
        showToast("You declined — loan cancelled");
      }
    } catch (err) {
      showToast(errorMessage(err));
    } finally {
      setRespondBusy(null);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {tabBtn("marketplace", "Fund a loan")}
        {tabBtn("funded", "My funding")}
        {tabBtn("mine", "My requests")}
        {tabBtn(
          "guarantees",
          pendingGuarantees.length > 0
            ? `To guarantee (${pendingGuarantees.length})`
            : "To guarantee",
        )}
      </div>

      {sub === "marketplace" && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {marketLoans.length === 0 ? (
            <div className="card" style={{ padding: "18px 16px", fontSize: 13, color: "var(--ink-soft)" }}>
              No open loan requests right now.
            </div>
          ) : (
            marketLoans.map((l) => {
              const progress = Math.min(
                100,
                Math.round((Number(l.fundedAmount) / Number(l.amount)) * 100),
              );
              const pkg = packageLine(l);
              return (
                <div key={l.id} className="card" style={{ padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>@{l.borrower?.username}</span>
                    <span className="mono" style={{ fontSize: 14 }}>
                      {fmt(l.amount)}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 4 }}>
                    {l.purpose || "General purpose loan"}
                    {pkg ? ` · ${pkg}` : ""}
                    {l.package ? ` (${formatDuration(l.package.durationHours)})` : ""}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--green-deep)", marginTop: 8 }}>
                    🛡 {l.guarantors.length}/{settings.guarantorsRequired} guarantors ·{" "}
                    {pct(l.interestRateApr)} p.a.
                  </div>
                  <div
                    style={{
                      height: 5,
                      background: "var(--line)",
                      borderRadius: 999,
                      marginTop: 8,
                      overflow: "hidden",
                    }}
                  >
                    <div style={{ width: `${progress}%`, height: "100%", background: "var(--green)" }} />
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 6 }}>
                    {progress}% funded
                    {(l.fundings?.length ?? 0) > 0 && (
                      <> · {l.fundings!.map((f) => `@${f.funder?.username ?? "?"}`).join(", ")}</>
                    )}
                  </div>
                  {l.fundingClosesAt && (
                    <div
                      style={{
                        fontSize: 12,
                        marginTop: 6,
                        color: "var(--amber, #b8860b)",
                        fontWeight: 500,
                      }}
                    >
                      {fundingCountdown(l.fundingClosesAt, nowTick)}
                    </div>
                  )}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: 10,
                    }}
                  >
                    <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                      {fmt(Number(l.amount) - Number(l.fundedAmount))} still needed
                    </span>
                    <button
                      className="btn btn-primary"
                      style={{ padding: "7px 16px", fontSize: 12.5 }}
                      onClick={() => setFundModal(l)}
                    >
                      Fund
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {sub === "funded" && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {myFundings.length === 0 ? (
            <div className="card" style={{ padding: "18px 16px", fontSize: 13, color: "var(--ink-soft)" }}>
              You haven&apos;t funded any loans yet. Open <strong>Fund a loan</strong> to get started.
            </div>
          ) : (
            myFundings.map((row) => {
              const l = row.loan;
              const meta = statusMeta(l.status);
              const myReturns = (l.repayments ?? []).flatMap((r) =>
                (r.distributions ?? []).map((d) => ({
                  repaymentStatus: r.status,
                  amount: d.amount,
                  repaymentId: r.id,
                })),
              );
              return (
                <div key={row.fundingId} className="card" style={{ padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>@{l.borrower?.username}</span>
                    <span className="badge" style={{ background: meta.bg, color: meta.fg }}>
                      {meta.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 4 }}>
                    {l.purpose || "General purpose loan"} · {pct(l.interestRateApr)} p.a.
                    {l.package ? ` · ${l.package.name}` : ""}
                  </div>
                  {l.dueAt && l.status === "REPAYING" && (
                    <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 4 }}>
                      Due {new Date(l.dueAt).toLocaleString()}
                    </div>
                  )}
                  <div
                    style={{
                      marginTop: 10,
                      background: "var(--bg)",
                      borderRadius: 10,
                      padding: "10px 12px",
                      fontSize: 12.5,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--ink-soft)" }}>You funded</span>
                      <span className="mono" style={{ fontWeight: 600 }}>
                        {fmt(row.myAmount)}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                      <span style={{ color: "var(--ink-soft)" }}>Loan size</span>
                      <span className="mono">{fmt(l.amount)}</span>
                    </div>
                    {(l.status === "REPAYING" ||
                      l.status === "REPAID" ||
                      l.status === "DEFAULTED") && (
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                        <span style={{ color: "var(--ink-soft)" }}>Outstanding (loan)</span>
                        <span className="mono">
                          {fmt(Number(l.principalOwed) + Number(l.interestOwed))}
                        </span>
                      </div>
                    )}
                  </div>
                  {l.status === "DEFAULTED" && (
                    <div style={{ fontSize: 11.5, color: "var(--rust)", marginTop: 8 }}>
                      Recovered via default settlement (borrower and/or guarantor holds).
                    </div>
                  )}
                  {myReturns.length > 0 && (
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Your share of repayments</div>
                      {myReturns.map((r, i) => {
                        const badge =
                          r.repaymentStatus === "APPROVED"
                            ? { label: "Credited", bg: "var(--green-pale)", fg: "var(--green-deep)" }
                            : r.repaymentStatus === "REJECTED"
                              ? { label: "Rejected", bg: "var(--rust-pale)", fg: "var(--rust)" }
                              : { label: "Pending approval", bg: "var(--amber-pale)", fg: "#7a5a2e" };
                        return (
                          <div
                            key={`${r.repaymentId}-${i}`}
                            style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}
                          >
                            <span className="mono">{fmt(r.amount)}</span>
                            <span className="badge" style={{ background: badge.bg, color: badge.fg }}>
                              {badge.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {sub === "guarantees" && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {pendingGuarantees.length === 0 ? (
            <div className="card" style={{ padding: "18px 16px", fontSize: 13, color: "var(--ink-soft)" }}>
              No guarantee requests waiting for you.
            </div>
          ) : (
            pendingGuarantees.map((row) => {
              const l = row.loan;
              return (
                <div key={row.id} className="card" style={{ padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>
                      @{l.borrower?.username} requests your guarantee
                    </span>
                    <span className="mono" style={{ fontSize: 14 }}>
                      {fmt(l.amount)}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 4 }}>
                    {l.purpose || "General purpose loan"}
                    {l.package ? ` · ${l.package.name}` : ""} · {pct(l.interestRateApr)} p.a.
                  </div>
                  <div
                    style={{
                      marginTop: 10,
                      background: "var(--amber-pale)",
                      borderRadius: 10,
                      padding: "10px 12px",
                      fontSize: 12.5,
                      color: "#7a5a2e",
                      lineHeight: 1.45,
                    }}
                  >
                    <strong>Your hold if you accept:</strong> {fmt(row.balanceAtPledge)} of your
                    investment principal will stay locked until this loan is repaid or cancelled. If
                    the borrower defaults, up to that amount may be used to cover funders.
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button
                      className="btn btn-primary"
                      style={{ flex: 1, padding: "10px 0", fontSize: 13 }}
                      disabled={respondBusy === l.id}
                      onClick={() => respond(l.id, true)}
                    >
                      {respondBusy === l.id ? "…" : "Accept"}
                    </button>
                    <button
                      className="btn btn-outline"
                      style={{
                        flex: 1,
                        padding: "10px 0",
                        fontSize: 13,
                        color: "var(--rust)",
                        borderColor: "var(--rust)",
                      }}
                      disabled={respondBusy === l.id}
                      onClick={() => respond(l.id, false)}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {sub === "mine" && (
        <div style={{ marginTop: 16 }}>
          <button
            className="btn btn-primary-deep"
            style={{ width: "100%", padding: "12px 0", fontSize: 14 }}
            onClick={() => setNewLoanOpen(true)}
          >
            💰 Request a loan
          </button>
          {user && (
            <button
              className="btn btn-outline"
              style={{ width: "100%", marginTop: 8, padding: "10px 0", fontSize: 12.5 }}
              onClick={async () => {
                const url = `${window.location.origin}/register?ref=${encodeURIComponent(user.username)}`;
                const text = `${url}`;
                try {
                  await navigator.clipboard.writeText(text);
                  showToast("Invite link copied");
                } catch {
                  showToast(url);
                }
              }}
            >
              Copy invite link
            </button>
          )}
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {myLoans.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                You haven&apos;t requested a loan yet.
              </div>
            ) : (
              myLoans.map((l) => {
                const pendingRepay = (l.repayments ?? [])
                  .filter((r) => r.status === "PENDING")
                  .reduce((s, r) => s + Number(r.amount), 0);
                // Prefer server amountDueNow (same formula as repay endpoint).
                const outstanding =
                  l.amountDueNow != null
                    ? Math.max(0, Number(l.amountDueNow))
                    : Math.max(
                        0,
                        Number(l.principalOwed) + Number(l.interestOwed) - pendingRepay,
                      );
                const meta = statusMeta(l.status);
                return (
                  <div key={l.id} className="card" style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span className="mono" style={{ fontSize: 14 }}>
                        {fmt(l.amount)}
                      </span>
                      <span className="badge" style={{ background: meta.bg, color: meta.fg }}>
                        {meta.label}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 4 }}>
                      {l.purpose || "General purpose loan"}
                      {l.package ? ` · ${l.package.name}` : ""}
                    </div>
                    {l.dueAt && (l.status === "REPAYING" || l.status === "OPEN") && (
                      <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 4 }}>
                        Due {new Date(l.dueAt).toLocaleString()}
                      </div>
                    )}
                    <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 6 }}>
                      Guarantors:{" "}
                      {l.guarantors
                        .map((g) => {
                          const name = "@" + (g.user?.username ?? g.userId);
                          const st = guarantorStatusLabel(g.status);
                          return st ? `${name} (${st})` : name;
                        })
                        .join(", ")}
                    </div>
                    {l.status === "PENDING_GUARANTORS" && (
                      <div style={{ fontSize: 12, color: "#7a5a2e", marginTop: 8 }}>
                        Waiting for all guarantors to accept before this loan can be funded.
                      </div>
                    )}
                    {(l.fundings?.length ?? 0) > 0 && (
                      <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 4 }}>
                        Funded by{" "}
                        {l.fundings!
                          .map((f) => `${funderLabel(f.funder?.username)} ${fmt(f.amount)}`)
                          .join(" · ")}
                      </div>
                    )}
                    {(l.status === "REPAYING" ||
                      l.status === "REPAID" ||
                      l.status === "DEFAULTED") && (
                      <div
                        style={{
                          marginTop: 10,
                          background: "var(--bg)",
                          borderRadius: 10,
                          padding: "10px 12px",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                          <span style={{ color: "var(--ink-soft)" }}>If you pay today</span>
                          <span className="mono" style={{ fontWeight: 600 }}>{fmt(outstanding)}</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 4 }}>
                          Principal {fmt(l.principalOwed)} + interest {fmt(l.interestOwed)}
                          {l.interestTierName ? ` · ${l.interestTierName}` : ""}
                          {l.interestTierRatePct ? ` (${l.interestTierRatePct}%)` : ""}
                        </div>
                        {l.fullPackageTotal != null &&
                          Number(l.fullPackageTotal) > outstanding + 0.009 && (
                          <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 4 }}>
                            Full package to term: {fmt(l.fullPackageTotal)}
                            {Number(l.earlySave ?? 0) > 0
                              ? ` · pay now and save ${fmt(l.earlySave)}`
                              : ""}
                          </div>
                        )}
                        {pendingRepay > 0 && (
                          <div style={{ fontSize: 11.5, color: "#7a5a2e", marginTop: 4 }}>
                            {fmt(pendingRepay)} submitted · waiting for confirmation
                            {outstanding <= 0 ? " · nothing left to pay" : ` · ${fmt(outstanding)} still open`}
                          </div>
                        )}
                        {l.status === "DEFAULTED" && (
                          <div style={{ fontSize: 11.5, color: "var(--rust)", marginTop: 6 }}>
                            Closed after default settlement. Funders were credited from your balance
                            and, if needed, guarantor holds.
                          </div>
                        )}
                        {l.status === "REPAYING" && pendingRepay <= 0 && outstanding > 0 && (
                          <button
                            className="btn btn-primary"
                            style={{ width: "100%", marginTop: 10, padding: "9px 0", fontSize: 12.5 }}
                            onClick={() => setRepayModal(l)}
                          >
                            Pay amount due
                          </button>
                        )}
                        {l.status === "REPAYING" && pendingRepay > 0 && (
                          <div style={{ fontSize: 12, color: "#7a5a2e", marginTop: 10 }}>
                            A repayment is waiting for confirmation. You can pay again after it is reviewed.
                          </div>
                        )}
                        {(l.repayments?.length ?? 0) > 0 && (
                          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                            {l.repayments!.map((r) => {
                              const badge =
                                r.status === "APPROVED"
                                  ? {
                                      label: "Credited to funders",
                                      bg: "var(--green-pale)",
                                      fg: "var(--green-deep)",
                                    }
                                  : r.status === "REJECTED"
                                    ? {
                                        label: "Rejected · refunded",
                                        bg: "var(--rust-pale)",
                                        fg: "var(--rust)",
                                      }
                                    : {
                                        label: "Awaiting approval",
                                        bg: "var(--amber-pale)",
                                        fg: "#7a5a2e",
                                      };
                              return (
                                <div
                                  key={r.id}
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    fontSize: 11.5,
                                  }}
                                >
                                  <span style={{ color: "var(--ink-soft)" }}>{fmt(r.amount)}</span>
                                  <span
                                    className="badge"
                                    style={{ background: badge.bg, color: badge.fg }}
                                  >
                                    {badge.label}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {fundModal && (
        <AmountModal
          title="Fund this loan"
          balanceLabel={`Your available balance: ${fmt(
            (account as { availablePrincipal?: string }).availablePrincipal ??
              account.principalBalance,
          )}`}
          confirmLabel="Fund"
          needsConfirm
          confirmHint={`Funding @${fundModal.borrower?.username ?? "borrower"}'s loan.`}
          onClose={() => setFundModal(null)}
          onSubmit={async (amt) => {
            await loansApi.fund(fundModal.id, amt);
            await load();
            showToast(`Funded ${fmt(amt)} toward ${fundModal.borrower?.username}'s loan`);
            setFundModal(null);
          }}
        />
      )}

      {repayModal && (
        <AmountModal
          title="Pay amount due"
          defaultAmount={(() => {
            if (repayModal.amountDueNow != null) {
              return Math.max(0, Number(repayModal.amountDueNow));
            }
            const pending = (repayModal.repayments ?? [])
              .filter((r) => r.status === "PENDING")
              .reduce((s, r) => s + Number(r.amount), 0);
            const booked =
              Number(repayModal.principalOwed) + Number(repayModal.interestOwed);
            return Math.max(0, Math.round((booked - pending) * 100) / 100);
          })()}
          balanceLabel={(() => {
            const left =
              repayModal.amountDueNow != null
                ? Math.max(0, Number(repayModal.amountDueNow))
                : Math.max(
                    0,
                    Number(repayModal.principalOwed) +
                      Number(repayModal.interestOwed) -
                      (repayModal.repayments ?? [])
                        .filter((r) => r.status === "PENDING")
                        .reduce((s, r) => s + Number(r.amount), 0),
                  );
            const full = repayModal.fullPackageTotal != null
              ? Number(repayModal.fullPackageTotal)
              : null;
            const save = Number(repayModal.earlySave ?? 0);
            const lines = [
              `Amount due if you pay today: ${fmt(left)} (principal ${fmt(repayModal.principalOwed)} + interest ${fmt(repayModal.interestOwed)}).`,
            ];
            if (full != null && full > left + 0.009) {
              lines.push(`Full package to term: ${fmt(full)}.`);
            }
            if (save > 0.009) {
              lines.push(`Paying now saves ${fmt(save)} versus holding to the full package.`);
            }
            if (repayModal.interestTierName) {
              lines.push(`Rate band: ${repayModal.interestTierName}${repayModal.interestTierRatePct ? ` (${repayModal.interestTierRatePct}%)` : ""}.`);
            }
            return lines.join(" ");
          })()}
          confirmLabel="Submit payment"
          needsConfirm
          confirmHint="Held until payment is confirmed. Prefer the full amount due so the loan clears in one step."
          onClose={() => setRepayModal(null)}
          onSubmit={async (amt) => {
            await loansApi.repay(repayModal.id, amt);
            await load();
            showToast(`Payment of ${fmt(amt)} submitted — waiting for confirmation`);
            setRepayModal(null);
          }}
        />
      )}

      {newLoanOpen && (
        <NewLoanModal
          settings={settings}
          onClose={() => setNewLoanOpen(false)}
          onSubmit={async (params) => {
            await loansApi.createLoan(params);
            await load();
            showToast(
              "Loan request sent — waiting on guarantors. Share your invite link if friends need to invest first.",
            );
            setNewLoanOpen(false);
            setSub("mine");
          }}
        />
      )}
    </div>
  );
}