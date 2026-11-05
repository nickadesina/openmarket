# Technical design — dealer, forwards, reference price

Status (2026-10-22): built, except milestone 4 (ingest: `/api/cron/ingest`,
the extractor, the admin resolution queue). Each section marks what is
not built. `README.md` section 2 is the decision record and wins on
conflict; `CONTRACTS.md` is normative for instrument semantics; this
file says how they are built inside the codebase.

The LMSR engine (`src/lib/engine`) is the binary's market maker; the
41-bucket grid survives only as a read-only implied distribution
derived from the forward mid.

## 1. Scope

Play-money version of the dealer design: five listed names, two
instruments each, a house that always quotes, a published model mid,
and a reference-price API. Reuses the ledger, idempotency, replay
verification, Vercel + Neon deployment and the tournament branch's
identity, forecast log, scoring and provenance. Real money, rails and
the onshore listing are out of scope; nothing here assumes them or
blocks them.

Rules that hold throughout: valuations are ln USD in the engine and
dollars at the API; money is integer cents; every published price
carries `model_version`, `rulebook_version` and (for the reference)
`blend_version`; nothing is computed in the UI that the API does not
return; every mutation is idempotent; every derived table is
rebuildable from an append-only log and `verify:replay` proves it.

## 2. Architecture

Scheduled jobs do all writing that is not a user trade. Two are built
(`/api/cron/dealer`, `/api/cron/settle`); ingest is not, so
`event_flags` is written only by tests, fixtures and the evidence route
(decision 0001):

    outside        EDGAR + state filings · Tier-1 press RSS · base rates
                        │                │                 │
    cron jobs      ingest ──→ mid model ──→ dealer ──→ settle + roll
    (Actions →        │           │           │            │
     /api/cron/*)     ▼           ▼           ▼            ▼
    Postgres      event_flags  model_mids   quotes      ledger
                                                     (trades, positions)
                        │                     │            ▲
    routes + UI    reference API (/api/ref/*)   trade + /t ─┘

Routes read versioned tables. The only web write paths are trade
execution (existing ledger) and tournament forecasts (existing event
log).

## 3. Data model

Migrations `007_dealer`, `009_dealer_pnl` (`quotes.sequence`, the
`dealer_pnl` view), `010_api_keys` and `011_tournament_bridge`
(`event_flag_reviews`, restricted-person attestations,
`event_flags.submitted_by`/`submitted_kind`), Kysely-typed in
`src/lib/db/schema.ts`; the table below is a summary, `schema.ts` is
the column-level truth. Each instrument's book is one `markets` row,
linked by `markets.instrument_id` (nullable, unique): the binary in the
`yes_probability` shape, the forward as `forward_ln` (`n_buckets = 2`,
q = open long and short notional in USD from [0, 0], b = κ,
`current_metric` = mid in USD). Log tables are append-only via the
trigger pattern the tournament branch uses.

| Table | Purpose | Key columns |
| --- | --- | --- |
| `listings` | one row per listed name, versioned parameters | `company_id`, `tier`, `kappa`, `cap_cents`, `b_cents`, `spread_floor`, `forward_t_days`, `p_floor`, `model_version`, anchor and source, `listed_at`, `delisted_at` |
| `instruments` | one row per live or past contract | `listing_id`, `kind` (binary/forward), `epoch`, `question`, `opens_at`, `expires_at`, `entry_ref_ln`, `state`, `widened_until`, `resolution_json` |
| `event_flags` | ingested public evidence (append-only) | `company_id`, `kind`, `source_url`, `source_rank`, `observed_at`, `published_at`, `terms_json`, `confidence`, `dedupe_key`, `promoted_from`, `run_id` |
| `model_mids` | every mid the model produced (append-only) | `instrument_id`, `model_version`, `rulebook_version`, `computed_at`, `mid_ln` or `p`, `inputs_json` |
| `quotes` | every two-way quote posted (append-only; the tape) | `instrument_id`, `posted_at`, `bid_ln`, `ask_ln` or `price`, `mid_ln`, `half_spread`, `inventory_cents`, `cap_cents_effective`, `flag_state`, `model_mid_id` |
| `forward_positions` | open and settled forward positions | `instrument_id`, `user_id`, `side`, `notional_cents`, `entry_ln`, `trade_id`, `settled_at`, `settle_ln`, `payout_cents`, `voided_at` |
| `reference_prices` | the published blend | `listing_id`, `kind`, `as_of`, `value`, `blend_version`, `w_model`, `w_traded`, `w_crowd`, `components_json` |
| `tournament_instrument_links` | bridge | `question_id`, `instrument_id` |
| `cron_runs` | job idempotency | `job`, `run_id` (unique), `started_at`, `finished_at` |
| `source_health` | per-source last success, written by ingest; ships empty so `/admin/dealer` reads it from day one | `source`, `last_success_at`, `last_error_at`, `last_error` |

`event_flags`, pinned for the ingest (Nick, 2026-10-21):

- `kind` is a closed enum: `form_d | form_d_amend | charter | scoop |
  release | s1_public | print | user_submitted`. No free text.
- `terms_json` has a fixed shape: `{amount_usd?, valuation_usd?,
  valuation_basis: "pre"|"post"|"unknown", lead?, pps_usd?, outlet?,
  quote?}`. The mid model and settlement read only `valuation_usd` and
  `valuation_basis`.
- `print` rows carry `promoted_from` (FK to the `release`/`s1_public`
  flag they came from; null for admin-created prints) and require
  `source_rank`. Rank is nullable on every other kind.
- `dedupe_key` is indexed, not unique: syndications of one scoop share
  a key and the rulebook counts distinct outlets within it. `run_id`
  is a FK to `cron_runs` for provenance.
- `observed_at` is required, `published_at` nullable; the table is
  append-only by trigger.

A binary instrument maps onto the existing `markets` LMSR columns with
`n_buckets = 2`, so `quote`/`execute-trade` run unchanged. A forward
trade writes a `trades` row for cash and idempotency (`strike_index =
-1`, `contract_side` as long/short) plus a `forward_positions` row;
collateral N·κ is reserved from `users.cash_balance_cents` at open and
released at settlement or void.

## 4. Ingestion — not built (milestone 4, decision 0001)

Planned: `/api/cron/ingest`, every 15 minutes from Vercel Cron
with `Authorization: Bearer $CRON_SECRET` and a UTC slot run ID
(manual callers may supply `X-Run-Id`; the dealer route pattern: `requireCronSecret` in `src/lib/auth/cron.ts`,
`runCronJob` in `src/lib/services/dealer/cron-run.ts`). Five names only.

| Source | Method | Flags |
| --- | --- | --- |
| EDGAR full-text + Form D feed | query by CIK and issuer name; parse Form D XML | `form_d`, `form_d_amend` |
| Delaware / CA Secretary of State | entity watchlist; on a new certificate, extract series and original issue price | `charter` |
| Tier-1 press RSS + company newsrooms | headline + lede through an LLM extractor with a fixed schema | `scoop`, `release`, `s1_public` |
| EDGAR S-1 / F-1 | filer-name watch | `s1_public` |

Extraction schema `{company, kind, amount_usd?, valuation_usd?,
valuation_basis: pre|post|unknown, lead?, published_at?, outlet, url,
quote, confidence}`; a `release` below high confidence waits for admin
confirmation before it can become a `print`. `dedupe_key =
sha256(company, kind, outlet-or-filer, published_at::date,
round(valuation, 1 sf))`. Promotion of a `release`/`s1_public` row to
`print` is done by the settle job, never by ingest; an admin can create
a `print` by hand with a source URL (Instinct's seed and Series A were
never announced). Latency target: scoop on RSS → flag in 15 min →
dealer widened in 30. Per-source last-success is surfaced; a `print`
with no preceding `scoop` is logged as an ingestion miss.

## 5. Mid model

`src/lib/engine/dealer/prior.ts`, pure. TypeScript port of
`backtest/sim.py`'s prior; `tests/engine/dealer/prior.test.ts` agrees
with `backtest/out/prior_golden.json` (written by `backtest/golden.py`
from sim.py) to 1e-9. The dealer job's `mids` step
(`services/dealer/compute-mids.ts`, third after `state` and `list`)
appends a `model_mids` row per live instrument when the mid or its
inputs moved; there is no separate mid route.

- Forward mid: `m = ln V_last + μ_tier`; on a scoop with a valuation,
  `m = ln V_leak` (re-centre, keep width). A charter filing only widens
  the forward; re-centring on price-per-share is not built (the
  rulebook text still describes it). μ_tier = leave-one-out median
  realised log step-up of the other names in the tier (backtest:
  mega-cap 0.65–0.73, red-hot 1.10–1.34).
- Binary p: Weibull hazard (k = 1.6; λ = 11 months mega, 7 red-hot)
  conditioned on survival to the binary's listing, over the interval to
  its expiry; a scoop or release dated on or before listing raises it to
  max(p, 0.80) if expiry is within 60 days of it, 0.95 otherwise;
  clamped to [p_floor, 1 − p_floor]. (sim.py knows only scoops; the
  service also counts releases.)
- Heat is not a price input. v1 heat is the tier, which sets λ and
  σ_tier; b and Q are flat until `heat_scaled_q` runs. v2 is a
  percentile from X mention velocity, HN/GitHub, Wikipedia.
- `model_version` is semver in `src/lib/config/dealer.ts`; any formula
  or base-rate change bumps it. `inputs_json` stores everything needed
  to re-derive a mid by hand. Parameters are owned by the backtest.

## 6. Dealer

`src/lib/engine/dealer/binary.ts` (existing LMSR, two outcomes),
`src/lib/engine/dealer/forward.ts` (quoter), `/api/cron/dealer` every
15 minutes (steps in `DEALER_STEPS` order: state, list, mids, requote,
reference). A forward fill does not read the `quotes` tape: inside the
trade transaction, with the instrument locked, `executeForwardTrade`
recomputes the quote from the latest mid, the inventory and the flag
state (`get-instrument-quote.ts`).

Forward quote, per-name T, event-flag multipliers and the hard loss
bound are as `CONTRACTS.md` → The dealer specifies; this document does
not restate them. γ, s_floor, Q, b, κ and T come from the versioned
`listings` row (written from `params.json` by `seed:listings`);
σ_tier and the flag multipliers from `DEALER_PARAMS`
(`src/lib/config/dealer.ts`). A fill that would push |I| past Q (Q/2
while widened) is refused; a side with no room left is pulled.
Notional-for-notional fills at the bid/ask.

State machine on `instruments.state` (`engine/dealer/lifecycle.ts`),
one fixture test per transition, transitions as `CONTRACTS.md` →
Lifecycle: quoting → widened on a flag (`widened_until` = the flag's
`observed_at` + `flag_hours`, extended by later flags), back on a
newer `model_mids` row or expiry of the hold; resolved on a qualifying
event ≤ expiry; expired otherwise; both list a successor immediately.

Settlement (`/api/cron/settle`, hourly): one transaction per
instrument; binary pays $1/YES share; forward pays
`N·clip(settle_ln − entry_ln, −κ, κ)`; a `settlements` row with the
source URL, the rank and rulebook version written into
`source_description` and `instruments.resolution_json`; collateral
released; successor listed. A forward settled while a higher rank could
still supersede it is recorded `final: false`; the correcting
settlement is not built. View `dealer_pnl` (`009`), one row per
instrument: realised, open collateral, unrealised, bound.

Restricted persons: an attestation (on the profile, README D12) listing
any listed name the user is employed by, a director of, or invested in;
those instruments are hidden in the UI and refused at the API.

UI: the market page `/m/[slug]` has the forward chart, a read-only
implied ladder and distribution from the forward mid and σ_tier, and
one ticket switching Forward (Long/Short, notional, live bid/ask in
dollars, max gain/loss, expiry) and Binary (YES/NO by `market_id`).

## 7. Tournament bridge

The `/t` tournament has append-only forecast events, scoring,
leaderboard, X sign-in and Merkle commitments. Since decision 0004 its
questions are the dealer's two contracts and nothing else: a binary
takes one probability of YES, a forward one level in its unit. There
are no buckets. The bridge is a mapping, not a mechanism:

Mapping per `CONTRACTS.md` → Tournament mapping, built in milestone 7
and reshaped by 0004 (`services/dealer/tournament-bridge.ts`; README D9
has the rules):

- List: the dealer's list step (and the settle job's roll) creates,
  opens and links the instrument's question in the same transaction,
  through the tournament's admin services' in-transaction variants
  (`saveDraftQuestionIn`, `openQuestionIn`, …), so their invariants hold.
  A binary links a `kind: binary` question closing at its expiry. A
  forward links a `kind: forward` question with `expiry_at` = T, in
  USD_T when the instrument's listing mid (its first `model_mids` row)
  is $1T or more and USD_B otherwise; it has no edges. The rulebook text
  is built from `engine/dealer/rulebook.ts`. Instruments listed before
  the bridge are linked on the next list step while
  `TOURNAMENT_LINKED_QUESTIONS=1`.
- Settle: the settle job closes the question (back-dated to the
  announcement, never before it opened) and resolves it as its run, in
  the settlement's transaction: a binary's YES or NO becomes its
  `outcome`, a settled forward's post-money in the question's unit its
  `resolved_value`, with the source rank as the rung. A forward void
  voids the question, which writes no scores. `verify:replay` checks
  each link: the settle run's first resolution carries the outcome, or
  the value, the instrument's own settlement implies.
- Crowd: the reference step reads the linked question's latest
  `tournament_aggregates` row: `p` for a binary, ln(`value` · USD per
  unit) for a forward (the median of the forecasters' levels). blend.ts
  gives it weight from N_min (10); blend 1.1.0 is the first under this
  definition (1.0.0 read a median off the bucket vector). The component
  records the question's `kind` and `unit` (null for a binary).
- Evidence: `POST /api/t/questions/[slug]/evidence` files a
  `user_submitted` flag that an admin confirms against a later
  independent flag, or rejects (`event_flag_reviews`). The fixed bonus
  score a confirmation pays waits on its size (README D9).

The bridge is off unless `TOURNAMENT_LINKED_QUESTIONS=1` (README D9).

## 8. Reference price API

Public, read-only, 60 s anonymous cache (keyed requests are private and
uncached), every payload carrying `model_version`,
`rulebook_version`, `blend_version`, `as_of`.

Blend (`src/lib/engine/dealer/blend.ts`):

    R   = w_m·m + w_t·p̄_traded + w_c·p̄_crowd
    w_t = min(0.6, V_30d / (V_30d + V₀))         V₀ = $50k
    w_c = min(0.3, n / (n + n₀)) · [n ≥ N_min]   n₀ = 20, N_min = 10
    w_m = 1 − w_t − w_c

m is the latest `model_mids` value, not the skewed quote mid m̃, so the
dealer's own inventory never moves the reference. p̄_traded is the
30-day average on the instrument's book (forward: notional-weighted F₀;
binary: cash-weighted YES price); p̄_crowd the linked question's latest
aggregate (forward: ln of the median of its forecasters' levels, in USD;
binary: P(YES); the crowd's definition since blend 1.1.0, decision 0004). With n₀ = 20 the
0.3 cap binds from N_min on, so w_c is 0 or 0.3. With no flow and no
crowd the reference *is* the model mid and says so (`model_only`). The
constants are policy, published under `BLEND_VERSION` (README D14).

| Endpoint | Returns |
| --- | --- |
| `GET /api/ref/listings` | names, tiers, live instruments, parameters, T |
| `GET /api/ref/[slug]` | reference forward (ln and USD), reference hazard, components and weights, last print, next expiry, `dealer_inventory_sign` |
| `GET /api/ref/[slug]/history?from=&to=` | `reference_prices` rows plus the `quotes` tape (inventory as its sign), each on its own keyset cursor |
| `GET /api/ref/[slug]/mids` | the model's forecast log, unredacted |
| `GET /api/ref/[slug]/flags` | public evidence used |
| `GET /api/ref/rulebook` | current rulebook as JSON |

Auth: public at 60 req/min per network bucket (`rate_limits` scope
`ref`); keyed tier via `api_keys` (migration `010`, SHA-256 of the key
only, `npm run api-key:create`) with per-key quotas, present from day
one so the first desk that asks gets a key the same day. A bad or
revoked key is a 401, not the public tier. Logs page with `limit`
(≤ 1000) and `cursor`.

## 9. Settlement and rulebook

`src/lib/engine/dealer/rulebook.ts`, versioned, exported at
`/api/ref/rulebook`, with `backtest/events.csv` as the fixture every
rule change must still resolve identically (or re-baseline in the same
commit). v1 rules are the table in `CONTRACTS.md` → Definitions plus:
Tier-1 outlets = Bloomberg, Reuters, WSJ, FT, The Information,
TechCrunch, Axios, NYT; syndications count once; pre-money + amount
converts to post; ranges settle at midpoint; 7-day revision window;
binary at quarter-end 23:59:59 UTC.

Workflow: the settle job promotes high-confidence rank 1–2 releases and
S-1s with a source URL and a post-money to prints and resolves from
them. Rank 3–4 is reported as pending on `/admin/dealer` (read-only);
the 24-hour admin queue (`RULEBOOK.review.review_hours`) is not built,
and neither is the rank-3 "two independent outlets" check at
promotion (`pressRank` exists but only tests call it).

## 10. Backtest harness

`backtest/`: `sim.py`, `analyze.py`, `golden.py`, `events.csv` (59
priced rounds, 56 in Jan 2024–Oct 2026, 14 names), `data/*.csv`
(`sources.csv` gives the listing anchors' URLs), `out/`.
`backtest.yml` runs on PRs touching `backtest/`,
`src/lib/engine/dealer/` or `src/lib/config/dealer.ts` and posts the
summary table as a PR comment.

| Scenario | Measures | Status |
| --- | --- | --- |
| `none` | prior calibration, void rate, resolution count | run |
| `at_listing` | insider knows the print, hits the cap pre-leak | run: $53k/yr on five names, 20% of the ~$260k/yr bound |
| `at_leak` | lawful scoop-reader, perfect direction (upper bound) | run: $2.3k/yr |
| `down_round` | 20% of prints flat, 10% at −0.5 log, insider | to run — the sample has no down rounds |
| `heat_scaled_q` | Q $50k red-hot / $10k mega, same total | to run |
| `per_name_t` | per-listing T vs uniform 3 / 12 months | to run |
| `b_sweep` | b ∈ {500, 1k, 2k, 4k} × p_floor ∈ {0.05, 0.10} | to run |

The harness owns μ, λ, k, σ_tier, the leak-jump parameters and the T
proposals, written to `backtest/out/params.json` and read by
`src/lib/config/dealer.ts` at build time. A hand-edited parameter is a
failing test.

Known limits: survivorship (every sampled name kept stepping up); no
time value or inventory skew in the loss model; leak-reader binary loss
is zero by construction; Instinct's early dates are filing dates;
Anthropic Series D has no dated close.

## 11. Infrastructure

| Concern | Choice |
| --- | --- |
| Scheduling | Vercel Cron (Pro), configured in `vercel.json`: dealer at :05/:20/:35/:50, settle hourly at :41, provenance hourly at :07; bearer `CRON_SECRET`. Routes have a 300 s limit. Ingest is not built. The daily 06:23 UTC `dealer-alerts.yml` Action checks widening and successful-run freshness (dealer ≤1 h; settle/provenance ≤3 h), excluding its own `alerts-` probes. |
| Idempotency | `cron_runs.run_id` unique; explicit `X-Run-Id` wins, otherwise Vercel uses job/UTC interval slots, other callers use a UUID. Provenance additionally batches hours under an advisory lock; invocation records cover idle hours and posting errors. |
| LLM extraction | not built: planned as one provider behind `src/lib/services/ingest/extract.ts` with `EXTRACT_API_KEY` |
| Secrets | `CRON_SECRET`, the tournament's X OAuth credentials, the Solana provenance key (`.env.example`); `EXTRACT_API_KEY` and `EDGAR_USER_AGENT` arrive with ingest |
| Observability | `/admin/dealer`: `dealer_pnl`, live instruments, recent runs, pending rank 3–4 promotions (read-only), the evidence queue, `source_health` (empty until ingest); `dealer-alerts.yml` fails daily if any instrument is widened > 72 h or a scheduled job is stale/missing; the silent-source (24 h) check ships with ingest |
| Replay | `verify:replay` rebuilds quotes-derived state, forward payouts and `reference_prices` |
| Migration | `007_dealer` is additive; `008` (owner-approved, deletes data) removed the ladder markets, Stripe and the username accounts; `011_tournament_bridge` is additive; `npm run seed:listings` idempotent on `(company, listed_at)` |

## 12. Build plan

| # | Milestone | Gate | Depends on |
| --- | --- | --- | --- |
| 1 | Merge tournament branch to `master` (done, #2) | existing CI green | — |
| 2 | Rulebook + fixtures + `backtest.yml` (done) | fixtures resolve; summary posted on PR | — |
| 3 | `007_dealer` + `seed:listings` (done) | migrate + replay in build | 1 |
| 4 | Ingest + flags + admin queue (not started; owned by Nick; until then tests read `tests/fixtures/event-flags.json`) | seeded scoop → flag in < 15 min | 2, 3 |
| 5 | Mid model (TS port) (done) | agrees with `sim.py` to 1e-9 | 2, 3 |
| 6 | Dealer + settlement + ticket UI, ladder and username accounts deleted (done: `008`, README D1) | five names quoting; a fixture print settles both instruments and rolls, in an integration test against CI Postgres | 3, 5 |
| 7 | Tournament bridge (done: README D9, D12) | crowd weight appears with ≥ 10 forecasters | 1, 6 |
| 8 | Reference API + `/admin/dealer` + alerts (done; the admin resolution actions wait on 4) | public endpoints cached, versions in every payload | 6, 7 |

## 13. Open decisions (Nick) and risks

Decisions: per-name T launch values; Q per name (flat $25k until
`heat_scaled_q`); κ per name (labs may warrant 0.7); b and p_floor;
blend constants; extraction provider (Nick's, with ingest);
play-money restricted-person enforcement; closing a forward before
settlement.

Risks: the down-round blind spot (sample has none; first one costs the
cap); ingestion silence (alerts make it visible, not impossible); the
binary bleeds as much as the forward and leaks 89% of the time (b is
the first thing to cut); dealer/administrator conflict (blend,
inventory sign and forecast log are the v1 mitigations); legal surface
of a cash-settled forward (play money carries none; design is
rails-agnostic).

Not open: two contracts per name; void-and-refund; log units; the
dealer always quotes; parameters from the backtest; versions on every
published number.
