# OpenMarket

Paper-money markets on private-company valuations. The first build
traded a 41-bucket LMSR book per company over its next reported
valuation; milestone 6 removed those markets (migration `008`), and
their trading code stays only until the dealer ticket replaces it. The
adopted design (D10–D14, Oct 2026) replaces that trading
surface with two contracts per listed name — a quarterly timing binary
and a next-print forward — quoted by the venue as dealer, with a
published model mid and a reference-price API. `CONTRACTS.md` is
normative for the instruments; `TECHNICAL_DESIGN.md` says how they are
built; `backtest/` holds the evidence (`backtest/RESULTS.md` explains
it); `docs/ARTIFACTS.md` indexes every artifact, in the repo or not;
`docs/prompts/implement-dealer.md` is the brief for the agent that
builds it.

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

### D1. Account: tournament sign-in, $100,000 paper balance — Implemented

Decided 2026-10-21, superseding the shared-username paper account and
the passphrase admin, both removed with every trace.

- Tournament sign-in (D9: X, or a username and password under `/t`) is
  the only identity. Signing in alone opens no paper account.
- A paper account is a `users` row keyed by `tournament_user_id`. The
  first quote, trade, portfolio read or comment of a signed-in user opens
  it with exactly $100,000.00 (10,000,000 cents); concurrent first
  requests open one row.
- Trading and commenting resolve the account on the server from the
  session cookie. A client-supplied expected account is only a
  stale-session check, never authorization to act as that account.
- `/admin` and every `/api/admin/*` route admit only the tournament admin
  allowlist (`TOURNAMENT_ADMIN_X_IDS`).

Current code: `requireCurrentUserId` (`src/lib/auth/current-user.ts`)
resolves the tournament session and calls `ensurePaperAccount`
(`src/lib/services/user.ts`: insert on conflict do nothing, then
select). Admin routes call `requireTournamentAdmin`. Migration
`008_retire_ladder_and_username_accounts` deleted every username
account and its trades, holdings and comments.

### D2. Reusable engine, Anthropic first — Superseded

Superseded by D10: names are listed by operator action against the
listing rule (`npm run seed:listings`), never by code change. The
ladder's production seed, which required exactly Stripe and Anthropic,
is deleted, and no path seeds a 41-bucket market any more.

### D3. Market epochs are first-class — Superseded

Asked for numbered epochs per company on the ladder markets, which are
gone (milestone 6). The dealer numbers them on `instruments.epoch`, per
listing and kind from 1, a successor at the next (`007_dealer`); how
the market page addresses an epoch is the dealer UI's to decide.

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

### D5. Distribution scaling — Open, display only

No ladder market trades any more (D11, milestone 6); this now governs
only the read-only implied distribution. The valuation grid is
universal (40 boundaries from about $15M to $11T in half-octave steps)
and seeding floors every bucket at 0.1% before normalizing. Together these place at least a few percent of probability
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

### D6. Deployment, migration, and listing — Implemented

- Builds migrate and verify replay (§5); they never seed or list.
- Listing is an operator action (`npm run seed:listings`), idempotent on
  (company, listed_at) (D10).
- Migrations are append-only after launch. One owner-approved exception
  (Nick, 2026-10-21): `008_retire_ladder_and_username_accounts` deletes
  the ladder markets, Stripe and every username account.

Current code: `scripts/vercel-build.ts`. The ladder's production seed
and its 30-day freshness rule are deleted.

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
  The byline is the author's tournament identity (D1): an @ handle from X, or a
  username without an @, resolved on the server from the session.
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

### D9. Forecasting tournament — Implemented

A log-scored forecasting tournament under `/t`, separate from the paper
markets: its own users, sessions, questions, and ledger
(`tournament_*` tables, migration `004_tournament`). No money, trading,
LMSR, or tokens. A tournament user's paper account (D1) is keyed by
this identity, but cash and positions never enter scoring.

- Identity: X OAuth 2.0 with PKCE (`users.read tweet.read`, no write
  scopes, no `offline.access`; the token is dropped after the profile
  fetch), or a username and password (scrypt with fixed work factors;
  no email, no recovery). The numeric X id is an X account's
  identity; handle, name, avatar, `verified`, and account creation date
  are refreshed on every sign-in. Usernames live in their own namespace:
  shown without an "@", never linked to X, at `/t/u/~username`, so a
  username can never pass for an X handle. Username accounts have no
  external account age, so `min_account_age_days` applies to X accounts
  only. Registration is limited per network (5 an hour); failed sign-ins
  per network and per username (10 per 15 minutes). Sessions are
  server-side rows keyed by the SHA-256 of an opaque cookie token,
  30-day sliding expiry. Admin is an allowlist (`TOURNAMENT_ADMIN_X_IDS`:
  X ids, or `password:<username>`) for `/t/admin` and `/admin`.
- Affiliation: any forecaster may state one (lab, school, firm; up to 60
  characters, free text with a suggested list in
  `src/lib/config/tournament-affiliations.ts`). It is self-reported,
  never verified, shown in gray beside the name everywhere, and an admin
  can override or clear it.
- Questions: a discrete distribution over buckets that tile the line
  (lower inclusive, upper exclusive) plus one floor bucket ("nothing by
  expiry") on numeric ladders; binaries are Yes/No. Drafts are editable;
  opening pins the record. Close is automatic at `closes_at`, or manual
  and back-dated to a resolution document's public time (later events
  stay in the log and are never counted).
- Forecasts: append-only events, renormalized to ten decimals, hashed
  (`event_hash`, phase-2 provenance input), one per user and question
  per 10 seconds, refused for X accounts younger than the question's
  `min_account_age_days` (default 90).
- Aggregate: geometric mean of odds over each non-flagged forecaster's
  latest vector, clamped at ε = 0.001, extremized (a = 1.5, stored per
  question and per row with weighting `equal-v1`), recomputed on every
  write. Published only from five forecasters; derived median (floor
  excluded, log-linear inside the crossing bucket, open ends report
  their edge), P(floor), P(yes).
- Scoring: time-averaged log score relative to uniform, 100 / ln n ×
  mean of ln(n · max(p, ε)) on the winning bucket over the open window;
  uniform before a first forecast; coverage recorded, not ranked. Written
  once per resolution as immutable rows. A correction inside the 72-hour
  dispute window supersedes the live resolution and rescoring writes a
  new set; afterwards nothing changes. Voided questions write no scores.
- Leaderboard: sum of scores over live resolutions in the period (all
  time, or a calendar month in America/Los_Angeles); ties break on mean
  coverage. Flagged accounts are scored and shown, marked, and excluded
  from the aggregate.
- Database triggers keep `tournament_forecast_events` and
  `tournament_scores` append-only and let a resolution change only by
  being superseded. `npm run verify:replay` also recomputes every stored
  score and every open question's live aggregate from the event log.

Pages: `/t` (questions and implied EV/ARR), `/t/signin`, `/t/q/[slug]`,
`/t/u/[handle]`, `/t/leaderboard`, `/t/admin`. Public JSON, cacheable
for 10 seconds: `GET /api/t/questions`, `/api/t/questions/[slug]`,
`/api/t/questions/[slug]/forecasts`,
`/api/t/questions/[slug]/aggregate/history`,
`/api/t/leaderboard?period=all|YYYY-MM`, `/api/t/users/[handle]`,
`/api/t/derived`. Session: `GET /api/t/me`,
`POST /api/t/questions/[slug]/forecasts`, `POST /api/t/me/affiliation`,
`POST /api/t/auth/logout`; username accounts:
`POST /api/t/auth/password/register` and `/login`;
X sign-in starts at `GET /api/t/auth/x/start?return=<path>` (any
same-site page path but the API and `/t/signin`). Admin:
`POST /api/t/admin/questions` (save draft), and
`/api/t/admin/questions/[slug]/{open,close,resolve,void,notes}`,
`/api/t/admin/users/flag`, `/api/t/admin/users/affiliation`.

Provenance (phase 2): an hourly job commits each completed hour's event
hashes to one SHA-256 Merkle root (leaf = sha256(0x00 ‖ event_hash),
node = sha256(0x01 ‖ left ‖ right), odd nodes promoted) five minutes
after the hour ends, stores every event's path, and posts
`openmarket.tournament.v1 <hour> <root> <leaf count>` as an SPL Memo
transaction from a system wallet. The transaction is built and signed
without a Solana SDK (Node's ed25519), and a post that never lands is
re-sent after three minutes. `/t/provenance/[eventId]` (JSON at
`/api/t/provenance/[eventId]`) shows the hash inputs, batch, path, and
transaction, and re-verifies the hash chain in the visitor's browser.
Leaves are append-only and batch commitments immutable; `verify:replay`
rebuilds every root.

Not built yet: CSV export, track-record weighting, password change and
recovery, prize payment (off-platform by design).

### D10. Launch universe: five names, two prices each — Adopted

- OpenAI, Anthropic, Anduril, Modal, Instinct. No third frontier lab
  for now.
- Listing rule: last print ≥ ~$500M, last priced round ≤ 9 months ago,
  lead of the last round identifiable from public record. A name that
  fails any clause is not listed. Scaling means adding names at two
  prices each, never adding contract types or states.
- Tier by last print: mega-cap ≥ $10B, red-hot below. Tier sets the
  prior and the dealer's depth, never a settlement rule. At their
  current prints all five names are mega-cap (Instinct $10B, Modal
  $15.75B); confirmed 2026-10-21.
- The Anthropic and Stripe ladder markets are removed with their rows
  (migration `008`). Stripe is not listed (decided 2026-10-21).

Current code: `npm run seed:listings -- --listed-at=<ISO>` writes one
`listings` row per name (migration `007_dealer`) from its last priced
round in `backtest/events.csv`, that round's source in
`backtest/data/sources.csv`, and `params.json`. It is idempotent on
(company, listed_at), replaces an active listing only with `--relist`,
and refuses, writing nothing, while any anchor lacks a source URL; the
sources file is not committed yet. It lists no instruments (milestone
6). Supersedes D2.

### D11. Two contracts per name — Adopted

A quarterly timing binary (prices *when*) and a next-print forward
that voids with refund if no print by its per-name expiry (prices *how
big*). One binary, not a strip; the forward separate, not blended. The
41-bucket ladder is a read-only display, no longer a trading surface
(D5 stays open for the display only). Semantics, edge cases and
lifecycle: `CONTRACTS.md`.

Closing a forward before settlement is not decided; until it is, a
position is held to settlement or void, and the ticket says so.

Current code: the dealer job lists both instruments per active listing,
each on its own `markets` book (binary `yes_probability`, forward
`forward_ln`). `GET /api/instruments/[id]/quote` quotes either;
`POST /api/forward/trade` opens a position at the ask or bid with N·κ
collateral; `/api/quote` and `/api/trade` trade a dealer binary by
`market_id`. No ladder market remains (migration `008`); the ladder's
quote and trade routes and its ticket stay until the dealer ticket
replaces them. No route closes a forward early. The launch T per name is carried in
`backtest/out/params.json` as a declared proposal (`FORWARD_T_DAYS` in
`backtest/analyze.py`); the backtest does not compute it yet
(`per_name_t` is still to run).

### D12. The venue is the dealer — Adopted

The house always quotes both contracts: the existing LMSR with
`n_buckets = 2` on the binary, an inventory-skewed two-way quote around
a published model mid with a hard position cap on the forward; spread
widens and cap halves on event flags. Worst case per name is Q·κ per
forward settlement plus b·ln(1/p_floor) per binary quarter (not b·ln 2,
which only holds from 50/50). Parameters are owned by `backtest/`
(`out/params.json`) and read at build time; a hand-edited parameter is
a failing test. Formulas and defaults: `CONTRACTS.md` → The dealer;
evidence: `backtest/RESULTS.md`.

The labs' binary ("public S-1 by quarter-end") uses the backtest's
round-hazard prior as-is (decided 2026-10-21).

Current code: `backtest/analyze.py` writes `backtest/out/params.json`
with the SHA-256 of its inputs; `src/lib/config/dealer.ts` imports and
validates it, and maps each `MODEL_VERSION` to the digest of the
file it published. `tests/config/dealer-params.test.ts` fails when the
file is stale against the backtest, changed without a version entry
for its new digest, or overridden in code;
`.github/workflows/backtest.yml` fails when a rerun does not reproduce
it. Rewriting a published version's digest instead of adding one is
not caught by a test, only by review. `src/lib/engine/dealer/prior.ts`
ports sim.py's prior (tier, binary p, forward mid with leak re-centring);
`tests/engine/dealer/prior.test.ts` agrees with
`backtest/out/prior_golden.json`, which `backtest/golden.py` writes from
sim.py, to 1e-9. `GET /api/cron/dealer` (`dealer.yml`, every 15 min at
:05) runs its steps in one transaction per `X-Run-Id` (a rerun reports
"already ran"); its mids step, `services/dealer/compute-mids.ts`,
appends a `model_mids` row per live instrument from the listing's anchor,
params.json and the scoops and releases since the anchor, only when the
mid or its inputs moved, and `verify:replay` recomputes every row from its
`inputs_json` to 1e-12. `src/lib/engine/dealer/forward.ts`
(quote, fill, collateral, settlement credit), `binary.ts` (two-outcome
seed, price clamp, loss bounds) and `lifecycle.ts` (`instruments.state`
transitions) are pure. The dealer job's steps run state (widen/restore a
forward on flags observed since its last change; s ×3, Q ÷2 until a newer
mid or 72 h), list, mids and requote, posting a `quotes` row only when a
quote moved; a binary is seeded once at the model p, never widened, and
refuses a trade past [p_floor, 1 − p_floor]. `dealer_pnl` (migration
`009_dealer_pnl`) reports realised, open collateral, unrealised and bound
per instrument; `verify:replay` replays forward books by forward rules and
recomputes every quote.

### D13. Rulebook and settlement — Adopted

A print is the post-money of a priced primary round (IPO first-day
close for the labs). Source ranks 1–4, 7-day revision window, void on
no print. The rulebook is code (`src/lib/engine/dealer/rulebook.ts`),
versioned, exported at `/api/ref/rulebook`, with `backtest/events.csv`
as its fixture. OpenMarket publishes the hierarchy, it does not own it;
the argument against Kalshi is network effects on one vertical. Rules
as data: `CONTRACTS.md` → Definitions.

Both instruments allow a day after their deadline for an announcement
dated on or before it to be observed: the binary resolves NO, and the
forward voids, one day after T.

Current code: `src/lib/engine/dealer/rulebook.ts` (v1.0.0) states the
rules as data and resolves a binary or a forward from the events it is
given, including the binary's expiry with the 21-day floor (decision
0002), an acquisition (settles at a disclosed equity value,
voids at once on an undisclosed one) and a higher-ranked revision
dated past expiry; `GET /api/ref/rulebook` publishes it with `rulebook_version`,
`model_version` and `as_of`. `tests/fixtures/rulebook-events.json`
records how it resolves every row of `backtest/events.csv` (each row
entering as rank 1, since the file carries no source rank).
`GET /api/cron/settle` (`settle.yml`, hourly at :41) settles each live
instrument in its own transaction: promotes high-confidence rank 1–2
releases and S-1s with a post-money to prints (rank 3–4 is reported
pending; no admin queue yet), resolves through the rulebook, pays a
binary $1 a share or settles forward positions at
`settlementCreditCents` (a void refunds collateral), and lists the
successor (a binary from the announcement that resolved it). A forward
settled while a higher rank could still supersede it is recorded with
`final: false`; the correcting settlement is not built.

### D14. Reference price API — Adopted

- Public, read-only, 60 s cache. Every payload carries
  `model_version`, `rulebook_version`, `blend_version`, `as_of` and,
  for the forward, `dealer_inventory_sign`.
- The published reference is a pre-committed blend of model mid,
  30-day traded price and the tournament crowd, with weights that move
  on a published schedule (`TECHNICAL_DESIGN.md` §8). With no flow and
  no crowd the reference *is* the model mid and says so.
- The blend constants (V₀, n₀, N_min, the weight caps, the 30-day
  window) are policy, not backtest parameters: they live in
  `src/lib/engine/dealer/blend.ts` as the published schedule under
  `BLEND_VERSION`, every reference payload carries them, and changing
  one is a new blend version, never an edit to a published one.
- The model's forecast log (`model_mids`) is public and unredacted.
- A keyed tier exists from day one so the first desk that asks gets a
  key the same day; nothing is gated at launch.

Current code: `src/lib/engine/dealer/blend.ts` (`BLEND_VERSION`
1.0.0) is the blend; the dealer job's last step, `reference`
(`services/dealer/reference-prices.ts`), appends a `reference_prices`
row per listing and kind when its value, weights, versions or
instrument move, with `components_json` citing the model mid by id,
the 30-day traded average on the instrument's own book
(notional-weighted entry for the forward, cash-weighted YES price for
the binary) and the linked tournament aggregate
(`tournament_instrument_links`, milestone 7; no link, no crowd);
`verify:replay` recomputes every row from its components and each
component from the table it cites. `GET /api/ref/listings`,
`/api/ref/[slug]`, `/[slug]/history`, `/[slug]/mids`, `/[slug]/flags`
and `/api/ref/rulebook` share `withRefRoute`
(`src/lib/api/ref-route.ts`): `Cache-Control: public, max-age=60`
on success, the four versions and `as_of` first in every payload,
then one unit of the `ref` quota, 60 a minute per network, or a key's
own with `Authorization: Bearer <key>` (migration `010_api_keys`); an
unknown or revoked key is refused (401), never served as public.
`npm run api-key:create -- --name=<desk> [--quota=600]` prints a key
once and stores its SHA-256. The forward's reference blends the model
mid, not the inventory-skewed quote mid, and the API publishes only the
inventory's sign, on the reference and on the tape. `/admin/dealer`
(tournament admins, via `/api/admin/dealer`) shows `dealer_pnl`, live
instruments, recent runs, the settle job's pending rank 3–4 promotions
(read-only) and `source_health`; `dealer-alerts.yml` fails daily when
any instrument stays widened past the 72 h hold. Not built: the admin
actions on the resolution queue, the silent-source and
print-without-scoop alerts (ingest's), and the correcting settlement.

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

- `.env.local` needs `DATABASE_URL` and `DATABASE_URL_UNPOOLED`; sign-in
  and admin are the tournament's (below). Dev data: `npm run db:migrate
  && npm run seed:listings -- --listed-at=<ISO>`. Apply
  `008_retire_ladder_and_username_accounts` before serving this version:
  it deletes data (D6).
- Integration tests create isolated schemas and explicitly scope their migration
  tables, so concurrent suites do not share migration state.
- Comment posting in production requires Vercel's trusted
  `x-vercel-forwarded-for` header with `VERCEL=1`; missing or unsupported trusted
  addressing disables posting, not reading or trading. Forwarding headers supplied
  by clients are not used in local development, where requests share one bucket.
  Network keys are domain-separated SHA-256 hashes; raw addresses are not stored. Limits return HTTP 429
  with `Retry-After`. Apply migration `002_market_comments` before serving this version.
- Tournament: `X_CLIENT_ID` (and `X_CLIENT_SECRET` for a confidential
  client) enable X sign-in; the callback is
  `${APP_ORIGIN}/api/t/auth/x/callback` unless `X_REDIRECT_URI` is set,
  and must be registered in the X developer portal. Without them only
  username and password accounts sign in. `TOURNAMENT_ADMIN_X_IDS` lists
  the admins of `/t/admin` and `/admin` (comma separated). For local work without X, `TOURNAMENT_DEV_SIGN_IN=1`
  under `next dev` adds a handle-only sign-in (allowlist it as
  `dev:<handle>`); it is off in every other mode. Launch questions:
  `npm run seed:tournament` writes the three drafts, `-- --open`
  (optionally `--opens-at=<ISO>`) opens them.
- Provenance: `.github/workflows/provenance.yml` calls
  `/api/t/cron/provenance` hourly with `Authorization: Bearer
  $CRON_SECRET`; the route refuses anything else. Set the same
  `CRON_SECRET` (at least 16 characters) in Vercel and as a GitHub
  Actions secret; the workflow skips itself without it, and
  `vars.PROVENANCE_URL` overrides the target. A GitHub schedule rather
  than Vercel Cron keeps hourly runs plan-independent; missed runs catch
  up. `.github/workflows/dealer.yml` calls `/api/cron/dealer` the same
  way with the same secret (`vars.DEALER_URL` overrides the target).
  `.github/workflows/dealer-alerts.yml` (daily, same secret) fails when
  an instrument stays widened past its 72 h hold. Apply migration
  `010_api_keys` before serving the reference API.
  `npm run provenance:batch` runs the provenance job by hand. `SOLANA_PROVENANCE_SECRET_KEY` is the fee wallet (the
  64-byte `solana-keygen` JSON array, or its base58), `SOLANA_CLUSTER`
  is `mainnet-beta` (default) or `devnet`, and `SOLANA_RPC_URL`
  overrides the public endpoint. Without the key, roots are committed
  and shown but not posted; posting resumes from the oldest pending hour
  once it is set. Fund the wallet with fee SOL only. Apply migration
  `005_tournament_provenance` before serving this version, and
  `006_tournament_accounts` for affiliations and username accounts.

### Backtest

```
python3 backtest/analyze.py          # tables to backtest/out, four charts
```

What it is and what the numbers mean: `backtest/README.md` and
`backtest/RESULTS.md`.

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
| CI never reaches browser tests | Fixed by deletion | The trade-ticket, critical-flow, market-page, portfolio and accessibility specs that timed out seeded ladder markets through the deleted admin seed; they went with it in milestone 6. The remaining specs sign in through the tournament's dev sign-in. |
| Shared username paper account with $100,000 opening balance | Fixed | Removed in milestone 6; a tournament user's paper account opens at $100,000 on first use (D1). |
| Any known username resumes that account | Fixed | The username flow, its cookie and `USER_COOKIE_SECRET` are deleted; identity is the tournament session. |
| Production requires exactly Stripe and Anthropic | Fixed | `scripts/production-seed.ts` is deleted; `seed:listings` lists the D10 names. |
| Epochs half-modeled | Superseded | The ladder markets are gone (`008`); the dealer carries `instruments.epoch` (D3). |
| Outstanding claims varies with mask width | Fixed | Both services read `openInterestSql`, the largest per-bucket total. |
| Grid and floor impose artificial tails | True, display only | Universal grid in `buckets.ts`; 0.001 floor in `seed.ts`. Decision open (D5). |
| Deployment deadlocks after 30 days | Fixed | Builds never seeded; the production seed and its freshness rule are deleted (D6). |
| Trading surface is the 41-bucket ladder | Partly fixed | D11 adopts a binary + forward per name. The dealer's backend quotes, trades, settles and rolls both (milestone 6); the ticket UI and the ladder's removal are separate milestone-6 work. |
| Tournament is in `master` | Fixed | Merged in #2 (`a60d971`, 2026-10-21); milestone 1 is done. |
| `shelved/timing-strips` branch exists | False | Not on the remote as of 2026-10-21; the "by date" market is reinstated as D11's binary. |
| Loss bound on a binary is b·ln 2 | False | Only from a 50/50 start; against a hazard prior it is b·ln(1/p_floor). D12 states the correct figure. |
| `events.csv` carries source URLs | Fixed alongside | `events.csv` keeps no URL column (its digest is pinned); `backtest/data/sources.csv` gives 20 of the 21 listed-name prints a located source (Instinct's Seed has none), every listing anchor at rank 1. `seed:listings` joins on company, round and date and refuses an anchor without a URL. |
| One open market per company (`markets_one_open_per_company`) | Replaced | `007_dealer` relaxes it to one open market per company and `metric_kind`, so a name's binary (`yes_probability`) and forward (`forward_ln`) books stand together. |
| `events.csv` has 56 priced rounds | Partly | 59 `priced_round` rows; 56 fall in Jan 2024–Oct 2026, three are earlier (Anduril Dec 2022, Anthropic May 2023, Modal Oct 2023) and seed the prior. |
| σ_tier is 0.35 / 0.62 | Rounded | The backtest's figures are 0.3455 / 0.6204 (`params.json` → `sigma_tier`); the config carries those for the quoter (milestone 6); `CONTRACTS.md` keeps the rounded ones as prose. |
| The backtest owns every dealer parameter | Partly | μ, σ_tier are computed; λ, k, κ, Q, b, s_floor, γ, p_floor, the flag multipliers and the launch T are declared in `sim.py`/`analyze.py` and published through `params.json`. γ is unused by the simulation. |
| Entry price F₀ is the quoted mid | Fixed | It contradicted the quote formula and the backtest, which fill at bid/ask. `CONTRACTS.md` now says the filled side. |
| Flags halve the binary's b | Dropped | Never simulated, and it needs a mutable b with an adjustment log in replay. Flags act on the forward only (D12). |
| Three cron routes | Fixed | `TECHNICAL_DESIGN.md` §5 named a fourth, `/api/cron/mid`; the mid step now runs inside `/api/cron/dealer`, so there are three routes (ingest, dealer, settle). |
| `outcome = void` is a tournament schema change | False | The tournament already has `status = 'voided'` and `voidQuestion`, which writes no scores. The bridge uses it. |
| Launch T settles most forward lives | False for some | On `events.csv` with roll-on-void, Modal (120 d) settles 3 of 10 resolved lives (an 11th is open) and Anduril (270 d) 3 of 7 (an 8th is open); `tests/fixtures/rulebook-events.json` lists each. |
| Early YES rolls into next quarter's binary | Decided | `docs/decisions/0002-binary-event-window-and-expiry.md`: any announcement strictly after listing counts, and expiry is this quarter-end with ≥ 21 days left, else the next. Instinct's Series A, B and C now resolve three Q3 2026 binaries; `binaryExpiry` in the rulebook, `binary_expiry` in `sim.py`, and `params.json` → `contract.binary_min_days` agree, and a test checks it. |
