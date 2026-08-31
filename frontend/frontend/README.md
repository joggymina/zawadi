# Zawadi frontend

Vite + React + TypeScript SPA against the real `zawadi-backend` API — no
mock data, no browser-storage state. Every screen reads and writes
through the backend's ledger.

## Getting started

```bash
cp .env.example .env    # point VITE_API_URL at your running backend
npm install
npm run dev              # http://localhost:5173
```

Run the backend first (see `../backend/README.md`) — the API defaults to
`http://localhost:4000` and this app expects `VITE_API_URL` to match.

## How auth works here

- Access tokens live **in memory only** (`src/api/client.ts`), never in
  `localStorage`/`sessionStorage` — an XSS bug shouldn't be able to walk
  off with a long-lived credential.
- The refresh token is an `httpOnly` cookie the browser sends
  automatically; JS never touches it directly.
- On page load, `AuthProvider` calls `/api/auth/refresh` once to silently
  restore a session. A 401 on any authenticated request triggers one
  retry-after-refresh before giving up and redirecting to `/login`.

## Structure

- `src/api/` — one file per backend resource (`auth`, `account`, `loans`,
  `admin`, `public`), all going through the shared `client.ts` request
  helper. `types.ts` mirrors the Prisma models returned by the API.
- `src/context/` — `AuthContext` (session) and `ToastContext` (inline
  notifications).
- `src/components/` — `AppLayout` (header + bottom nav + auth guard),
  `AmountModal` (shared invest/withdraw/fund/repay input), `NewLoanModal`.
- `src/pages/` — one per route: Home, Performance, Loans, Account, Admin,
  plus Login/Register outside the authenticated shell.

## A deliberate gap you'll notice

There's no "browse other users and see their balance" screen for picking
loan guarantors, even though the backend supports the guarantor-coverage
rule. That's intentional — exposing every user's investment balance so
someone else can browse it would be a real privacy problem. Guarantors
are entered by username (people who've agreed offline), and the backend
validates the combined coverage without ever handing individual balances
back to the borrower.

## Known rough edges

- No optimistic UI / loading skeletons — pages show a plain "Loading…"
  and re-fetch after every mutation. Fine for validating the product,
  worth revisiting before a real launch.
- No form-level accessibility audit yet (labels are present, but no
  screen-reader testing has been done).
- No automated tests. Given this handles money, adding integration tests
  for the invest/fund/repay/approve flows should happen before this goes
  near real users.
