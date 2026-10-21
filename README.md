# OpenMarket

Paper-money markets on private-company valuations. The current code
runs a 41-bucket LMSR book per company over its next reported
valuation. The adopted design (D10–D14, Oct 2026) replaces that trading
surface with two contracts per listed name — a quarterly timing binary
and a next-print forward — quoted by the venue as dealer, with a
published model mid and a reference-price API. `CONTRACTS.md` is
normative for the instruments; `TECHNICAL_DESIGN.md` says how they are
built; `backtest/` holds the evidence.

This file is the canonical MVP contract. Where it conflicts with
`TECHNICAL_DESIGN.md`, `CONTRACTS.md` or `PART1.md` to `PART5.md`,
this file wins. The PART documents remain useful as engine,
persistence, and API reference; their product decisions are superseded
by section 2.

## 1. Product

- Users: analytical people evaluating private-company valuation
  expectations. See `PRODUCT.md` for voice and anti-references and
  `DESIGN.md` for the visual system.
- Purpose: test whether a private company's next reported valuation can
  behave like a continuously traded price, with a coherent implied
  distribution, ladder, history, execution state, and portfolio before
  and after every trade.
- Launch universe (D10): OpenAI, Anthropic, Anduril, Modal, Instinct.
  The engine, seeding, settlement, and deployment path are
  company-agnostic; names are added by operator action against the
  listing rule, never by code change.
- The product OpenMarket manufactures is a reference price: a forward
  curve (how big, when) on each listed name's next print, backed by a
  two-way dealer quote and published through `/api/ref/*`.

## 2. Decisions

Each decision carries its status against the current code.
"Implemented" means the code matches. "Drifted" means the code follows
the older design document and must change. "Open" means the decision is
still Nick's to make and is not to be treated as settled.

### D1. Account: shared username paper account, $100,000 — Implemented

- Opening the site creates nothing. Entering a username opens or resumes
  that paper account with a signed, HTTP-only, 30-day cookie.
- Usernames accept 3–20 ASCII letters, numbers, or underscores. Uniqueness
  is case-insensitive; the original stored spelling remains the display name.
- Every new account starts with exactly $100,000.00 (10,000,000 cents).
- Usernames identify shared paper accounts, not verified people. Anyone
  who knows a username can resume its account through the normal flow.
  Cookie signatures prevent tampering, not impersonation through username entry.
- Trading and commenting resolve the stable user ID on the server from
  the signed cookie. A client-supplied expected account is only a stale-session
  check, never authorization to act as that account.
- Account ownership protection is a separate future product decision.
  This supersedes the earlier anonymous-account/no-username direction.
- Admin access remains passphrase-backed with a separate signed cookie.

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

### D4. Open interest — Implemented

- Open interest for a market is the market maker's maximum payout
  liability in dollars: the largest, over outcome buckets, of the sum
  across all accounts of that bucket's holdings. Every contract pays
  $1.00 in its winning bucket, so this is a dollar figure that does not
  depend on how many buckets a contract's mask covers.
- It is labeled "Open interest" and formatted as currency. The board
  sorts open markets by it.

Current code: `openInterestSql` in `src/lib/services/open-interest.ts`
is the one query; `listMarkets` and `getMarket` both return it as
`openInterest`. The board column, the home strip (summed over open
markets) and the market header all read "Open interest" in dollars. The
old summed-bucket "Outstanding claims" figure is gone.

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

### D8. Market discussion — Implemented

- Each market ID has a public discussion between Distribution and Market Activity,
  including after settlement. Roots load 20 at a time, newest first; one-level
  replies load oldest first. New arrivals wait behind an explicit reveal action.
- Comments are trimmed plain text, 1–2,000 UTF-16 units, with preserved line breaks.
  They use the stored account username and cookie-derived user ID. The composer
  discloses that shared usernames are not verified identities.
- Drafts survive account selection and require explicit adoption when their account
  changes. Publishing is always explicit. Uncertain submissions retain their UUID
  and original payload for retry; abandoning a retry does not undo a possible post.
- Ordinary users cannot edit or delete comments. The authenticated `/admin`
  moderation panel replaces removed bodies with tombstones and preserves replies.
- PostgreSQL enforces retry deduplication and posting quotas: 5 accepted posts per
  account and 20 per network in each 60-second window. Replays consume no quota.
  Comments do not change trading balances, holdings, marks, or market sequences.
- Public routes: `GET`/`POST /api/markets/by-id/[marketId]/comments`, with optional
  `parentId` and `cursor` on reads. Removal: `POST /api/admin/comments/[commentId]/remove`.
  Comment refreshes are independent of trading and pause in background tabs.

### D9. Forecasting tournament — Implemented on branch

The log-scored forecasting tournament under `/t` (its own users,
sessions, questions and append-only forecast ledger; X OAuth or
username sign-in; hourly Merkle roots posted to Solana) lives on
`claude/kind-bohr-nf4w3p` and is ahead of `master` by ~155 files.
Merging it is milestone 1 of `TECHNICAL_DESIGN.md` §12. Its README
section D9 becomes this one on merge.

### D10. Launch universe: five names, two prices each — Adopted

- OpenAI, Anthropic, Anduril, Modal, Instinct. No third frontier lab
  for now.
- Listing rule: last print ≥ ~$500M, last priced round ≤ 9 months ago,
  lead of the last round identifiable from public record. A name that
  fails any clause is not listed. Scaling means adding names at two
  prices each, never adding contract types or states.
- Tier by last print: mega-cap ≥ $10B, red-hot below. Tier sets the
  prior and the dealer's depth, never a settlement rule.

Current code: `scripts/production-seed.ts` requires exactly Stripe and
Anthropic. Supersedes the D2 flagship line.

### D11. Two contracts per name — Adopted

- **Quarterly timing binary**: "priced round announced by quarter-end"
  (labs: "public S-1 filed by quarter-end"). YES/NO, resolves every
  quarter without fail, early-resolves YES and rolls the same day.
  Prices *when*.
- **Next-print forward**: cash-settled in log step-up of the next
  post-money against each position's entry price, clipped at ±κ
  (default 1.0), **voided with full refund if no print by expiry**.
  Prices *how big*, conditional on a round. Expiry is **per name**
  (`listings.forward_t_days`; launch 270/180/270/120/90 days for
  OpenAI/Anthropic/Anduril/Modal/Instinct).
- One binary, not a two-expiry strip; the forward stays separate from
  the binary rather than blended, so the API publishes a hazard and a
  conditional valuation as two numbers.
- The 41-bucket ladder survives as a read-only implied distribution
  drawn from the forward mid and the prior width. It is no longer a
  trading surface. D5 (grid scaling) is moot for trading and stays
  open only for the display.

Full semantics, edge cases and lifecycle: `CONTRACTS.md`.

Current code: trades YES/NO threshold claims against the ladder.

### D12. The venue is the dealer — Adopted

- The house always quotes both contracts, so a price exists before any
  trader does. Binary: the existing LMSR with `n_buckets = 2`, b per
  listing (default $2,000), price clamped to [0.05, 0.95]. Forward:
  an inventory-skewed two-way quote around a published model mid, with
  a hard position cap Q per side per name (default $25,000).
- Hard loss bound per name: Q·κ per forward settlement plus
  b·ln(1/p_floor) per binary quarter (≈ $6,000 at defaults — the
  b·ln 2 figure only holds from 50/50). Five names at defaults ≈
  $370k/yr worst case; the backtest's realised insider loss is ~20% of
  the bound carried.
- Event flags (Tier-1 scoop, Form D, charter amendment, "closing"
  statement) widen the spread ×3, halve Q for new positions and halve b
  for 72 hours or until the model re-prices.
- Informed traders are supply, not risk: the bound is the price paid
  to turn leaked term sheets into a public price.
- Restricted persons (employees, directors, investors of a listed
  name) may not trade it. Attestation and hiding in play money;
  KYC-backed later.
- Parameters (μ, λ, k, σ per tier, T proposals) are owned by
  `backtest/`, written to `backtest/out/params.json` and read at build
  time. A hand-edited parameter is a failing test.

### D13. Rulebook and settlement — Adopted

- A print is the post-money of a priced primary equity round (labs:
  also IPO first-day-close market cap). Not SAFEs, notes, same-price
  extensions, secondaries, tenders or debt.
- Source ranks: 1 company/lead release; 2 SEC filing; 3 two
  independent Tier-1 outlets citing closed terms; 4 one Tier-1 outlet.
  State charter price-per-share re-centres the mid and never settles.
- Undisclosed valuation: the binary resolves YES; the forward waits up
  to T, then voids. A higher-ranked revision within 7 days supersedes.
- The rulebook is code (`src/lib/engine/dealer/rulebook.ts`),
  versioned, exported at `/api/ref/rulebook`, with `backtest/events.csv`
  as the fixture every change must still resolve.
- OpenMarket does not own the hierarchy; it publishes it. The reason
  not to list on Kalshi is network effects on one vertical, not that
  they cannot list a curve.

### D14. Reference price API — Adopted

- Public, read-only, 60 s cache. Every payload carries
  `model_version`, `rulebook_version`, `blend_version`, `as_of` and,
  for the forward, `dealer_inventory_sign`.
- The published reference is a pre-committed blend of model mid,
  30-day traded price and the tournament crowd, with weights that move
  on a published schedule (`TECHNICAL_DESIGN.md` §8). With no flow and
  no crowd the reference *is* the model mid and says so.
- The model's forecast log (`model_mids`) is public and unredacted.
- A keyed tier exists from day one so the first desk that asks gets a
  key the same day; nothing is gated at launch.

## 3. Non-goals for v0

Real money, rails or payments; a central limit order book (the dealer
is the first resting liquidity; an order book comes with flow);
leverage; queues, websockets, or a separate API service; KYC; exact
cross-strike cost-basis accounting; the hot-50 (five names first,
scaled by adding names).

Reinstated from the shelf: the quarterly timing binary (D11) is the
"by date" market that was built on `shelved/timing-strips` and not
shipped. That branch is no longer on the remote; the design in
`CONTRACTS.md` supersedes its docs.

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
- Integration tests create isolated schemas and explicitly scope their migration
  tables, so concurrent suites do not share migration state.
- Comment posting in production requires Vercel's trusted
  `x-vercel-forwarded-for` header with `VERCEL=1`; missing or unsupported trusted
  addressing disables posting, not reading or trading. Forwarding headers supplied
  by clients are not used in local development, where requests share one bucket.
  Network keys are HMAC-hashed; raw addresses are not stored. Limits return HTTP 429
  with `Retry-After`. Apply migration `002_market_comments` before serving this version.

### Backtest

```
python3 backtest/analyze.py          # tables to backtest/out, four charts
```

`backtest/events.csv` is 56 priced rounds across 14 names (the five
listed names plus Cursor, SSI, xAI, Mercor, Harvey, Cognition,
Perplexity, Valar Atomics, Greptile), Jan 2024–Oct 2026, each row
sourced in `backtest/data/`. Scenarios and results are in
`TECHNICAL_DESIGN.md` §10. Requires pandas, numpy, matplotlib.

## 5. CI and deployment

CI (`.github/workflows/ci.yml`, PostgreSQL 17 service) runs typecheck,
lint and audits, unit tests, integration tests, ledger replay, `next
build`, then the Playwright suite on desktop and mobile Chromium. The
Playwright run has an 18-minute global timeout so a stuck suite fails
with a report inside the job's 25-minute budget, and the report and
traces are uploaded on every run.

Deployment is Vercel plus Neon. `scripts/vercel-build.ts` validates the
environment for the target, migrates, verifies ledger replay, then builds.
See `PART5.md` for the environment contract.

## 6. Drift register

| Claim | Status | Evidence |
| --- | --- | --- |
| CI blocked by a table-order assertion | Stale | Fixed before the current head; 15 integration tests pass locally and in the last pushed run. |
| CI never reaches browser tests | True, different cause | The last pushed run passed build and was cancelled at 25 minutes inside Playwright: every trade-ticket test and the critical flow waited 90 s for a `YES` button whose accessible name changed in the redesign. |
| Shared username account with $100,000 opening balance | Intentional | D1 retains the existing username flow; anonymous accounts are no longer the target. |
| Any known username resumes that account | True | Upsert on `username_normalized`, cookie issued without any secret. |
| Production requires exactly Stripe and Anthropic | True | `scripts/production-seed.ts`. |
| Epochs half-modeled | True | No epoch number, slug-only URLs, slug-scoped activity, board lists every market row. |
| Outstanding claims varies with mask width | Fixed | Both services read `openInterestSql`, the largest per-bucket total. |
| Grid and floor impose artificial tails | True | Universal grid in `buckets.ts`; 0.001 floor in `seed.ts`. Decision open. |
| Deployment deadlocks after 30 days | Overstated | Builds do not seed. Re-running the seed script after 30 days fails against traded markets; deployments continue. |
| Trading surface is the 41-bucket ladder | True, superseded | D11 adopts a binary + forward per name; the ladder becomes a display. No dealer code exists yet; `TECHNICAL_DESIGN.md` §12 is the plan. |
| Tournament is in `master` | False | It is on `claude/kind-bohr-nf4w3p`; merge is milestone 1. |
| `shelved/timing-strips` branch exists | False | Not on the remote as of 2026-10-21; the "by date" market is reinstated as D11's binary. |
| Loss bound on a binary is b·ln 2 | False | Only from a 50/50 start; against a hazard prior it is b·ln(1/p_floor). D12 states the correct figure. |
