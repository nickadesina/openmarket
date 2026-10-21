# OpenMarket

Paper-money markets on private-company valuations. The current code
runs a 41-bucket LMSR book per company over its next reported
valuation. The adopted design (D10–D14, Oct 2026) replaces that trading
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

### D1. Account: shared username paper account, $100,000 — Superseded

Decided 2026-10-21: tournament sign-in (D9) becomes the only identity.
The username-only paper account, its cookie, and the passphrase admin
are removed, with every trace, in the dealer milestone
(`TECHNICAL_DESIGN.md` §12, milestone 6). A paper balance opens at
$100,000 the first time a tournament user trades.

Current code: as described below, unchanged until then.


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

### D9. Forecasting tournament — Implemented

A log-scored forecasting tournament under `/t`, separate from the paper
markets: its own users, sessions, questions, and ledger
(`tournament_*` tables, migration `004_tournament`). No money, trading,
LMSR, or tokens. Paper accounts and tournament identities never mix.

- Identity: X OAuth 2.0 with PKCE (`users.read tweet.read`, no write
  scopes, no `offline.access`; the token is dropped after the profile
  fetch), or a username and password (scrypt, the admin passphrase's
  format; no email, no recovery). The numeric X id is an X account's
  identity; handle, name, avatar, `verified`, and account creation date
  are refreshed on every sign-in. Usernames live in their own namespace:
  shown without an "@", never linked to X, at `/t/u/~username`, so a
  username can never pass for an X handle. Username accounts have no
  external account age, so `min_account_age_days` applies to X accounts
  only. Registration is limited per network (5 an hour); failed sign-ins
  per network and per username (10 per 15 minutes). Sessions are
  server-side rows keyed by the SHA-256 of an opaque cookie token,
  30-day sliding expiry. Admin is an allowlist (`TOURNAMENT_ADMIN_X_IDS`:
  X ids, or `password:<username>`).
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
X sign-in starts at `GET /api/t/auth/x/start?return=/t/...`. Admin:
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
- The Anthropic and Stripe ladder markets are delisted and removed,
  with their rows and every mention, in milestone 6. Stripe is not
  listed (decided 2026-10-21).

Current code: `npm run seed:listings -- --listed-at=<ISO>` writes one
`listings` row per name (migration `007_dealer`) from its last priced
round in `backtest/events.csv`, that round's source in
`backtest/data/sources.csv`, and `params.json`. It is idempotent on
(company, listed_at), replaces an active listing only with `--relist`,
and refuses, writing nothing, while any anchor lacks a source URL; the
sources file is not committed yet. It lists no instruments (milestone
6). `scripts/production-seed.ts` still requires exactly Stripe and
Anthropic until milestone 6. Supersedes the D2 flagship line.

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
`market_id` (a `slug` still names a ladder book). No route closes a
forward early. The launch T per name is carried in
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
- The model's forecast log (`model_mids`) is public and unredacted.
- A keyed tier exists from day one so the first desk that asks gets a
  key the same day; nothing is gated at launch.

Current code: only `GET /api/ref/rulebook` exists, served `no-store`
like every read route; the 60 s cache arrives with the reference API
(milestone 8), using `withReadRoute`'s `cacheSeconds` option.

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
- Tournament: `X_CLIENT_ID` (and `X_CLIENT_SECRET` for a confidential
  client) enable X sign-in; the callback is
  `${APP_ORIGIN}/api/t/auth/x/callback` unless `X_REDIRECT_URI` is set,
  and must be registered in the X developer portal. Without them the
  tournament is read-only. `TOURNAMENT_ADMIN_X_IDS` lists admin X ids
  (comma separated). For local work without X, `TOURNAMENT_DEV_SIGN_IN=1`
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
| CI never reaches browser tests | True, different cause | The last pushed run passed build and was cancelled at 25 minutes inside Playwright: every trade-ticket test and the critical flow waited 90 s for a `YES` button whose accessible name changed in the redesign. |
| Shared username paper account with $100,000 opening balance | Superseded | D1 is retired with every trace in milestone 6 (decided 2026-10-21); tournament sign-in becomes the only identity. |
| Any known username resumes that account | True | Upsert on `username_normalized`, cookie issued without any secret. |
| Production requires exactly Stripe and Anthropic | True | `scripts/production-seed.ts`. |
| Epochs half-modeled | True | No epoch number, slug-only URLs, slug-scoped activity, board lists every market row. |
| Outstanding claims varies with mask width | Fixed | Both services read `openInterestSql`, the largest per-bucket total. |
| Grid and floor impose artificial tails | True | Universal grid in `buckets.ts`; 0.001 floor in `seed.ts`. Decision open. |
| Deployment deadlocks after 30 days | Overstated | Builds do not seed. Re-running the seed script after 30 days fails against traded markets; deployments continue. |
| Trading surface is the 41-bucket ladder | Partly fixed | D11 adopts a binary + forward per name. The dealer's backend quotes, trades, settles and rolls both (milestone 6); the ticket UI and the ladder's removal are separate milestone-6 work. |
| Tournament is in `master` | Fixed | Merged in #2 (`a60d971`, 2026-10-21); milestone 1 is done. |
| `shelved/timing-strips` branch exists | False | Not on the remote as of 2026-10-21; the "by date" market is reinstated as D11's binary. |
| Loss bound on a binary is b·ln 2 | False | Only from a 50/50 start; against a hazard prior it is b·ln(1/p_floor). D12 states the correct figure. |
| `events.csv` carries source URLs | Fixed alongside | `events.csv` keeps no URL column (its digest is pinned); `backtest/data/sources.csv` gives 20 of the 21 listed-name prints a located source (Instinct's Seed has none), every listing anchor at rank 1. `seed:listings` joins on company, round and date and refuses an anchor without a URL. |
| One open market per company (`markets_one_open_per_company`) | Replaced | `007_dealer` relaxes it to one open market per company and `metric_kind`, so a name's binary (`yes_probability`) and forward (`forward_ln`) books stand together. `seedMarket` never touches a row with an `instrument_id`. |
| `events.csv` has 56 priced rounds | Partly | 59 `priced_round` rows; 56 fall in Jan 2024–Oct 2026, three are earlier (Anduril Dec 2022, Anthropic May 2023, Modal Oct 2023) and seed the prior. |
| σ_tier is 0.35 / 0.62 | Rounded | The backtest's figures are 0.3455 / 0.6204 (`params.json` → `sigma_tier`); the config carries those for the quoter (milestone 6); `CONTRACTS.md` keeps the rounded ones as prose. |
| The backtest owns every dealer parameter | Partly | μ, σ_tier are computed; λ, k, κ, Q, b, s_floor, γ, p_floor, the flag multipliers and the launch T are declared in `sim.py`/`analyze.py` and published through `params.json`. γ is unused by the simulation. |
| Entry price F₀ is the quoted mid | Fixed | It contradicted the quote formula and the backtest, which fill at bid/ask. `CONTRACTS.md` now says the filled side. |
| Flags halve the binary's b | Dropped | Never simulated, and it needs a mutable b with an adjustment log in replay. Flags act on the forward only (D12). |
| Three cron routes | Fixed | `TECHNICAL_DESIGN.md` §5 named a fourth, `/api/cron/mid`; the mid step now runs inside `/api/cron/dealer`, so there are three routes (ingest, dealer, settle). |
| `outcome = void` is a tournament schema change | False | The tournament already has `status = 'voided'` and `voidQuestion`, which writes no scores. The bridge uses it. |
| Launch T settles most forward lives | False for some | On `events.csv` with roll-on-void, Modal (120 d) settles 3 of 10 resolved lives (an 11th is open) and Anduril (270 d) 3 of 7 (an 8th is open); `tests/fixtures/rulebook-events.json` lists each. |
| Early YES rolls into next quarter's binary | Decided | `docs/decisions/0002-binary-event-window-and-expiry.md`: any announcement strictly after listing counts, and expiry is this quarter-end with ≥ 21 days left, else the next. Instinct's Series A, B and C now resolve three Q3 2026 binaries; `binaryExpiry` in the rulebook, `binary_expiry` in `sim.py`, and `params.json` → `contract.binary_min_days` agree, and a test checks it. |
