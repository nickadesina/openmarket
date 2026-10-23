# C2 — Dealer services, jobs, reference API, replay

Read `docs/prompts/cleanup/README.md`, `AGENTS.md`, `README.md` §2
(D10–D14), `CONTRACTS.md` and `TECHNICAL_DESIGN.md` §3, §6 and §8 first.

This is where money moves. Two kinds of fix matter most. First, a
replay that stops verifying, because `verify:replay` runs in every
Vercel build, so a false failure blocks deploys. Second, the jobs'
concurrency. After that, the work is consolidating duplicates.
Published numbers must not move: every existing integration test
under `tests/integration/dealer-*`, `ref-api`, `crowd-gate` and
`tournament-bridge` stays green unmodified, unless the item is fixing
that test.

## Yours

- `src/lib/services/dealer/**`
- `src/lib/services/{trade-book,quote,execute-trade,preview-trade,open-interest,verify-replay}.ts`
- `src/app/api/{cron,ref,instruments,forward}/**`, `src/app/api/admin/dealer/**`
- `src/lib/api/ref-route.ts`, `src/lib/auth/{api-key,cron}.ts`
- `src/lib/db/schema.ts` (owner; others may add only)
- New migrations, `016` or later (README → migrations)
- `scripts/{verify-replay,seed-listings,api-key-create}.ts`
- `.github/workflows/{dealer,settle,dealer-alerts}.yml`, but only their
  steps. C5 owns timeouts, concurrency and the secret-missing behaviour
  across all workflows.
- `tests/integration/{dealer-*,ref-api,seed-listings,admin-dealer,crowd-gate,tournament-bridge,part2}.test.ts`
- `tests/services/{compute-mids,dealer-helpers,event-flags-fixture,execute-trade,preview-trade,quote,reference-prices,tournament-bridge,verify-replay}*`

## Not yours

- `services/tournament/**`: C3. `relinkVoidedQuestion` is yours (it is
  in `services/dealer/tournament-bridge.ts`).
- The engine: C1.
- `src/lib/api/**` except `ref-route.ts`, and the UI: C4.

## Items (most important first)

1. **A relink makes `verify:replay` fail.**
   - `relinkVoidedQuestion` (`tournament-bridge.ts`) deletes the old
     `tournament_instrument_links` row.
   - `crowdById` (`reference-prices.ts`) needs that link to re-verify
     any `reference_prices` row whose crowd component cited the voided
     question's aggregate. That row can then no longer be verified.
   - Migration 013 relinks every bucket question, so this path is real.

   Write the failing integration test first: link, aggregate, reference
   row, void, relink, `verifyDealer`. Then keep link history: mark the
   old link superseded instead of deleting it (a migration), or verify
   the crowd component from the question id stored in
   `components_json`. Choose whichever needs no change to published
   rows.

2. **The settle and dealer jobs take locks in opposite order.**
   - `settleInstrument` locks the instrument `FOR UPDATE`, then the
     listing advisory lock.
   - The dealer's list step holds the listing lock, then inserts
     `model_mids`/`quotes`, whose foreign keys take KEY SHARE on the
     binary's instrument row.

   Overlapping runs (GitHub cron is late often enough) can deadlock.
   Take the listing lock first in `settleInstrument`. Add a test that
   runs both jobs concurrently on one listing.

3. **One failing instrument stops the hourly settle run.**
   `runSettleJob` aborts every instrument after the failure, every
   hour. Each instrument already has its own transaction: catch per
   instrument, record the failure in the run's report and keep going.
   The run should still finish "failed" if any instrument failed, so
   `settle.yml` goes red. Test partial failure.

4. **The reference API's CDN cache bypasses keys.** Ref responses are
   `public, s-maxage=60` without `Vary: Authorization`. A cache hit
   skips a key's quota and the promise that a revoked key gets 401.
   Make keyed responses `private` (or `Vary: Authorization`) in
   `withRefRoute`, and test both paths.

5. **Malformed cursors return 500.** The patterns in `ref-common.ts`
   accept strings that then fail the `::uuid`, `::bigint` or
   `::timestamptz` casts. Validate fully in TypeScript and return
   `INVALID_INPUT` (400). Test a well-formed-looking bad cursor for
   each type.

6. **Print promotion is idempotent only by convention.** There is no
   unique index on `event_flags.promoted_from`; the `NOT EXISTS`
   subquery holds only under the settle lock, and it scans an
   unindexed column. Add a partial unique index
   (`where promoted_from is not null`) in a new migration, and make the
   insert rely on it.

7. **Widened state disagrees between the tape and fills.**
   - `requote.ts` and `apply-flags` test `state === "widened"`.
   - Fills use `isWidened` (`get-instrument-quote.ts`), which reads
     `widened_until`.

   For up to 15 minutes the tape and the fill can show different
   spreads. Use one predicate everywhere.

8. **Cron run bookkeeping.**
   - A killed function leaves a `cron_runs` row `running` forever.
     Treat a `running` row older than the job's budget as failed when
     the next run claims.
   - `finishCronRun` on the failure path can throw and mask the
     original error. Preserve it.
   - `runSettleJob` re-implements `runCronJob`'s claim, finish and
     fail. Use `runCronJob`.

9. **`scripts/verify-replay.ts` swallows every exception.** That
   includes code bugs, which then report as clean or as a generic
   failure. Keep the secret-free message, but exit non-zero with the
   error class and the service's message.

10. **Error codes.**
    - The cron secret check throws `ADMIN_REQUIRED`; give it its own
      code or `UNAUTHORIZED` (coordinate the status mapping with C4,
      which owns `response.ts`).
    - A missing listing or instrument reports `MARKET_NOT_FOUND`.
    - Corrupted stored state in `settle-lmsr-book.ts` reports
      `INVALID_INPUT`; it should be an internal error.

11. **Guards that check nothing.** `.executeTakeFirstOrThrow()` on an
    UPDATE without `returning` never throws (`settle-instruments.ts`,
    `settle-lmsr-book.ts`). Add `returning` so a missed `status='open'`
    row really fails, and test it.

12. **Duplicates.** Make one copy of each:
    - **Last-print selection**, written twice with different
      tie-breaks (`ref-reference.ts`, `compute-mids.ts`). Before
      merging, confirm which tie-break the published rows used; that
      one wins. If they disagree on any stored row, stop: that is
      "Needs decision".
    - **The listings ⋈ companies loader**, written three times
      (`settle-instruments`, `list-instruments`, `ref-common`), along
      with the identical `ListingWithCompany`/`RefListing` types.
    - **The advisory-lock SQL**, two copies each.
    - **The lifecycle snapshot and the forward quote row**: `apply-flags`
      repeats both, from `settle-instruments` and `requote`.
    - **`loadReplay`**, in `execute-trade` and `execute-forward-trade`.
    - **`isoDay`**, written three times.
    - **`findTradeBook`** in `trade-book.ts` is a pass-through left
      over from slug addressing. Inline it.

13. **Dead exports** (no importer in `src/` or `tests/`; confirm each):
    - `deriveForwardTradeFingerprint`, `forwardQuoteView`,
      `instrumentsForMid`, `activeListings`, `loadTradedComponent`,
      `loadCrowdComponent`, `sameReference`
    - `REFERENCE_TOLERANCE`, `MID_TOLERANCE`, `QUOTE_TOLERANCE`
    - `settleInstrument` as an export, the `*_STREAMS` constants,
      `REF_CACHE_SECONDS`, `CRON_SECRET_MIN_LENGTH`
    - The `"ingest"` member of `CronJob`/`JOBS` can stay: ingest is
      planned (decision 0001).

14. **Replay and job cost.** `verify:replay` runs in every build and
    grows with history.
    - `verify-dealer.ts` loads every quote, position and mark, then
      filters per quote: O(Q·M). Index by instrument once.
    - `verifyReferencePrices` and `writeReferencePrices` make about 4
      queries per row.
    - `requote` makes 3 queries per instrument; `loadInstrumentBook`
      makes 4 sequential ones.

    Batch them. Results must be identical; the tests prove it.

15. **`execute-trade.ts` ignore comment.** It says "one serializable
    transaction", but the transaction is the default READ COMMITTED.
    Make the split it names (validation, then ledger writes), correct
    the comment's premise, and remove the ignore. Do the same for
    `verify-replay.ts` (split per invariant family).

16. **`/api/admin/dealer` carries no versions.** Add
    `model_version`/`rulebook_version`/`blend_version`, as the
    "versions on every published number" rule asks.

## Needs decision (do not implement)

- README items 1–3: charter, the unread rulebook rules, release flags
  in the leak jump.
- The correcting settlement for `final: false` forwards. It is a
  feature, not cleanup.

## Done when

- Every item is done, did not reproduce, or needs decision.
- The new tests cover: relink then verify, concurrent jobs, a partial
  settle failure, keyed caching, bad cursors, and promotion
  idempotency.
- No `biome-ignore` is left in your files.
- The gates pass, and `npm run verify:replay` is clean against the
  integration database after the dealer fixtures run.
