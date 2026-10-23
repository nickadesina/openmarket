# 0004 — Tournament questions follow the two contracts; buckets go

Date: 2026-10-22. Status: implemented (decided by Nick, 2026-10-22; see
"Calls"; built on `tournament-contracts`, PRs #18–#21).
Amends `CONTRACTS.md` → Tournament mapping, README D9 and
`TECHNICAL_DESIGN.md` §7. Where this file is more specific, it wins.

## Why

Every tournament question is a probability vector over buckets: seven
"weight" sliders on a ladder, renormalized, log-scored on the winning
bucket. Nobody chose that for the tournament. The contract spec
`CONTRACTS.md` was copied from maps Contract B to a point estimate, but
the copy's mapping table says "numeric ladder with a floor bucket; log
score over buckets" (`CONTRACTS.md:123`), and the bridge, the engine and
the UI were built to it. Migration 008 retired the 41-bucket *trading*
ladder; the tournament's ladder is the same idea left behind.

It costs us twice: the editor asks for seven numbers to say one thing,
and the bridge needs `question-ladder.ts` only to invent bucket edges a
forward never had.

## Decision

A tournament question is one of the dealer's two contracts. Nothing
else.

| Kind | Forecast | Resolves | Crowd | Score |
| --- | --- | --- | --- | --- |
| **binary** | one probability p of YES | YES, or NO (any outcome that is not YES, including nothing by expiry) | geometric mean of odds, extremized a = 1.5 (today's rule, one number) | 100/ln 2 · ln(2 · max(p_outcome, ε)), ε = 0.001 |
| **forward** | one level x > 0 in the question's unit ($B or $T) | the settling value y, or **void** (no print, no figure by expiry: no scores) | median of forecasters' ln x | max(100 · (1 − \|ln(x/y)\| / ln 2), −896.6) |

- Both scores are time-averaged over the open window exactly as today;
  time before a first forecast contributes 0. For a binary 0 is "said
  50%"; for a forward 0 is "missed by 2×". Exact is 100 in both, so the
  leaderboard keeps summing one column.
- The binary score is today's n = 2 log score, unchanged to the bit. The
  forward score is affine in −|ln x − ln y|, so it is proper for the
  median, which is what the crowd publishes and what the blend reads.
  Calibration: 10% off ≈ 86, 1.5× off ≈ 41, 2× off = 0, 4× off = −100.
  The floor equals the binary clamp and binds only past a 1/ε = 1,000×
  miss (100 · (1 − log₂ 1000) = 100 · log₂ 0.002 = −896.6).
- The crowd publishes from five forecasters, as today. The blend's input
  becomes simpler: `p` for a binary, the forward median already in
  ln USD (no median-from-buckets, no open-end bounds).
- No floor bucket anywhere. "Nothing happened by expiry" is NO on a
  binary and void on a forward, which is what the contracts already say
  (`CONTRACTS.md:22, 33-34, 116`).

## The questions after the change

Production has three open questions and one real forecast (a 3-vector
on the race). Bucket forecasts cannot be rescored as a level or a p, and
open rulebooks are pinned, so the three are **voided** with a note
linking their replacements, renamed `<slug>-v1`, and replaced under the
canonical slugs. The forecaster re-forecasts; a void is a normal outcome
and writes no scores.

| Slug | Kind | Question | Void / NO |
| --- | --- | --- | --- |
| `anthropic-ipo-day1-mcap` | forward, $T | Anthropic's basic-shares market cap at its first-day official close | void if no first trade by 2026-12-31 |
| `anthropic-424b-run-rate` | forward, $B | The run-rate KPI in the final 424(b), latest as-of date; range → midpoint, "over $X" → X | void if the 424(b) has no such KPI (voids at filing) or no 424(b) by 2027-01-31 |
| `openai-round-before-anthropic-ipo` | binary | Does OpenAI announce a priced primary round at ≥ $1.4T post-money before Anthropic's first trade? | NO if Anthropic trades first or neither happens by 2026-12-31 |
| `anthropic-first-trade-by-2026` | binary | Do Anthropic's shares trade by 2026-12-31? | NO otherwise |

Resolution text, sources and the 72-hour dispute rule carry over from
the current rulebooks, minus every bucket sentence.

## Pinned interface

Every workstream codes against this. It is the contract between them;
changing it is a change to this file first.

### Database — migration `013_tournament_contract_models`

One migration, one transaction. Header it like 008 (owner-approved data
change). Pre-checks raise if any `tournament_resolutions` or
`tournament_scores` row exists, or any `reference_prices` crowd
component cites an aggregate.

- `tournament_questions`: add `kind text not null` in
  `('binary','forward')`; `unit` becomes nullable, `USD_B|USD_T`, set iff
  `kind = 'forward'`. Drop `bucket_count`, the `_binary_shape`,
  `_bucket_count` and 012 `_unit` checks. Existing rows: `bool`/`choice`
  → binary with null unit, `USD_*` → forward. Then every open question is
  voided and renamed as above (`status = 'voided'`, `slug || '-v1'`,
  `void_note_md` naming the replacement slug).
- `tournament_buckets`: dropped.
- `tournament_forecast_events`: add `p numeric` (0 < p < 1) and
  `value numeric` (> 0); `check (num_nonnulls(p, value) = 1) not valid`
  so new rows carry exactly one and legacy rows are exempt. Copy every
  `probs` into the new append-only `tournament_archived_forecast_vectors
  (event_id uuid pk references tournament_forecast_events, probs
  numeric[] not null)`, then drop `probs` and `_probs_nonnegative`. No
  event row is updated or deleted, so the append-only trigger never
  fires and every posted Merkle root still verifies.
- `tournament_aggregates`: delete all rows (derived; recomputed on the
  next write). Drop `probs`, `median_value`, `p_floor`, `p_yes`,
  `_probs_present`; add `p numeric`, `value numeric` (forward median in
  the question's unit), each null below one forecaster, exactly one set
  otherwise.
- `tournament_resolutions`: drop `winning_bucket_index`; add `outcome
  text` in `('yes','no')`; `check (num_nonnulls(outcome,
  resolved_value) = 1)`. A void stays `status = 'voided'` with no row.
- `tournament_scores`: unchanged.
- `down`: raises if any `tournament_questions` row exists; otherwise
  restores the empty 012 shape (the dealer-schema and identity tests
  migrate down through it on empty databases).

### Event hash

`event_hash = sha256(question_id ‖ user_id ‖ submitted_at ISO ‖ payload)`:

- binary: `canonicalProbs([p, 1 − p])` with p rounded to 10 dp, byte for
  byte today's binary payload;
- forward: `"fwd:" + x.toFixed(10)` (cannot collide: legacy payloads are
  digits, `.` and `,` only);
- legacy: `canonicalProbs(archived probs)`.

`forecastCanonical(event)` picks the branch from which column is set,
never from the question's kind. Server proof and the browser proof page
(`src/lib/client/provenance.ts`) share it.

### TypeScript and HTTP

```ts
type QuestionKind = "binary" | "forward";
type ForwardUnit = "USD_B" | "USD_T";

// POST /api/t/questions/[slug]/forecasts
type ForecastInput = { p: number } | { value: number }; // by the question's kind

// question summary and detail (replaces buckets/unit/winningBucketIndex)
interface QuestionCore {
  kind: QuestionKind;
  unit: ForwardUnit | null;            // null for a binary
  levelLabel: string | null;           // a forward's level name (amendment 1); null for a binary
  aggregate: {
    computedAt: string; nForecasters: number; published: boolean;
    p: number | null;                  // binary crowd P(YES)
    value: number | null;              // forward crowd median, in unit
  } | null;
  resolution: { outcome: "yes" | "no" | null; resolvedValue: number | null; /* + today's source fields */ } | null;
  instrument: { kind: QuestionKind; companySlug: string; yesPrice: number | null; midUsd: number | null } | null; // linked questions only
}

// public forecast rows and viewer positions carry p or value, never probs
// POST /api/t/admin/questions/[slug]/resolve
type ResolveInput =
  | { outcome: "yes" | "no"; rung_fired: number | null; source_url: string | null; source_excerpt: string | null; note_md: string }
  | { resolved_value: number; rung_fired: number | null; source_url: string | null; source_excerpt: string | null; note_md: string };

// question draft (config and admin JSON)
type QuestionDraft = common & ({ kind: "binary" } | { kind: "forward"; unit: ForwardUnit; level_label?: string; expiry_at: string });
```

`rules.clampScore` becomes the constant −896.6. `rung_fired` keeps its
name (it is the source rank). Score columns keep their names.

## Workstreams

*Historical: how 0004 was built (PRs #18–#21). Statements of what the
code did "today" describe it before the change.*

Six agents, disjoint files. W0 goes first and is small, W1–W4 run in
parallel against the pinned interface, W5 goes last. No workstream edits
another's files; a needed change goes back to this document. Each has a
self-contained brief in `docs/archive/prompts/tournament-contracts/` (`README.md`
there has the branch scheme and dispatch order); the summaries below are
the boundaries.

**W0 — Compile target (first, ~1 hour).** Writes the types above
into `src/lib/db/schema.ts` (tables) and `src/lib/api/tournament-schemas.ts`
(zod + inferred types), and stubs the exported service types
(`QuestionSummary`, `QuestionDetail`, `PublicForecast`, `OpenPosition`,
`AdminQuestion`) to the new shape. Commits to the feature branch; every
other workstream branches from it.

**W1 — Data.** Owns `src/lib/db/migrations/013_tournament_contract_models.ts`,
`tests/integration/postgres.ts` (truncate list: drop
`tournament_buckets`, add the archive table), the migration list in
`tests/integration/identity.test.ts`, and a new
`tests/integration/tournament-migration.test.ts`: up from a populated
012 (vector events with posted leaves, three open questions) → questions
voided and renamed, vectors archived, provenance still verifies, a new
vector-shaped insert is refused; down refuses with questions present and
succeeds on an empty schema.

**W2 — Tournament engine and services.** Owns `src/lib/engine/tournament/**`
(delete `buckets.ts`, `median.ts`; `score.ts` gains the forward score;
`aggregate.ts` pools one p; `forecast.ts` validates p or value and
builds the canonical payload), `src/lib/services/tournament/**`
(submit, aggregate, scoring, records, get-question incl. `instrument`,
forecaster, admin resolve/void, verify-tournament, provenance),
`src/lib/client/provenance.ts`, `src/app/api/t/**`,
`src/lib/config/tournament-questions.ts`, `scripts/seed-tournament.ts`,
and the tests `tests/engine/tournament.test.ts`,
`tests/integration/{tournament,provenance,accounts}.test.ts`. Also: a
resolved forward that turns out to be a void inside the 72-hour window
must be voidable (today `voidQuestionIn` refuses resolved questions).

**W3 — Tournament UI.** Owns `src/components/tournament-*/**`,
`src/app/t/**`, the tournament part of `src/lib/client/format.ts` and
`query-keys.ts`, `src/styles/shared.module.css` (lift the ticket's
`.inputFrame`, `.twoWay`, `.quickAmounts` so both modules compose them),
and `tests/browser/tournament.spec.ts`. Deletes
`tournament-distribution/` and the weights editor.
- Binary input: "CHANCE OF YES", one `%` field (0.1 step, 0.1–99.9) and
  a 1–99 slider; a YOU · CROWD · MARKET readout; chips "Crowd 42.0%" /
  "Market 38.5%" only when the figure exists; preview rows "If YES +48.5
  / If NO −73.7" from `pointLogScore`.
- Forward input: one `$…B` / `$…T` field; CROWD MEDIAN · DEALER MID ·
  LAST ROUND readout where those exist; preview "Exact 100 · 10% off 86
  · 2× off 0"; the void sentence in plain words next to the field.
- Crowd module: one figure (42.0% YES / $412B median) in the spec table
  plus a step line from the existing `/aggregate/history`, with its text
  summary. Forecast list becomes a ruled table. Admin resolve: YES/NO
  select or a value field; voids stay on the Void form.
- Every string listed in the UI inventory (intro on `/t`, nav tagline,
  "Crowd distribution", "Winning bucket", the scoring paragraph) is
  rewritten per kind. DESIGN.md rules that bind: Real Density (no
  placeholder chips), One Plate, Fixed Ramp, Red Interface (a positive
  preview is not green), Price Precision.

**W4 — Dealer side and contract docs.** Owns
`src/lib/services/dealer/tournament-bridge.ts`,
`src/lib/engine/dealer/question-ladder.ts` (deleted with its test),
`src/lib/services/dealer/{reference-prices,list-instruments}.ts`,
`src/lib/engine/dealer/blend.ts` (bump `BLEND_VERSION`: the crowd's
definition changes), the bridge, crowd-gate, dealer-reference and
evidence tests, `CONTRACTS.md` → Tournament mapping and
`TECHNICAL_DESIGN.md` §7. The bridge keeps create/open/link,
resolve-or-void and the flag; a binary links as `kind: binary`, a
forward as `kind: forward` in the instrument's unit with no edges;
`crowdValue` reads `p` or `ln(value · unit)`.

**W5 — Integration (last).** Reconciles W1–W4 on
`tournament-contracts`, owns README D9 and AGENTS.md, runs the gates
(`npm run check`, `test:unit`, `test:integration`, browser suite),
rehearses 013 on a preview deploy, and opens the PR to `master` with the
release below as a checklist. Release itself is Nick's; no agent touches
production.

## Release

*Historical: the runbook used for the 0004 release.*

1. Neon: snapshot production (`ep-empty-hill`); `down` refuses once
   questions exist, so the snapshot is the rollback.
2. Rehearse on a branch of production through a preview deploy: migrate,
   `verify:replay`, seed, forecast, proof page for the legacy event.
3. Merge. The Vercel build migrates (013 commits before
   `verify:replay`, which must already run the new code) and promotes.
   Old instances 500 on tournament pages for the minute between commit
   and promotion; acceptable.
4. Immediately `npm run seed:tournament -- --open` against production:
   the canonical slugs 404 until then. (Since the release, the Vercel
   build runs this seed after `db:migrate`, so a merge needs no manual
   step.)
5. Check `/t`, each question, and `/t/provenance/<legacy event>` still
   verifying.

## Calls (decided by Nick, 2026-10-22)

1. **Forward scale: a 2× miss scores 0.** A tighter scale (1.5× = 0)
   would reward precision more and make the floor bind sooner; a looser
   one would make forwards count less against binaries.
2. **The race resolves NO on "neither"**, the dealer binary's own rule
   (an expired binary pays NO), not void.
3. **The timing binary `anthropic-first-trade-by-2026` is added.**
   Voiding the day-one forward on no IPO drops the timing bet the floor
   bucket used to carry; this binary keeps it.
4. **Hand-written questions keep the 72-hour dispute window.** The
   forward rulebook lets a higher rank supersede within 7 days; linked
   forwards follow the settlement, which already supersedes.

Not changed: log units in the engine, two contracts per name,
void-and-refund, the dealer always quotes, version stamps on every
published price.

## Amendment 1 (2026-10-22): a forward names its level

The forward editor's heading was "Level in USD trillions": no field said
what the level is. Migration `014_tournament_level_label` adds a nullable
`tournament_questions.level_label` (forward only, 1–60 characters),
`QuestionCore` gains `levelLabel`, and the forward draft takes an optional
`level_label`. The launch forwards are "First-day market cap" and
"424(b) run-rate"; a linked forward is "Next post-money". A forward without
one keeps the old heading.

Two other W3 requests were declined. A per-question void sentence would
restate the rulebook's void clause in a second field that can drift from
it; the editor's generic line points to the rulebook. A last-round figure on
`LinkedInstrument` would duplicate what `/api/markets/[slug]` already
serves to the editor.
