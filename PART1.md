# Part 1 — Mathematical Core

All parallel work lands in this repository and shares the contracts below. Part 1 intentionally excludes Next.js, PostgreSQL, routes, authentication, and UI.

Milestone 6 note: the 41-bucket ladder no longer trades. The LMSR engine now prices the dealer's two-outcome binary; the grid and the quantile serve the read-only implied distribution (`distribution.ts`). `twap.ts` and `decomposition.ts` are deleted.

## Shared invariants

- Float64 engine math; reject non-finite inputs.
- `EPS = 1e-9`; `MIN_QUANTITY = 0.000001` from `src/lib/engine/types.ts`.
- Valuation grid v1 has 40 boundaries and 41 buckets.
- YES at strike `j` covers buckets `j + 1...n-1`; NO covers `0...j` (a binary has one strike, `j = 0`).
- Buy deltas are positive; sell deltas are negative.
- Public functions validate vector lengths and never mutate caller-owned arrays.
- ESM imports include `.js` so NodeNext compilation and emitted JavaScript agree.

## Parallel ownership

- Grid/contracts: `buckets.ts`, `contracts.ts`, matching tests.
- LMSR/spend solver/cash rounding: `lmsr.ts`, matching tests.
- Seeding: `seed.ts` (the binary's two-outcome book), matching tests.
- Implied distribution: `distribution.ts` (lognormal masses over the grid), `median.ts` (grid quantiles), matching tests.
- Cross-module proof: `invariants.test.ts` only.

## Completion gate

`npm test` and `npm run typecheck` must pass. Property tests cover PMF normalization, strike monotonicity, YES+NO full-set cost, path independence, spend caps, and the implied distribution's monotone tail probabilities.
