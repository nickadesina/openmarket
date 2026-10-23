# C3 — Tournament: sessions, sign-in, provenance, duplicated copy

Read `docs/prompts/cleanup/README.md`, `AGENTS.md`, `README.md` D1 and
D9, and `docs/decisions/0004-…` (skip its historical Workstreams and
Release sections) first.

The tournament is the front door (`/` → `/t`; O1, #30). The pass makes
its sign-in and sessions behave as documented and its provenance check
complete. It also gives the question page one source for every figure
and sentence O2 (#29) added. Scores, aggregates and the scoring rule
must not change: `tests/client/tournament-scoring-copy.test.ts`,
`tests/integration/tournament.test.ts` and the browser specs
`tournament`, `onboarding`, `account` and `restrictions` stay green.

## Yours

- `src/lib/services/tournament/**`
- `src/app/api/t/**`, `src/app/t/**`
- `src/components/tournament-*/**`
- `src/lib/client/{tournament,provenance}.ts`
- `src/lib/auth/{tournament-session,tournament-password,x-oauth,return-path,current-user}.ts`
- `src/lib/config/tournament*.ts`, `src/lib/solana/**`
- New migrations, numbered after C2's (README → migrations)
- `scripts/{seed-tournament,provenance-batch}.ts`
- Tests that touch the above: `tests/integration/{tournament,identity,sign-in,accounts,provenance,evidence,restrictions,tournament-migration}.test.ts`,
  `tests/services/{evidence,provenance}.test.ts`,
  `tests/api/{x-oauth,return-path,tournament-password}.test.ts`,
  `tests/routes/x-callback.test.ts`, `tests/client/**`,
  `tests/browser/{tournament,onboarding,account,restrictions}.spec.ts`

## Not yours

- `src/lib/engine/tournament/**`: C1. Score validation is C1's item 3.
- `services/dealer/tournament-bridge.ts`: C2.
- `src/lib/client/{format,query-keys}.ts`: C4. You may **add**
  formatters and keys; never rename or delete.
- The app shell (`src/components/app-shell/**`): C4.

## Items (most important first)

1. **The session cookie stops sliding.** `resolveTournamentSession`
   extends the database row on whichever authenticated request comes
   first after 24 h. Only `GET /api/t/me` re-issues the cookie. If
   another route slides the row first (`requireCurrentUserId`, the
   forecast, affiliation, restrictions or evidence routes, or the
   instrument quote), the cookie keeps its original 30-day `Max-Age`,
   and an active user is signed out. Two acceptable fixes:
   - every route that resolves a session re-issues the cookie whenever
     the row slid;
   - only the path that re-issues the cookie may slide the row.

   Add the missing test: nothing references `refreshedToken` or
   `TOURNAMENT_SESSION_REFRESH_MS` today.

2. **No timeouts on X requests.** The token and profile fetches in
   `x-oauth.ts` have none, so a hung X API holds the callback until the
   platform kills it. Add an `AbortSignal.timeout` and map the abort to
   the existing sign-in-failed path. Test it.

3. **Provenance completeness is unchecked.** `checkProvenance`
   (`verify-tournament.ts`) rebuilds each stored root. It never checks
   that every event of a batched hour is in that batch, or that every
   completed hour has a batch. An event committed after its hour was
   batched is orphaned silently, because `provenance.ts` returns early.
   Add both checks to `verify:replay`, with a test for each.

   If the orphan case can really happen, say how in the PR. Do not
   change existing batches: they are immutable.

4. **Append-only coverage is incomplete.** Reference prices cite
   `tournament_aggregates` ids, but the table has no append-only
   trigger; `004` covers only events and scores. The same holds for
   `tournament_resolution_notes` and `tournament_questions.void_note_md`
   once set. Add the triggers in a new migration. First confirm that no
   service updates or deletes those rows today.

5. **No rate limit on `POST /api/t/me/restrictions`.** Toggling between
   two sets writes unbounded rows to append-only tables. Limit it the
   way evidence is limited (per forecaster and per network), with the
   existing `rate_limits` helper. Affiliation is lower stakes, but give
   it the same treatment.

6. **Wrong error copy for every signed-in route.**
   `requireTournamentUserId` says "Sign in with X to submit a
   forecast." It is reused for affiliation, restrictions and evidence,
   and password accounts exist. Make it generic ("Sign in to continue.")
   or pass the action in.

7. **Two sign-out mutations behave differently.** `tournament-nav.tsx`
   invalidates only the tournament keys, so cached portfolio cash
   survives sign-out. `tournament-account.tsx` invalidates everything.
   Make one shared hook that invalidates everything. Coordinate with
   C4 if it is placed in the app shell.

8. **The question page has duplicated figures and copy.**
   - The crowd and market figures are derived twice:
     `question-workspace.tsx` and `forecast-editor.tsx`.
   - `ScoringNote` hard-codes "100 / ln 2 · ln(2p)" and the
     10%/2×/4× figures instead of using `forwardScoreLadder` /
     `FORWARD_MISS_RATIOS`. It also repeats the "time before your first
     forecast counts as 0" sentence that `formatTimeAverageNote`
     already renders on the same page.
   - "Sign in to forecast" appears twice, verbatim:
     `forecast-editor.tsx` and `sign-in-callout.tsx`.
   - "Forecasts are public" appears three times.
   - `tournamentKindCaption` and `tournamentSettleCue` (`format.ts`)
     are near-twins.
   - The 10-second limit is a literal in `forecast-editor.tsx` and
     `submit-forecast.ts`; use `FORECAST_RATE_LIMIT_MS`.
   - `PASSWORD_MIN_LENGTH` is redefined in `signin-page.tsx`; import it
     from the schema.

   The rendered text must stay identical (the scoring-copy test pins
   it) unless two copies disagree. If they do, keep the one the browser
   spec asserts.

9. **Query keys and URL encoding.**
   - `["openmarket","tournament"]` is written by hand in four
     components: `forecast-editor`, `affiliation-editor`,
     `tournament-nav` and `tournament-admin`. Add `queryKeys.tournament`
     and use it.
   - Slugs are not `encodeURIComponent`-ed in `question-workspace.tsx`
     and `forecast-editor.tsx` request paths.

10. **The question page loads twice and never 404s.**
    `app/t/q/[slug]/page.tsx` calls `loadQuestion` from both
    `generateMetadata` and the page, without `cache()`. Its catch-all
    turns an unknown slug into a 200 with an error panel. Wrap the
    loader in React `cache()` and call `notFound()` on
    `QUESTION_NOT_FOUND` (read the Next 16 docs in
    `node_modules/next/dist/docs/` first).

11. **A failed X sign-in loses the return path.** The start and
    callback routes redirect failures to `/t?sign_in=failed|unavailable`.
    Send them back to `/t/signin?return=…&sign_in=…` through
    `safeReturnPath`, and test it.

12. **The welcome step can loop.** A returning user whose session
    lapsed is sent back through `/t/welcome` (`welcome-step.tsx`).
    Reproduce it in `onboarding.spec.ts` first; fix only if it
    reproduces.

13. **`seed:tournament` can half-apply.** `seed-tournament.ts` saves and
    opens each question in separate writes, outside a transaction. Run
    each question's draft-and-open in one transaction. This script runs
    in every deploy (`vercel-build.ts`), so a partial seed is a deploy
    hazard.

14. **Dead code.**
    - `.accountMuted` (`tournament-nav.module.css`) is unused.
    - `formatPercent` is used only inside `format.ts`. Tell C4 rather
      than editing it.
    - Bucket-era code: the audit found none left after 013. Confirm.

15. **Missing tests.** Add the tests above that do not exist yet:
    - session sliding (item 1)
    - the login-failure throttle at route level
    - an X profile without `created_at` (pin today's behaviour; see
      Needs decision)
    - provenance completeness (item 3)

## Needs decision (do not implement)

- README 5: X accounts with no `created_at` skip the account-age check
  (`x-oauth.ts` maps it to null, and `submit-forecast.ts` skips the
  check).
- README 9: paginating the leaderboard and a question's
  latest-forecasts list.
- The evidence bonus score (README D9; Nick's).

## Done when

- Every item is done, did not reproduce, or needs decision.
- The tournament, onboarding, account and restrictions browser specs
  pass locally with `CI` unset.
- The gates pass, and `npm run verify:replay` stays clean with the new
  provenance checks.
