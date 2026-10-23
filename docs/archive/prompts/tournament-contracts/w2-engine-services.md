# Brief W2: tournament engine, services and API

Repository `nickadesina/openmarket`. Branch `tc/w2-engine-services`
from `tournament-contracts`; PR back into it. Read `AGENTS.md` and
`docs/decisions/0004-tournament-questions-follow-the-contracts.md` in
full first. Code against the types W0 committed; the database shape is
W1's migration 013 as 0004 pins it.

## Yours (only these)

- `src/lib/engine/tournament/**`
- `src/lib/services/tournament/**`
- `src/lib/client/provenance.ts` (it shares the hash payload)
- `src/app/api/t/**`
- `src/lib/config/tournament-questions.ts`, `scripts/seed-tournament.ts`
- `tests/engine/tournament.test.ts`,
  `tests/integration/{tournament,provenance,accounts}.test.ts`

**Not yours:** `schema.ts` and `tournament-schemas.ts` (W0; flag
changes in the PR), migrations (W1), components and `format.ts` (W3),
anything under `services/dealer` or `engine/dealer` (W4).

## Do

Engine:
- Delete `buckets.ts` and `median.ts`.
- `score.ts`: keep `pointLogScore(p, 2)` as the binary score; add
  `forwardScore(x, y) = max(100 · (1 − |ln(x/y)| / ln 2), CLAMP)` with
  `CLAMP = pointLogScore(ε, 2)` (≈ −896.6); `timeAveragedScore` takes a
  per-forecast score function, not a bucket index; before the first
  forecast contributes 0.
- `aggregate.ts`: binary = σ(a · mean logit(clamp p)); forward = median
  of ln x (mean of the two middle ln values when even), returned in the
  unit. No renormalization.
- `forecast.ts`: validate p ∈ (0, 1) or x > 0; `forecastCanonical`
  producing 0004's payloads (binary `canonicalProbs([p, 1−p])` with p
  rounded to 10 dp; forward `"fwd:" + x.toFixed(10)`; legacy from
  archived probs), chosen by which column is set.

Services:
- `submit-forecast`, `aggregate`, `scoring`, `records`, `get-question`,
  `forecaster`, `verify-tournament`, `provenance` to the new columns;
  legacy events (both `p` and `value` null) are verified through
  `tournament_archived_forecast_vectors` and otherwise ignored (no
  aggregate, no score, shown on the proof page).
- `get-question` exposes `instrument` for linked questions (join
  `tournament_instrument_links` → instruments → latest quote/mid; null
  otherwise). Read only; don't import dealer services into tournament
  services if `audit:deps` objects — query the tables.
- `admin.ts`: drafts by kind (forward requires `unit` and `expiry_at`;
  binary keeps `expiry_at = closes_at`); resolve binary by `outcome`,
  forward by `resolved_value > 0`; delete the bucket, floor and choice
  logic. Let `voidQuestion` void a resolved question inside the 72-hour
  dispute window (supersede the live resolution; scores drop out because
  the leaderboard counts only `status = 'resolved'`).
- `rules.clampScore` is the constant.

Config: rewrite `LAUNCH_QUESTIONS` to the four questions in 0004 → "The
questions after the change", reusing the current rulebook sentences and
deleting every bucket/floor sentence. A forward's void conditions are
written as voids ("…the question voids and nothing is scored"). The
seed script drops its bucket handling.

## Tests

Rewrite the engine tests (score values: exact 100, 10% off ≈ 86, 2× off
0, 4× off −100, clamp; binary unchanged vs the old n = 2 numbers;
aggregate; canonical payloads incl. byte-equality with an old binary
payload). Integration: submit/aggregate/close/resolve/score for both
kinds, forward void writes no scores, void inside the dispute window,
provenance proof for a new forward event and a legacy archived one,
leaderboard sums both kinds.

## Done

Your tests pass against W1's migration (rebase on `tournament-contracts`
once W1 merges, or apply 013 locally from W1's branch to test). List
in the PR any type W3 or W4 must consume differently than W0 stubbed.
