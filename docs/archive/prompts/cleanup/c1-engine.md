# C1 — Engine: validation, one copy of each helper, dead exports

Read `docs/prompts/cleanup/README.md`, `AGENTS.md`, `PART1.md` and
`CONTRACTS.md` first.

The engine is pure arithmetic. Its public functions should refuse bad
input instead of passing NaN downstream, where `verify:replay` would
store and then "verify" the same NaN. Each small helper should live in
one place, and nothing should be exported that nobody imports. No
published number may change: `tests/engine/dealer/prior.test.ts`
(against `prior_golden.json` at 1e-9), `tests/engine/dealer/rulebook-events.test.ts`
and `tests/config/dealer-params.test.ts` must pass untouched.

## Yours

- `src/lib/engine/**` (including `dealer/` and `tournament/`)
- `src/lib/config/dealer.ts`, `src/lib/config/listing-anchors.ts`
- `tests/engine/**`, `tests/config/**`

## Not yours

- `backtest/**`: any edit there forces a new model version (README,
  "Needs decision" 4).
- Services, routes, UI, `src/lib/db/**`. To make a service use a new
  engine export, list it under "Needs from C1" for C2 or C3. Do not edit
  their files.

## Items (most important first)

1. **Reject non-finite and out-of-domain input in `prior.ts`.**
   - `tierOf(NaN)` returns `"redhot"`.
   - `roundProbability` and `binaryProbability` pass NaN and Invalid
     Dates through.
   - `forwardMid` with a post-money ≤ 0 returns NaN or −∞.

   Throw the engine's usual error on each, matching how `lmsr.ts` and
   `forward.ts` validate. Add tests for each case. PART1 promises
   "reject non-finite inputs".

2. **Positive-only schema for parameters in `config/dealer.ts`.**
   - `tierSchema` lets σ_tier ≤ 0 through, which
     `lognormalBucketProbabilities` (`distribution.ts`) throws on.
   - It also lets `cadence_months` λ ≤ 0 through, which divides by
     zero in `weibullSurvival`.
   - `flag_cap_mult` needs a (0, 1] bound.

   Tighten the zod schema so a bad `params.json` fails at import, and
   test each bound. `params.json` itself must not change.

3. **Validate the rest of the public surface:**
   - `pointLogScore` and `binaryScore` (`tournament/score.ts`): NaN p
     scores NaN; `outcomeCount` ≤ 1 divides by zero.
   - `binaryExpiry`, `quarterEndCutoff`, `resolveBinary` and
     `resolveForward` (`dealer/rulebook.ts`) don't check Dates.
     `lifecycle.ts` does; copy its check.
   - `probabilitiesAbove` (`distribution.ts`) never checks
     `probabilities[0]`.
   - `fill` and `maxFillCents` (`dealer/forward.ts`) trust the quote
     object they are handed.

4. **One copy of each shared helper.**
   - `assertFinite`/`assertPositive` are re-declared in `seed.ts`,
     `lmsr.ts`, `dealer/binary.ts`, `dealer/forward.ts`,
     `dealer/blend.ts` and `distribution.ts`. Move one copy to
     `types.ts` (or a new `engine/assert.ts`).
   - `utcMidnight` and `DAY_MS` appear in `prior.ts`, `rulebook.ts` and
     `lifecycle.ts`.
   - `pastGrace` (`lifecycle.ts`) duplicates `afterGrace`
     (`rulebook.ts`); export one and use it in both.
   - `SQRT_TWO` is in both `distribution.ts` and `median.ts`.
   - `CENT_TOLERANCE` (`forward.ts`) and the literal `1e-6` in `lmsr.ts`
     are the same tolerance by their comments. Put it and `EPS` in
     `types.ts`.

   Watch one trap: `binaryExpiry` floors its day difference while
   `daysBetween` rounds. Keep each function's current rounding unless a
   test shows they must agree; `rulebook-events.json` must not move.

5. **`median.ts` complexity ignore.** It names no split, against the
   `AGENTS.md` rule. Extract `validateQuantileInputs()`, delete the dead
   `undefined` guards the validation makes unreachable, and remove the
   `biome-ignore`.

6. **`lmsr.ts` duplicated cost function.** `maskedBuyCost` repeats
   `shiftedCost` with a mask in place of a delta. Express one through
   the other; the property tests in `tests/engine/lmsr.test.ts` and
   `invariants.test.ts` are the safety net.

7. **Dead exports.**
   - Unused anywhere outside their own file: `DEFAULT_EXTREMIZATION`,
     `MAX_FORECAST_LEVEL`, `FORWARD_PAYLOAD_PREFIX`. Make them
     file-private.
   - Exports used only by tests:
     - `lmsrCost`
     - `withinClamp`, `seedLossBoundUsd`, `clampedLossBoundUsd`,
       `BINARY_NO_INDEX`, `BINARY_YES_INDEX`
     - `pressRank`, `quarterEndCutoff`
     - `weibullSurvival`, `roundProbability`, `monthsBetween`, `tierOf`
     - `clampProbability`, `normalizeProbability`, `normalizeLevel`,
       `canonicalProbs`
     - `VALUATION_BUCKET_COUNT`

     Keep the ones whose test pins a documented invariant (for example
     the loss bounds in `CONTRACTS.md`). Keep `pressRank`: it is
     published rulebook logic with an open decision (README "Needs
     decision" 2). Unexport the rest.

8. **Ladder leftovers.** `seed.ts` is a general n-outcome seeder kept
   for one binary caller (`seedBinary` → `seedBinaryMarket`, with
   `currentMetric` naming and a `toPrecision(15)` quirk). Fold what the
   binary needs into `dealer/binary.ts` if that leaves the seeded
   vectors bit-identical (assert it in a test), and delete the rest.
   `contracts.ts` mask code can stay if `quote`/`execute-trade` still
   need it.

9. **One source of truth for enums.** Flag kinds are defined in
   `lifecycle.ts`, `schema.ts`, `services/tournament/evidence.ts` and
   `services/dealer/ref-flags.ts`. `Tier` is in both `prior.ts` and
   `schema.ts`. Export one `const` tuple plus type from the engine, and
   list the three non-engine consumers under "Needs from C1" for C2/C3.

10. **Property tests for invariants the docs state but no test
    generates:**
    - `lifecycle.ts` transitions are only those in `CONTRACTS.md` →
      Lifecycle.
    - The rulebook's binary expiry is always a quarter-end at least 21
      days out.
    - `binaryProbability` is non-decreasing in elapsed time and with a
      leak.

    Use `fast-check`, as the existing property tests do.

11. **Stale comments and small nits.**
    - `distribution.ts`: "the rule the ladder's seed used".
    - `tests/engine/tournament.test.ts`: "matches the bucket engine's
      n = 2 aggregate".
    - `score.ts`: a redundant `.slice()` after `.filter()`.
    - `config/dealer.ts`: `MODEL_VERSION` is the last object key. Pick
      the highest semver explicitly, and test it.

## Needs decision (do not implement)

- Charter re-centring; the unread `review_hours`/`pressRank` rules
  (README 1–2).
- Making `binaryExpiry` read `params.contract.binary_min_days` instead
  of `RULEBOOK.binary.expiry_floor_days`. Today a test ties the two. Do
  this only if it needs no rulebook version: the published value stays
  21.

## Done when

- Every item is done, did not reproduce, or needs decision.
- `prior.test.ts`, `rulebook-events.test.ts` and `dealer-params.test.ts`
  are unchanged and green.
- No `biome-ignore` is left in `src/lib/engine`.
- The gates pass.
