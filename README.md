# OpenMarket

Paper-money markets on private-company valuations. Each market is a
41-bucket LMSR book over a company's next reported valuation; users buy
and sell YES/NO strike contracts with play cash, and the book's implied
median trades like a price.

This file is the canonical MVP contract. Where it conflicts with the
external `TECHNICAL_DESIGN.md` (not in this repository) or with
`PART1.md` to `PART5.md`, this file wins. Those documents remain useful
as engine, persistence, and API reference; their product decisions are
superseded by section 2.

## 1. Product

- Users: analytical people evaluating private-company valuation
  expectations. See `PRODUCT.md` for voice and anti-references and
  `DESIGN.md` for the visual system.
- Purpose: test whether a private company's next reported valuation can
  behave like a continuously traded price, with a coherent implied
  distribution, ladder, history, execution state, and portfolio before
  and after every trade.
- Flagship market: Anthropic. The engine, seeding, settlement, and
  deployment path are company-agnostic; Anthropic is the first verified
  market, not a hard-coded pair.

## 2. Decisions

Each decision carries its status against the current code.
"Implemented" means the code matches. "Drifted" means the code follows
the older design document and must change. "Open" means the decision is
still Nick's to make and is not to be treated as settled.

### D1. Account: anonymous browser account, $10,000 — Drifted

- Opening the site creates nothing. The first action that needs an
  account (a buy, a sell, or opening the portfolio) creates an anonymous
  account server-side and sets a signed, HTTP-only cookie holding an
  opaque account id and issue time. No username is collected or shown.
- Every new account starts with exactly $10,000.00 (1,000,000 cents).
- Identity comes only from the cookie. There is no route that resumes an
  account from a user-supplied identifier, so no one can take over
  another person's paper portfolio by guessing a name.
- A lost or expired cookie is a lost account in v0. No recovery, no
  email, no passwords. Cookie lifetime stays 30 days, refreshed on use.
- Admin access is unchanged: passphrase-backed, separate signed cookie.

Current code: `POST /api/user` takes a username, upserts on the
normalized name, and issues a cookie for whichever account has that
name, with a $100,000 opening balance. The header, portfolio gate, and
browser specs all assume the username flow.

### D2. Reusable engine, Anthropic first — Drifted

- Production seeding accepts one or more verified markets. It does not
  require a specific set of companies.
- Each seeded market carries its own verified anchor: valuation, date,
  description, source title, source URL, published date, and verified
  time. Draft or placeholder metadata is still refused.
- Adding a company is an operator action against the shared seed
  service, never a code change.

Current code: `scripts/production-seed.ts` requires exactly two records
named Stripe and Anthropic; `AGENTS.md` describes the product as "two
markets".

### D3. Market epochs are first-class — Drifted

- A company has at most one open market and any number of settled ones.
  Each market row is an epoch, numbered per company from 1.
- `/m/[slug]` shows the current epoch: the open market, or the newest
  settled one if none is open. `/m/[slug]/[epoch]` is a stable permalink
  to one epoch. API market payloads carry `epoch` and the epoch's own
  market id.
- Activity, marks, claims, 24-hour change, and open interest are scoped
  to one epoch by market id. Slug-scoped activity means the current
  epoch only.
- The market board shows one row per company (its current epoch) with
  the epoch number. Settled epochs are reachable from the company page
  as history, not as duplicate board rows.

Current code: the schema already allows several markets per company,
but there is no epoch number, URLs are slug-only, `getActivity` filters
on company slug and so mixes epochs, and the board lists every market
row while every row links to `/m/[slug]`, which resolves to the newest
epoch.

### D4. Open interest — Drifted

- Open interest for a market is the market maker's maximum payout
  liability in dollars: the largest, over outcome buckets, of the sum
  across all accounts of that bucket's holdings. Every contract pays
  $1.00 in its winning bucket, so this is a dollar figure that does not
  depend on how many buckets a contract's mask covers.
- It is labeled "Open interest" and formatted as currency. The board
  sorts open markets by it.

Current code: "Outstanding claims" sums every bucket entry of every
holdings vector, so one YES contract at the lowest strike counts 40
times as much as the same contract at the highest strike. That figure
is retained only as an internal diagnostic if at all.

### D5. Distribution scaling — Open

The valuation grid is universal (40 boundaries from about $15M to $11T
in half-octave steps) and seeding floors every bucket at 0.1% before
normalizing. Together these place at least a few percent of probability
mass in tails the anchor distribution assigns essentially nothing to, so
the displayed distribution and its tails are partly an artifact of the
grid, not a market view.

Options for Nick to choose between:

1. Keep the universal grid, replace the fixed 0.1% floor with a much
   smaller one (for example 1e-5) so tails reflect the seeded lognormal.
   Cheapest; strikes stay comparable across companies; far strikes stay
   nearly free to buy.
2. Scale the grid per company: 40 boundaries in fixed log steps centered
   on the anchor, stored per market as its own `bucket_grid_version`
   and boundary array. Tails are meaningful and the ladder is dense
   where the action is; strikes differ between companies and the client
   must always take boundaries from the API (it already does).

Until this is decided, nothing downstream should treat the displayed
tail probabilities as meaningful.

### D6. Deployment, migration, and seeding — Partly implemented

- Vercel builds run `next build`, then migrate the assigned Neon branch,
  then verify ledger replay in production. Builds never seed.
- Seeding is an operator action (`npm run seed:production`). It is
  idempotent on anchor identity: valuation, anchor date, and source URL.
  Re-running it against an unchanged, traded market reports "unchanged"
  and exits zero. The 30-day verification freshness rule applies only
  when a market is created or reseeded, so an old verification time can
  never turn an existing traded market into a failure.
- Migrations are append-only after launch.

Current code: builds already do not seed. But the seed script folds the
verification time into the stored anchor description, so the same seed
re-run after 30 days is both stale (refused by freshness) and different
(refused as a non-pristine reseed). Operators cannot re-run the seed
script safely once anything has traded.

### D7. What stays as designed — Implemented

- Float64 LMSR engine, 41-bucket valuation grid v1, YES/NO masks that
  partition outcomes, spend-to-shares solver, cent quantization.
- Cash as integer cents; dollar values as decimal strings at the API.
- One transaction per trade with advisory-locked idempotency, complete
  stored execution responses, and one mark per trade.
- Settlement credits each account once and freezes the market.
- Read routes on the Node runtime, no-store, request-id headers, stable
  error envelopes with no internals.
- Mutation routes require a same-origin `Origin` header and exact JSON
  content type.

## 3. Non-goals for v0

Real money or payments; passwords, email, OAuth, or recovery; order
books, leverage, or counterparties; queues, websockets, or a separate
API service; automated settlement sources; public profiles or
leaderboards; exact cross-strike cost-basis accounting.

## 4. Running it

Requirements: Node 22 (CI and Vercel pin 22; newer local versions work
but are not the deployment target), PostgreSQL 17.

```
npm ci
npm run check            # typecheck, biome, style audit, layer audit
npm run test:unit        # engine, services, routes, property tests
DATABASE_URL_TEST=postgresql://... npm run test:integration
DATABASE_URL_TEST=postgresql://... npx playwright test
npm run dev              # http://localhost:3000, never 127.0.0.1
```

- `.env.local` needs `DATABASE_URL`, `DATABASE_URL_UNPOOLED`,
  `USER_COOKIE_SECRET`, `ADMIN_COOKIE_SECRET`, and
  `ADMIN_PASSPHRASE_HASH`. Escape `$` as `\$` in that file.
- Local Playwright trap: `next dev` re-expands any variable present in
  both `.env.local` and the process environment, which strips the `$`
  fields from the admin hash Playwright injects and makes admin login
  return 500. Move `.env.local` aside for the run. CI has no
  `.env.local` and is unaffected.
- Integration tests must run against a database whose `public` schema
  has not been migrated; the per-test schemas search `public` and skip
  their own migration if a migration table is already visible.

## 5. CI and deployment

CI (`.github/workflows/ci.yml`, PostgreSQL 17 service) runs typecheck,
lint and audits, unit tests, integration tests, ledger replay, `next
build`, then the Playwright suite on desktop and mobile Chromium. The
Playwright run has an 18-minute global timeout so a stuck suite fails
with a report inside the job's 25-minute budget, and the report and
traces are uploaded on every run.

Deployment is Vercel plus Neon. `scripts/vercel-build.ts` validates the
environment for the target, builds, migrates, and (production only)
verifies replay. See `PART5.md` for the environment contract.

## 6. Drift register

| Claim | Status | Evidence |
| --- | --- | --- |
| CI blocked by a table-order assertion | Stale | Fixed before the current head; 15 integration tests pass locally and in the last pushed run. |
| CI never reaches browser tests | True, different cause | The last pushed run passed build and was cancelled at 25 minutes inside Playwright: every trade-ticket test and the critical flow waited 90 s for a `YES` button whose accessible name changed in the redesign. |
| Username account with $100,000 instead of anonymous $10,000 | True | `src/lib/services/user.ts`, `POST /api/user`; the older design document records the username flow as intentional. |
| Any known username resumes that account | True | Upsert on `username_normalized`, cookie issued without any secret. |
| Production requires exactly Stripe and Anthropic | True | `scripts/production-seed.ts`. |
| Epochs half-modeled | True | No epoch number, slug-only URLs, slug-scoped activity, board lists every market row. |
| Outstanding claims varies with mask width | True | `sum(unnest(h))` in `get-market.ts` and `list-markets.ts`. |
| Grid and floor impose artificial tails | True | Universal grid in `buckets.ts`; 0.001 floor in `seed.ts`. Decision open. |
| Deployment deadlocks after 30 days | Overstated | Builds do not seed. Re-running the seed script after 30 days fails against traded markets; deployments continue. |
