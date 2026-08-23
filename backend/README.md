# Zawadi backend

A real backend for the invest/borrow prototype: PostgreSQL + Prisma, JWT auth
with rotating refresh tokens, an append-only transaction ledger, and a
peer-to-peer loan flow with admin-gated repayment approval.

This is a **foundation**, not a launch-ready product. See "Before this
touches real money" at the bottom.

## Stack

- **Runtime**: Node.js + TypeScript, Express
- **Database**: PostgreSQL via Prisma ORM
- **Auth**: bcrypt password hashing, short-lived JWT access tokens (15m),
  long-lived opaque refresh tokens stored hashed in the DB (rotated on
  every use, revocable)
- **Money**: `Decimal` everywhere (never `Number`/`Float`) via Prisma's
  Decimal type, rounded to 2dp with half-up rounding before persisting

## Getting started

```bash
cp .env.example .env        # then fill in real secrets
npm install
npm run prisma:migrate      # creates the database schema
npm run dev                 # starts the API on :4000
```

Generate strong JWT secrets with:

```bash
openssl rand -hex 32
```

## Data model

See `prisma/schema.prisma` — it's commented inline. The short version:

- `User` / `RefreshToken` — identity and sessions
- `InvestmentAccount` / `Transaction` — the ledger. `Transaction` is the
  source of truth (append-only); `InvestmentAccount` balances are a cached
  projection that could be rebuilt from transaction history if it ever
  drifts.
- `PaymentIntent` — **unused by business logic today**, exists so the
  M-PESA/Daraja integration can slot in later without a schema change to
  money tables (see roadmap below).
- `Loan` / `LoanGuarantor` / `LoanFunding` / `LoanRepayment` /
  `LoanRepaymentDistribution` — the P2P loan lifecycle:
  1. Borrower requests a loan naming N guarantors (N and the required
     combined-coverage buffer are admin-configurable). Their combined
     investment principal must cover `amount × (1 + buffer%)`.
  2. Loan is `OPEN` in the marketplace until fully funded by one or more
     investors, at which point it flips to `REPAYING` and the full amount
     is disbursed to the borrower's own balance.
  3. Interest accrues daily on the outstanding principal.
  4. Borrower repayments are applied to the loan immediately (interest
     first, then principal) and debit the borrower's balance — but the
     payout to funders is created as a `PENDING` `LoanRepayment`.
  5. **An admin must approve or reject each repayment** before funders
     are credited. Rejecting restores the loan's outstanding balance and
     refunds the borrower.
- `AdminSettings` — singleton row: investment rate, loan rate, guarantors
  required, coverage buffer.
- `AuditLog` — every privileged/money-moving action should write here.

## API surface

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | — | rate-limited |
| POST | `/api/auth/login` | — | rate-limited |
| POST | `/api/auth/refresh` | refresh cookie | rotates the token |
| POST | `/api/auth/logout` | refresh cookie | |
| GET | `/api/account/me` | user | balance |
| GET | `/api/account/transactions` | user | |
| POST | `/api/account/invest` | user | **direct ledger credit — see below** |
| POST | `/api/account/withdraw` | user | |
| POST | `/api/loans` | user | create a loan request |
| GET | `/api/loans/marketplace` | user | open loans, excluding your own |
| GET | `/api/loans/mine` | user | your requests + repayment history |
| POST | `/api/loans/:id/fund` | user | |
| POST | `/api/loans/:id/repay` | user | borrower only |
| GET/PUT | `/api/admin/settings` | admin | |
| GET/POST/DELETE | `/api/admin/offers` | admin | |
| GET | `/api/admin/repayments/pending` | admin | |
| POST | `/api/admin/repayments/:id/approve` | admin | |
| POST | `/api/admin/repayments/:id/reject` | admin | |

Access tokens are returned in the `X-Access-Token` response header (keep
them in memory client-side, not localStorage). Refresh tokens are set as
an `httpOnly`, `sameSite=strict` cookie scoped to `/api/auth`.

## Before this touches real money

This backend gets you a real auth model and a real ledger. It is **not**
sufficient on its own to operate a lending/investment product for the
public. Before any real money moves:

1. **Payment integration.** `/api/account/invest` and `/withdraw` today
   credit/debit the ledger directly on request — fine for development,
   unacceptable in production (anyone could credit their own account).
   Real deposits/withdrawals need to go through M-PESA's Daraja API:
   an STK push creates a `PENDING` `PaymentIntent`, and only Safaricom's
   confirmation webhook (verified, idempotent) should ever credit the
   ledger.
2. **KYC/AML.** `User.kycStatus` exists but nothing enforces it yet.
   Real accounts need identity verification before they can invest or
   borrow past small limits.
3. **Licensing.** Taking public deposits/investments and originating
   loans are both regulated activities in Kenya (CBK, CMA). Get legal
   review before opening this to real users with real money — this is
   not something engineering can resolve.
4. **Move the accrual job out-of-process.** It currently runs in the API
   process via `node-cron`; fine for one instance, unsafe once you scale
   to more than one (interest would accrue multiple times per day). Move
   it to a dedicated worker/scheduled job before that happens.
5. **Independent security review** of the auth flow, rate limits, and the
   money-movement transactions before going live — an outside pair of
   eyes matters more here than anywhere else in the codebase.
