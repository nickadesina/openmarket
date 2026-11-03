# C5 — Scripts, CI, build, test harness, repo hygiene

Read `docs/prompts/cleanup/README.md`, `AGENTS.md`, `PART5.md`,
`README.md` §4–§5 and `.env.example` first.

The build and the jobs must fail loudly when something is wrong, and
the audits must catch what they claim to catch. The repo should
contain only what it uses. No workflow schedule changes, and no
change to what a deploy does unless an item says so.

## Yours

- `package.json` scripts and dependencies, `package-lock.json`
- `scripts/{migrate,vercel-build,verify-production-config,audit-styles,audit-deps}.ts`
- `.github/workflows/*.yml`: timeouts, concurrency, permissions, the
  secret-missing behaviour, triggers. The dealer, settle and alerts
  steps themselves are C2's.
- `biome.jsonc`, `tsconfig.json`, `next.config.ts`, `vercel.json`,
  `vitest.config.ts`, `playwright.config.ts`, `kysely.config.ts`
- `.gitignore`, `.env.example`
- `src/lib/db/{client,runtime,migrator}.ts`
- `tests/integration/postgres.ts`, `tests/browser/{global-setup,helpers,seed-dealer}.ts`

## Not yours

- Application code under `src/` (except the three db files above).
- `scripts/{verify-replay,seed-listings,api-key-create}.ts`: C2.
- `scripts/{seed-tournament,provenance-batch}.ts`: C3.

## Items (most important first)

1. **Cron workflows pass silently without the secret.** `dealer.yml`,
   `settle.yml` and `provenance.yml` exit 0 when `CRON_SECRET` is
   missing; only `dealer-alerts.yml` warns. Settlement could stop with
   every check green. On `schedule` runs, fail; on manual and fork runs,
   emit `::warning::` and skip. Update README §4's sentence about it.

2. **The deploy guard skips `CRON_SECRET`.** `verify-production-config.ts`
   checks the database, origin and branch, but not `CRON_SECRET`
   (≥ 16 characters; `src/lib/auth/cron.ts`). A missing or short
   secret deploys fine, and every cron call is then refused. Validate
   it for production; for preview, warn only.

3. **`audit-deps.ts` misses multi-line imports.** It matches one line
   at a time, so it skips the 123 multi-line imports in `src`. It also
   ignores `export … from` and dynamic `import()`. Parse with the
   TypeScript compiler API (already a dependency) or a multi-line
   regex over the whole file. The audit found no violation hidden
   today; prove the new audit still passes and add a test fixture
   that a multi-line violation fails.

4. **`.env.local` is never loaded.** Change the `tsx` scripts to
   `tsx --env-file-if-exists=.env.local …`. Node 22 supports the flag;
   check that the pinned `tsx` passes it through. Then delete the
   "export it first" workaround from README §4 and `AGENTS.md`. Builds
   and CI have no `.env.local`, so nothing changes there.

5. **Workflow hygiene.**
   - No workflow sets `concurrency`. CI should cancel superseded runs
     per ref; cron workflows should not overlap (`cancel-in-progress:
     false`).
   - Add least-privilege `permissions:` to each workflow.
   - `ci.yml` triggers on both `push` and `pull_request`, so PR
     branches run twice. Restrict `push` to `master`.
   - `backtest.yml` runs only on `pull_request`. Add a `push` to
     `master` with the same path filter.
   - Pinning actions to SHAs is optional; list it in the PR if you
     skip it.

6. **Redundant migrations in CI.** `ci.yml`'s "Prepare disposable
   browser database" step migrates, but `tests/browser/seed-dealer.ts`
   migrates again, and the replay step a third time. Keep one, and keep
   the replay step's own migrate only if the order needs it.

7. **Dead config and scripts.**
   - `kysely.config.ts` is referenced nowhere, and `kysely-ctl` is not
     installed. Delete it.
   - `playwright.config.ts` is not in the tsconfig `include`, so
     typecheck skips it. Add it.
   - `deploy:check`, `deploy:check:preview`, `test:watch` and `lint:fix`
     are referenced nowhere. Keep `deploy:check` (`PART5.md` now names
     it) and `lint:fix` (useful). Drop `test:watch` unless documented.
   - In `biome.jsonc`, the `*.mjs` entry in `files.includes` matches no
     file.
   - Run `biome migrate` to clear the configuration notice
     `npm run lint` prints.

8. **`migrate.ts` prints the raw error object.** Match
   `verify-replay.ts` and `provenance-batch.ts`: a secret-free message
   and a non-zero exit.

9. **Local harness flake sources.**
   - `db:test:local` hides `createdb` errors (`2>/dev/null;`). Ignore
     only "already exists".
   - `test:browser:local` and `db:test:local` assume a passwordless
     `$USER` role. Read `DATABASE_URL_TEST` when it is set.
   - Fixed ports 3100 and 3000 with `reuseExistingServer: false` fail
     opaquely when busy. Fail with a clear message.

10. **Lint scope.** `noNonNullAssertion` is off repo-wide with a reason
    that names only the engine (533 hits: 389 in tests, 40 engine, 15
    components/app). Turn it on for `src/components` and `src/app` via
    an override and fix those 15 sites, or narrow the reason to say why
    it stays off. Do not touch engine sites (C1) or test files in this
    pass.

11. **Lower the complexity ceiling.** Merge this item last, after
    C1–C4 have landed. If no function in `src/` sits between the next
    lower step and 25, lower the ceiling in `biome.jsonc`. Do not add
    ignores to get there.

12. **Trivia.** `.gitignore`'s `.env*.local` line is redundant after
    `.env*`. `public/logos/SOURCES.md` is publicly served; move it out
    of `public/` if nothing links it.

## Needs decision (do not implement)

- README 7: build before migrating in `vercel-build.ts`.
- README 8: untracking `.impeccable/` (145 files, 32 MB).

## Done when

- Every item is done, did not reproduce, or needs decision.
- A workflow run (or `act`, if available) shows the new failure modes.
- The gates pass.
- `npm run build` passes with no database URL.
