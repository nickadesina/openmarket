# Brief W0: the compile target

Repository `nickadesina/openmarket`, base `master`. Read `AGENTS.md`
and `docs/decisions/0004-tournament-questions-follow-the-contracts.md`
in full first. You go first and alone; four agents branch from your
commit and code against it in parallel, so it must be exactly the
"Pinned interface" in 0004 — no more.

## Do

Create branch `tournament-contracts` from `master` and commit:

1. `src/lib/db/schema.ts`: the tournament tables in their post-`013`
   shape (questions `kind`, nullable `unit: "USD_B" | "USD_T" | null`,
   no `bucket_count`; no `TournamentBucketsTable`; forecast events
   `p`/`value` instead of `probs`; the new
   `TournamentArchivedForecastVectorsTable`; aggregates `p`/`value`
   instead of `probs`/`median_value`/`p_floor`/`p_yes`; resolutions
   `outcome` instead of `winning_bucket_index`). Export
   `TournamentQuestionKind`, keep `TournamentUnit` as the forward unit.
2. `src/lib/api/tournament-schemas.ts`: `forecastInputSchema` (p or
   value), the question draft union (`kind: "binary"` |
   `kind: "forward"` with `unit` and `expiry_at`), `resolveQuestionSchema`
   (outcome or resolved_value, plus the source fields). Delete the
   bucket and `choice` schemas.
3. The exported service types, signatures only (bodies may `throw new
   Error("W2")`), in their current files: `QuestionSummary`,
   `QuestionDetail`, `PublicForecast` (`get-question.ts`),
   `AggregateView` (`records.ts`), `OpenPosition`, `ViewerForecast`,
   `ResolvedPosition` (`forecaster.ts`), `AdminQuestion` (`admin.ts`),
   to the `QuestionCore` shape in 0004, including `instrument`.

Type errors that follow in other files are expected: that is the work
list for W1–W4. Do not fix them. `npm run check` will fail; say so in
the commit message and list the failing files grouped by the
workstream that owns them (ownership is in 0004 → Workstreams).

## Done

`tournament-contracts` pushed with one commit, its message listing the
type errors per workstream. No PR to `master`.
