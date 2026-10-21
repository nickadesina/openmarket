# Technical design — dealer, forwards, reference price

Status: proposed, 2026-10-21. This is the in-repo copy of the Claude
Doc "OpenMarket Technical Design". `README.md` section 2 is the
decision record; `CONTRACTS.md` is normative for instrument semantics;
this file says how they are built inside the existing codebase.

It supersedes the 41-bucket LMSR ladder as the trading surface. The
ladder's engine (`src/lib/engine`) stays as reference and as the binary
market maker; the ladder itself becomes a read-only display derived
from the forward mid.

## 1. Scope

Play-money version of the dealer design: five listed names, two
instruments each, a house that always quotes, a published model mid,
and a reference-price API. Reuses the ledger, idempotency, replay
verification, Vercel + Neon deployment and the tournament branch's
identity, forecast log, scoring and provenance. Real money, rails and
the onshore listing are out of scope; nothing here assumes them or
blocks them.

Build order: rulebook as code → ingestion → mid model → dealer →
tournament bridge → reference price API, with the backtest harness
promoted to a CI job alongside the rulebook.

Rules that hold throughout: valuations are ln USD in the engine and
dollars at the API; money is integer cents; every published price
carries `model_version`, `rulebook_version` and (for the reference)
`blend_version`; nothing is computed in the UI that the API does not
return; every mutation is idempotent; every derived table is
rebuildable from an append-only log and `verify:replay` proves it.

## 2. Architecture

Three scheduled jobs do all writing that is not a user trade:

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

Migration `007_dealer`, Kysely-typed in `src/lib/db/schema.ts`.
Existing tables kept. Each instrument's book is one `markets` row,
linked by `markets.instrument_id` (nullable, unique): the binary in the
`yes_probability` shape, the forward as `forward_ln` (`n_buckets = 2`,
q = open long and short notional in USD from [0, 0], b = κ,
`current_metric` = mid in USD). Log tables are append-only via the
trigger pattern the tournament branch uses.

| Table | Purpose | Key columns |
| --- | --- | --- |
| `listings` | one row per listed name, versioned parameters | `company_id`, `tier`, `kappa`, `cap_cents`, `b_cents`, `spread_floor`, `forward_t_days`, `p_floor`, `model_version`, anchor and source, `listed_at`, `delisted_at` |
| `instruments` | one row per live or past contract | `listing_id`, `kind` (binary/forward), `epoch`, `question`, `expiry`, `entry_ref_ln`, `state`, `opened_at`, `closed_at` |
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

## 4. Ingestion

`/api/cron/ingest`, every 15 minutes from a GitHub Actions workflow
with `Authorization: Bearer $CRON_SECRET` (the `provenance.yml`
pattern). Five names only.

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
`backtest/sim.py`'s prior; a unit test asserts agreement to 1e-9 on
`backtest/events.csv`. The first step of `/api/cron/dealer` appends a
`model_mids` row per live instrument; there is no separate mid route,
so the jobs stay three (ingest, dealer, settle).

- Forward mid: `m = ln V_last + μ_tier`; on a scoop with a valuation,
  `m = ln V_leak` (re-centre, keep width); on a charter filing, the
  implied value scaled by the last round's post-money/pps ratio.
  μ_tier = leave-one-out median realised log step-up of the other
  names in the tier (backtest: mega-cap 0.65–0.73, red-hot 1.10–1.34).
- Binary p: Weibull hazard (k = 1.6; λ = 11 months mega, 7 red-hot)
  conditioned on survival to today over the interval to quarter-end;
  a scoop raises it to max(p, 0.80) if quarter-end is within 60 days,
  0.95 otherwise; clamped to [p_floor, 1 − p_floor].
- Heat is not a price input. It scales b, Q and λ. v1 heat is the tier;
  v2 is a percentile from X mention velocity, HN/GitHub, Wikipedia.
- `model_version` is semver in `src/lib/config/dealer.ts`; any formula
  or base-rate change bumps it. `inputs_json` stores everything needed
  to re-derive a mid by hand. Parameters are owned by the backtest.

## 6. Dealer

`src/lib/engine/dealer/binary.ts` (existing LMSR, two outcomes),
`src/lib/engine/dealer/forward.ts` (quoter), `/api/cron/dealer` every
15 minutes and after any flag. Execution reads the latest quote inside
the ledger's advisory-locked transaction.

Forward quote, per-name T, event-flag multipliers and the hard loss
bound are as `CONTRACTS.md` → The dealer specifies; this document does
not restate them. The engine reads γ, σ_tier, s_floor, Q, b, κ and T
from `src/lib/config/dealer.ts` (backtest-owned). The side whose fill
would push |I| past Q is pulled. Notional-for-notional fills at the
posted bid/ask.

State machine on `instruments.state`, one fixture test per transition,
transitions as `CONTRACTS.md` → Lifecycle: quoting → widened on a flag
(`widened_until = now + 72h`), back on a newer `model_mids` row or
expiry of the hold; resolved on a qualifying event ≤ expiry; expired
otherwise; both list a successor immediately.

Settlement (`/api/cron/settle`, hourly and on demand): one transaction
per instrument; binary pays $1/YES share; forward pays
`N·clip(settle_ln − entry_ln, −κ, κ)`; `settlements` row with source
URL and rank; collateral released; successor listed. A higher-ranked
revision within 7 days writes a correcting settlement. Materialised
view `dealer_pnl` per listing per epoch: realised, unrealised, bound.

Restricted persons: attestation at sign-in listing any of the five
names the user is employed by or invested in; those instruments are
hidden in the UI and refused at the API.

UI: the market page keeps chart and ticket; the strike ladder becomes a
read-only implied distribution from the forward mid and prior width;
the ticket gains Long/Short, notional, live bid/ask in dollars, max
gain/loss, expiry. The binary is today's YES/NO ticket.

## 7. Tournament bridge

The `/t` tournament (merged to `master` in #2) already has
numeric ladders with a floor bucket, binaries, append-only forecast
events, log scoring, leaderboard, X sign-in and Merkle commitments.
The bridge is a mapping, not a mechanism:

Mapping per `CONTRACTS.md` → Tournament mapping. A forward that expires
without a print closes its question with the tournament's existing
`status = 'voided'`, which writes no scores; no schema change.

The live aggregate (median / mean p, forecaster count, recency weight)
feeds `reference_prices` as the crowd component once `n ≥ N_min` (10).
`POST /api/t/questions/[slug]/evidence` creates a `user_submitted`
flag; a later independent flag for the same event pays a fixed bonus
score row (admin-reviewed). Merge order: tournament branch first;
`007_dealer` numbered after its `004`–`006`.

## 8. Reference price API

Public, read-only, 60 s cache, every payload carrying `model_version`,
`rulebook_version`, `blend_version`, `as_of`.

Blend (`src/lib/engine/dealer/blend.ts`):

    R   = w_m·m̃ + w_t·p̄_traded + w_c·p̄_crowd
    w_t = min(0.6, V_30d / (V_30d + V₀))         V₀ = $50k
    w_c = min(0.3, n / (n + n₀)) · [n ≥ N_min]   n₀ = 20, N_min = 10
    w_m = 1 − w_t − w_c

With no flow and no crowd the reference *is* the model mid and says so.

| Endpoint | Returns |
| --- | --- |
| `GET /api/ref/listings` | names, tiers, live instruments, parameters, T |
| `GET /api/ref/[slug]` | reference forward (ln and USD), reference hazard, components and weights, last print, next expiry, `dealer_inventory_sign` |
| `GET /api/ref/[slug]/history?from=&to=` | `reference_prices` rows plus the `quotes` tape |
| `GET /api/ref/[slug]/mids` | the model's forecast log, unredacted |
| `GET /api/ref/[slug]/flags` | public evidence used |
| `GET /api/ref/rulebook` | current rulebook as JSON |

Auth: public at 60 req/min per network bucket (`rate_limits` scope
`ref`); keyed tier via `api_keys` with per-key quotas, present from day
one so the first desk that asks gets a key the same day.

## 9. Settlement and rulebook

`src/lib/engine/dealer/rulebook.ts`, versioned, exported at
`/api/ref/rulebook`, with `backtest/events.csv` as the fixture every
rule change must still resolve identically (or re-baseline in the same
commit). v1 rules are the table in `CONTRACTS.md` → Definitions plus:
Tier-1 outlets = Bloomberg, Reuters, WSJ, FT, The Information,
TechCrunch, Axios, NYT; syndications count once; pre-money + amount
converts to post; ranges settle at midpoint; 7-day revision window;
binary at quarter-end 23:59:59 UTC.

Workflow: the settle job proposes from the highest-ranked flag; rank
1–2 auto-resolves; rank 3–4 enters a 24-hour admin queue
(`/admin/dealer` → resolutions). Every `settlements` row carries
`source_rank`, `source_url`, `rulebook_version`, admin id if any.

## 10. Backtest harness

`backtest/`: `sim.py`, `analyze.py`, `events.csv` (56 priced rounds,
14 names, Jan 2024–Oct 2026, sourced), `data/*.csv`, `out/`.
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
| Scheduling | Actions workflows `ingest.yml` (15 min), `dealer.yml` (15 min, offset 5), `settle.yml` (hourly) → `/api/cron/*`; Vercel Cron as fallback |
| Idempotency | `cron_runs.run_id` unique (the `event_flags.run_id` FK needs it); reruns exit early |
| LLM extraction | one provider behind `src/lib/services/ingest/extract.ts`; `EXTRACT_API_KEY`; prompts and schema versioned; daily cost cap in `rate_limits` |
| Secrets | `CRON_SECRET`, `EXTRACT_API_KEY`, `EDGAR_USER_AGENT`, the tournament's cookie and OAuth secrets (the paper-account cookie and passphrase-admin secrets go in milestone 6) |
| Observability | `/admin/dealer`: `dealer_pnl`, per-source last success, widened instruments, resolution queue; daily Actions job fails if any source is silent 24 h or any instrument widened > 72 h |
| Replay | `verify:replay` rebuilds quotes-derived state, forward payouts and `reference_prices` |
| Migration | `007_dealer` is additive; old LMSR markets keep working until delisted by operator action; `npm run seed:listings` idempotent on `(company, listed_at)` |

## 12. Build plan

| # | Milestone | Gate | Depends on |
| --- | --- | --- | --- |
| 1 | Merge tournament branch to `master` (done, #2) | existing CI green | — |
| 2 | Rulebook + fixtures + `backtest.yml` | fixtures resolve; summary posted on PR | — |
| 3 | `007_dealer` + `seed:listings` | migrate + replay in build | 1 |
| 4 | Ingest + flags + admin queue (owned by Nick; the dealer reads `event_flags` and tests will use `tests/fixtures/event-flags.json`, which Nick generates from `events.csv`) | seeded scoop → flag in < 15 min | 2, 3 |
| 5 | Mid model (TS port) | agrees with `sim.py` to 1e-9 | 2, 3 |
| 6 | Dealer + settlement + ticket UI; delete the Anthropic/Stripe ladder markets with their rows, Stripe, 41-bucket seeding and ladder trading, the username paper account and the passphrase admin (decided 2026-10-21) | five names quoting; a fixture print settles both instruments and rolls, in an integration test against CI Postgres (no staging gate, 2026-10-21) | 3, 5 |
| 7 | Tournament bridge | crowd weight appears with ≥ 10 forecasters | 1, 6 |
| 8 | Reference API + `/admin/dealer` + alerts | public endpoints cached, versions in every payload | 6, 7 |

Eight weeks for one engineer plus agents; the dealer (wk 4–6) is the
critical path. Visible to users: wk 5 live two-way quotes on five
names; wk 8 the public tape and the linked tournament questions.

## 13. Open decisions (Nick) and risks

Decisions: per-name T launch values; Q per name (flat $25k until
`heat_scaled_q`); κ per name (labs may warrant 0.7); b and p_floor;
blend constants; extraction provider (Nick's, with ingest);
play-money restricted-person enforcement; closing a forward before
settlement. Decided 2026-10-21: the Anthropic/Stripe LMSR markets are
delisted and removed in milestone 6.

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
