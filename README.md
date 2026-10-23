# OpenMarket

Paper-money markets on private-company valuations, with a forecasting
tournament as the front door. Each listed name has two contracts — a
quarterly timing binary and a next-print forward — quoted by the venue
as dealer, with a published model mid and a reference-price API. The
tournament (`/t`) asks the same two contracts as forecasting questions
and its sign-in is the only identity. `CONTRACTS.md` is normative for
the instruments; `TECHNICAL_DESIGN.md` says how they are built;
`backtest/` holds the evidence (`backtest/RESULTS.md` explains it);
`docs/ARTIFACTS.md` indexes every artifact, in the repo or not.

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
- Surfaces: `/` redirects to the tournament `/t` (sign-in, an optional
  welcome step, then the questions; D9). The paper markets sit beside
  it on the same sign-in: the board `/m`, a name's page `/m/[slug]`
  (both tickets), `/portfolio`, and `/admin`, `/admin/dealer` for
  admins.

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
listing and kind from 1, a successor at the next (`007_dealer`). The
market page `/m/[slug]` shows a name's live epoch; every epoch's book,
settled or not, stays readable by market id
(`/api/markets/by-id/[marketId]/marks` and `/comments`, and the
`epochs` list `GET /api/markets/[slug]` returns).

### D4. Open interest — Implemented

- Open interest for a market is the market maker's maximum payout
  liability in dollars: the largest, over outcome buckets, of the sum
  across all accounts of that bucket's holdings. Every contract pays
  $1.00 in its winning bucket, so this is a dollar figure that does not
  depend on how many buckets a contract's mask covers.
- It is labeled "Open interest" and formatted as currency. The board
  sorts open markets by it.

Current code: `openInterestSql` in `src/lib/services/open-interest.ts`
is the binary's figure. A listed name's `openInterest` (from
`listMarkets` and `getMarket`) is `{ forwardNotionalUsd, binaryUsd,
totalUsd }`: the live forward's open long plus short notional (each
dollar carries at most κ of payout) and the live binary's D4 figure.
The board column, the `/m` index strip (summed over names) and the market
header read "Open interest" in dollars from `totalUsd`, the header
splitting it into forward and binary.

### D5. Distribution scaling — Open, display only

No ladder market trades any more (D11, milestone 6); this now governs
only the read-only implied distribution, a lognormal at the forward mid
with σ = `sigma_tier` (`src/lib/engine/distribution.ts`). The valuation
grid is universal (40 boundaries from about $15M to $11T in half-octave
steps) and the distribution floors every bucket at 0.1% before
normalizing, the rule the ladder's seed used. Together these place at least a few percent of probability
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

- Builds migrate, open any missing launch tournament questions
  (`seed:tournament -- --open`) and verify replay (§5); they never list
  dealer names.
- Listing is an operator action (`npm run seed:listings`), idempotent on
  (company, listed_at) (D10).
- Migrations are append-only after launch. One owner-approved exception
  (Nick, 2026-10-21): `008_retire_ladder_and_username_accounts` deletes
  the ladder markets, Stripe and every username account.

Current code: `scripts/vercel-build.ts`. The ladder's production seed
and its 30-day freshness rule are deleted.

### D7. What stays as designed — Implemented

- Float64 LMSR engine (a dealer binary is a two-outcome book), YES/NO
  masks that partition outcomes, spend-to-shares solver, cent
  quantization. The 41-bucket valuation grid v1 is display only (D5).
- Cash as integer cents, sent as cent strings at the API; prices and
  derived dollar marks (open interest, portfolio marks, forward
  bid/mid/ask) are JSON numbers.
- One transaction per trade with advisory-locked idempotency, complete
  stored execution responses, and one mark per trade.
- Settlement credits each account once and freezes the market.
- Read routes on the Node runtime, no-store, request-id headers, stable
  error envelopes with no internals.
- Mutation routes require a same-origin `Origin` header and exact JSON
  content type.

### D8. Market discussion — Implemented

- Each market ID has a public discussion between Distribution and Market Activity,
  including after settlement. The market page shows the thread of the live
  forward's market id (the binary's when no forward is live), so a name's
  visible thread changes at each roll, and `/admin` lists live ids only. Roots load 20 at a time, newest first; one-level
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
  30-day sliding expiry (the row slides on any authenticated request;
  only `GET /api/t/me` re-issues the cookie). Admin is an allowlist
  (`TOURNAMENT_ADMIN_X_IDS`: X ids, lowercase `password:<username>`, or
  lowercase `dev:<handle>` locally) for `/t/admin` and `/admin`.
- Onboarding: `/t/signin` offers X first, a username and password
  beneath. A new identity lands on `/t/welcome` (one optional step:
  affiliation, then Save and continue or Skip) with its return path; a
  returning sign-in lands on that path, or `/t`.
- Affiliation: any forecaster may state one (lab, school, firm; up to 60
  characters, free text with a suggested list in
  `src/lib/config/tournament-affiliations.ts`). It is self-reported,
  never verified, shown in gray beside the name everywhere, and an admin
  can override or clear it.
- Questions (decision `docs/decisions/0004`, migration
  `013_tournament_contract_models`): each is one of the dealer's two
  contracts and nothing else. A **binary** asks one probability p of
  YES and resolves YES, or NO on any other outcome, including nothing by
  expiry. A **forward** asks one level x > 0 in its unit (`USD_B` or
  `USD_T`) and resolves to the settling value y, or voids (no print, no
  figure by expiry), which writes no scores. There are no buckets.
  Drafts are editable; opening pins the record. Close is automatic at
  `closes_at`, or manual and back-dated to a resolution document's
  public time (later events stay in the log and are never counted). A
  resolution inside its 72-hour dispute window can still be voided (a
  forward that turns out to have no figure).
- Forecasts: append-only events carrying `p` or `value` at ten
  decimals, hashed (`event_hash` = sha256(question ‖ user ‖ time ‖
  payload); the payload is `[p, 1 − p]` as before for a binary,
  `fwd:<x>` for a forward), one per user and question per 10 seconds,
  refused for X accounts younger than the question's
  `min_account_age_days` (default 90). Bucket vectors written before 013
  are kept in `tournament_archived_forecast_vectors` so their hashes and
  Merkle leaves still verify; they are never scored or aggregated.
- Aggregate over each non-flagged forecaster's latest forecast,
  recomputed on every write and published only from five forecasters
  (weighting `equal-v1`): a binary's crowd is the geometric mean of
  odds, clamped at ε = 0.001 and extremized (a = 1.5, stored per question
  and per row), one P(YES); a forward's is the median of the
  forecasters' ln x, one level in the question's unit.
- Scoring, time-averaged over the open window; time before a first
  forecast scores 0; coverage recorded, used only to break leaderboard
  ties. Each question page explains how it settles and shows live
  scores for the number typed, computed by the engine
  (`src/lib/client/format.ts`, `src/lib/client/tournament.ts`). A binary scores
  100 / ln 2 · ln(2 · max(p, ε)) on the outcome (0 is "said 50%"). A
  forward scores max(100 · (1 − |ln(x/y)| / ln 2), −896.6): exact 100,
  10% off ≈ 86, 2× off 0, 4× off −100, floored at the binary's clamp
  past a 1,000× miss. Written once per resolution as immutable rows. A
  correction inside the 72-hour dispute window supersedes the live
  resolution and rescoring writes a new set; afterwards nothing changes.
  Voided questions write no scores.
- Leaderboard: sum of scores over live resolutions in the period (all
  time, or a calendar month in America/Los_Angeles); ties break on mean
  coverage. Flagged accounts are scored and shown, marked, and excluded
  from the aggregate.
- Database triggers keep `tournament_forecast_events` and
  `tournament_scores` append-only and let a resolution change only by
  being superseded. `npm run verify:replay` also recomputes every stored
  score and every open question's live aggregate from the event log.

Pages: `/t` (questions; `/` redirects here, and the markets board is
`/m`), `/t/signin`, `/t/welcome` (a new identity's one onboarding step,
an optional affiliation), `/t/q/[slug]`, `/t/u/[handle]`,
`/t/leaderboard`, `/t/admin`. Public JSON, cacheable
for 10 seconds: `GET /api/t/questions`, `/api/t/questions/[slug]`,
`/api/t/questions/[slug]/forecasts`,
`/api/t/questions/[slug]/aggregate/history`,
`/api/t/leaderboard?period=all|YYYY-MM`, `/api/t/users/[handle]`.
Session: `GET /api/t/me`,
`POST /api/t/questions/[slug]/forecasts`, `POST /api/t/me/affiliation`,
`GET`/`POST /api/t/me/restrictions`,
`POST /api/t/questions/[slug]/evidence`,
`POST /api/t/auth/logout`; username accounts:
`POST /api/t/auth/password/register` and `/login`;
X sign-in starts at `GET /api/t/auth/x/start?return=<path>` (any
same-site page path but the API and `/t/signin`); dev only,
`POST /api/t/auth/dev` (`TOURNAMENT_DEV_SIGN_IN=1` under `next dev`).
Admin: `GET`/`POST /api/t/admin/questions` (list; save draft), and
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

Bridge to the dealer (milestone 7, `services/dealer/tournament-bridge.ts`,
migration `011_tournament_bridge`). Off unless `TOURNAMENT_LINKED_QUESTIONS=1`:
the tournament asks only its launch questions, a listed instrument gets no
question, its blend has no crowd, and evidence has no linked name to file
against. Settlement still resolves any question an earlier run linked.

- Every instrument the dealer lists gets a question of its own kind,
  created and opened through the tournament's own services in the
  listing's transaction and linked in `tournament_instrument_links`;
  live instruments listed before the bridge are linked on the next
  dealer run. A binary links a `binary` question closing at its expiry.
  A forward links a `forward` question for the next post-money, one
  level in USD_B (USD_T when the listing's first model mid is $1T or
  more), expiring with it; it has no edges. Slugs are
  `{name}-{round|s1|next-print}-by-{expiry}`; the question's integer
  rulebook version is the dealer rulebook's major version, its text cites
  the full one.
- Relink: the list step gives a live instrument whose linked question
  was voided (by an admin, or by migration 013 retiring bucket
  questions) a fresh linked question of its kind, as at listing; the
  voided one stays voided and unscored. A question 013 renamed `-v1`
  frees the canonical slug, so its replacement takes it; an
  admin-voided one keeps its slug and the replacement gets `-2`.
  Nothing is relinked past expiry.
- The settle job resolves the question in the settlement's transaction,
  as its run (`tournament_resolutions.settle_run_id`; a resolution has a
  resolver or a run): the scoring window is back-dated to the settling
  announcement, even one observed in the grace day after the scheduled
  close; the rung is the settling flag's source rank, the document its
  URL; a NO has neither. A binary's YES or NO becomes its `outcome`; a
  settled forward's post-money, in the question's unit, its
  `resolved_value`; a forward void voids the question. A question an
  admin already resolved or voided is left as it stands; `verify:replay`
  checks that every settled link's resolution carries the outcome or
  value its instrument's settlement implies.
- Evidence: `POST /api/t/questions/[slug]/evidence` (signed in, 10 an
  hour per forecaster and 30 per network) files a low-confidence
  `user_submitted` flag for the linked name, its submitter and claimed
  kind in their own columns; the dealer reads none of it. `/admin/dealer`
  lists unreviewed submissions; an admin confirms one by citing a later
  independent flag for the same name, or rejects it, once
  (`event_flag_reviews`, append-only, `POST
  /api/admin/dealer/evidence/[flagId]/review`). Open (Nick): the size of
  the fixed bonus score a confirmation earns; no bonus row is written
  until it is decided.
- Restricted persons: the attestation sits beside the affiliation on the
  forecaster's own profile (D12).

Not built yet: CSV export, track-record weighting, password change and
recovery, prize payment (off-platform by design), the evidence bonus
score.

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
and refuses, writing nothing, while any anchor lacks a source URL. It
lists no instruments; the dealer job's list step does. Supersedes D2.

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
`market_id` only (slug addressing is deleted). No ladder market or
ladder trading code remains (migration `008`, milestone 6). The market
page `/m/[slug]` reads `GET /api/markets/[slug]`: both live quotes, the
forward's marks for its chart, the read-only implied ladder
(P(valuation > strike) at each grid strike) and distribution, open
interest, epochs and versions. Its one ticket switches Forward / Binary:
the forward side polls `GET /api/instruments/[id]/quote` for the live
bid/ask in dollars and the fill (entry, collateral = max loss, max gain,
expiry, model and rulebook versions), sends the entry on screen as its
guard and re-confirms a PRICE_MOVED requote; the binary side is the
YES/NO ticket by `market_id`. The board lists one row per name, and the
portfolio shows open forwards marked at the mid (unrealised = settlement
credit at the mid less collateral) with account value including them.
No route closes a forward early; the ticket, the portfolio and the
resolution panel say a position is held to settlement or void. The launch T per name is carried in
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
:05/:20/:35/:50) runs its steps in one transaction per `X-Run-Id` (a rerun reports
"already ran"); its mids step, `services/dealer/compute-mids.ts`,
appends a `model_mids` row per live instrument from the listing's anchor,
params.json and the scoops and releases since the anchor, only when the
mid or its inputs moved, and `verify:replay` recomputes every row from its
`inputs_json` to 1e-12. `src/lib/engine/dealer/forward.ts`
(quote, fill, collateral, settlement credit), `binary.ts` (two-outcome
seed, price clamp, loss bounds) and `lifecycle.ts` (`instruments.state`
transitions) are pure. The dealer job's steps run state (widen/restore a
forward on flags observed since its last change; s ×3, Q ÷2 until a newer
mid or 72 h), list, mids, requote (posting a `quotes` row only when a
quote moved) and reference (D14); a binary is seeded once at the model p, never widened, and
refuses a trade past [p_floor, 1 − p_floor]. `dealer_pnl` (migration
`009_dealer_pnl`) reports realised, open collateral, unrealised and bound
per instrument; `verify:replay` replays forward books by forward rules and
recomputes every quote.

Restricted persons (CONTRACTS.md): a forecaster attests on their own
profile which listed names they are employed by, a director of, or
invested in (`GET`/`POST /api/t/me/restrictions`; migration `011` keeps
every attestation, the latest in force). `services/tournament/restrictions.ts`
refuses those names inside the quote and trade services with
`RESTRICTED_PERSON` (403): `/api/quote`, `/api/trade`,
`/api/forward/trade`, and the instrument quote when signed in (it stays
public signed out). The market page shows a one-line reason in place of
the ticket. Self-reported, play money; KYC later.

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
1.1.0; 1.0.0's schedule is kept frozen so its rows still recompute) is
the blend; the dealer job's last step, `reference`
(`services/dealer/reference-prices.ts`), appends a `reference_prices`
row per listing and kind when its value, weights, versions or
instrument move, with `components_json` citing the model mid by id,
the 30-day traded average on the instrument's own book
(notional-weighted entry for the forward, cash-weighted YES price for
the binary) and the latest aggregate of the instrument's linked question
(D9: a binary's P(YES), or a forward's median of forecasters' levels as
ln USD; 1.1.0 is the first version under this crowd, 1.0.0 read a
median off a bucket vector), which carries
w_c = 0.3 from ten forecasters (`tests/integration/crowd-gate.test.ts`);
`verify:replay` recomputes every row from its components and each
component from the table it cites. `GET /api/ref/listings`,
`/api/ref/[slug]`, `/[slug]/history`, `/[slug]/mids`, `/[slug]/flags`
and `/api/ref/rulebook` share `withRefRoute`
(`src/lib/api/ref-route.ts`): `Cache-Control: public, max-age=60,
s-maxage=60` on success and one unit of the `ref` quota; each service
puts the three versions and `as_of` first in its payload
(`refEnvelope`, `ref-common.ts`). The quota is 60 a minute per network, or a key's
own with `Authorization: Bearer <key>` (migration `010_api_keys`); an
unknown or revoked key is refused (401), never served as public.
`npm run api-key:create -- --name=<desk> [--quota=600]` prints a key
once and stores its SHA-256. `/api/ref/[slug]` lists each live
instrument's `question_slug`. The forward's reference blends the model
mid, not the inventory-skewed quote mid, and the API publishes only the
inventory's sign, on the reference and on the tape. `/admin/dealer`
(tournament admins, via `/api/admin/dealer`) shows `dealer_pnl`, live
instruments, recent runs, the settle job's pending rank 3–4 promotions
(read-only), the evidence queue (D9) and `source_health`; `dealer-alerts.yml` fails daily when
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
  and admin are the tournament's (below). The npm scripts do not load
  `.env.local`; export it first (`set -a; . ./.env.local; set +a`).
  Dev data: `npm run db:migrate && npm run seed:listings --
  --listed-at=<ISO>`. Migrations run in order to latest on every
  deploy; `008` deletes data (D6) and `013` voids every open bucket
  question (decision 0004).
- Integration tests create isolated schemas and explicitly scope their migration
  tables, so concurrent suites do not share migration state.
- Comment posting in production requires Vercel's trusted
  `x-vercel-forwarded-for` header with `VERCEL=1`; missing or unsupported trusted
  addressing disables posting, not reading or trading. Forwarding headers supplied
  by clients are not used in local development, where requests share one bucket.
  Network keys are domain-separated SHA-256 hashes; raw addresses are not stored. Limits return HTTP 429
  with `Retry-After`.
- Tournament: `X_CLIENT_ID` (and `X_CLIENT_SECRET` for a confidential
  client) enable X sign-in; the callback is
  `${APP_ORIGIN}/api/t/auth/x/callback` unless `X_REDIRECT_URI` is set,
  and must be registered in the X developer portal. Without them only
  username and password accounts sign in. `TOURNAMENT_ADMIN_X_IDS` lists
  the admins of `/t/admin` and `/admin` (comma separated). For local work without X, `TOURNAMENT_DEV_SIGN_IN=1`
  under `next dev` adds a handle-only sign-in (allowlist it as
  `dev:<handle>`); it is off in every other mode. Launch questions:
  `npm run seed:tournament` writes the four drafts (two binaries, two
  forwards; decision 0004), `-- --open` (optionally `--opens-at=<ISO>`)
  opens them. Every production and preview build runs it with `--open`
  after `db:migrate` (`scripts/vercel-build.ts`): it opens only launch
  questions that are missing, leaves open, resolved and voided ones
  alone, and skips any whose close has passed.
- Provenance: `.github/workflows/provenance.yml` calls
  `/api/t/cron/provenance` hourly with `Authorization: Bearer
  $CRON_SECRET`; the route refuses anything else. Set the same
  `CRON_SECRET` (at least 16 characters) in Vercel and as a GitHub
  Actions secret; the workflow skips itself without it, and
  `vars.PROVENANCE_URL` overrides the target. A GitHub schedule rather
  than Vercel Cron keeps hourly runs plan-independent; missed runs catch
  up. `.github/workflows/dealer.yml` and `settle.yml` call
  `/api/cron/dealer` and `/api/cron/settle` the same way with the same
  secret (`vars.DEALER_URL`, `vars.SETTLE_URL` override the targets).
  `.github/workflows/dealer-alerts.yml` (daily, same secret) fails when
  an instrument stays widened past its 72 h hold. Without `CRON_SECRET`
  the cron workflows skip and pass.
  `npm run provenance:batch` runs the provenance job by hand. `SOLANA_PROVENANCE_SECRET_KEY` is the fee wallet (the
  64-byte `solana-keygen` JSON array, or its base58), `SOLANA_CLUSTER`
  is `mainnet-beta` (default) or `devnet`, and `SOLANA_RPC_URL`
  overrides the public endpoint. Without the key, roots are committed
  and shown but not posted; posting resumes from the oldest pending hour
  once it is set. Fund the wallet with fee SOL only.

### Backtest

```
python3 backtest/analyze.py          # tables to backtest/out, four charts
```

What it is and what the numbers mean: `backtest/README.md` and
`backtest/RESULTS.md`.

## 5. CI and deployment

CI (`.github/workflows/ci.yml`, PostgreSQL 17 service) runs typecheck,
lint and audits, unit tests, integration tests, `next build`, the
Playwright suite on desktop and mobile Chromium (against `next dev`,
which the dev sign-in needs), then ledger replay. The
Playwright run has an 18-minute global timeout so a stuck suite fails
with a report inside the job's 25-minute budget, and the report and
traces are uploaded on every run.

Deployment is Vercel plus Neon; a merge to `master` deploys to
production. `scripts/vercel-build.ts` validates the environment for the
target, migrates, opens missing launch questions
(`seed:tournament -- --open`), verifies ledger replay, then runs
`next build`, so a failed build leaves the database already migrated.
`.env.example` is the environment contract.

## 6. Drift register

Only rows that are still open or still explain a live difference
between the docs, the backtest and the code. Closed rows are removed;
`git log -p README.md` keeps them.

| Claim | Status | Evidence |
| --- | --- | --- |
| Grid and floor impose artificial tails | True, display only | Universal grid in `buckets.ts`; 0.001 floor in `engine/distribution.ts` (`MIN_BUCKET_PROBABILITY`) on the read-only implied distribution. Decision open (D5). |
| `events.csv` has 56 priced rounds | Partly | 59 `priced_round` rows; 56 fall in Jan 2024–Oct 2026, three are earlier (Anduril Dec 2022, Anthropic May 2023, Modal Oct 2023) and seed the prior. |
| σ_tier is 0.35 / 0.62 | Rounded | The backtest's figures are 0.3455 / 0.6204 (`params.json` → `sigma_tier`), which the quoter uses; `CONTRACTS.md` keeps the rounded ones as prose. |
| The backtest owns every dealer parameter | Partly | μ, σ_tier are computed; λ, k, κ, Q, b, s_floor, γ, p_floor, the flag multipliers and the launch T are declared in `sim.py`/`analyze.py` and published through `params.json`. γ is unused by the simulation. |
| Loss bound on a binary is b·ln 2 | False | Only from a 50/50 start; against a hazard prior it is b·ln(1/p_floor) (D12). |
| Launch T settles most forward lives | False for some | On `events.csv` with roll-on-void, Modal (120 d) settles 3 of 10 resolved lives and Anduril (270 d) 3 of 7; `tests/fixtures/rulebook-events.json` lists each. |
| Restricted persons attest at sign-in | Partly | The attestation is on the forecaster's profile, not a sign-in step; refusal at the API and the hidden ticket are as specified (D12). |
| A confirmed evidence flag pays a fixed bonus score | Open | The review is built (D9); the bonus size is Nick's to decide, so no bonus row is written. |
| Three cron routes (ingest, dealer, settle) | Partly | `/api/cron/dealer` and `/api/cron/settle` exist, plus the tournament's `/api/t/cron/provenance`; ingest is not built (decision 0001, `TECHNICAL_DESIGN.md` §4). |
| A charter re-centres the forward mid | Not built | `CONTRACTS.md` and `RULEBOOK.charter` (served at `/api/ref/rulebook`) say so; `compute-mids.ts` reads scoops only, and a charter only widens. |
| Rank 3–4 waits in a 24 h admin queue; rank 3 needs two independent outlets | Not built | The settle job promotes rank 1–2 only and reports 3–4 as pending; `RULEBOOK.review.review_hours` and `pressRank` are not read by any service. |
| A higher-ranked revision writes a correcting settlement | Not built | Settlements open to revision are recorded `final: false` (D13). |
| The binary's leak jump follows sim.py | Partly | sim.py jumps on scoops (`leak_date`); `compute-mids.ts` also counts `release` flags dated on or before listing. |
