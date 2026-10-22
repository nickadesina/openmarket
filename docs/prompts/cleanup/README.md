# Dispatch: robustness and cleanup pass

Five briefs for five agents. Each brief stands alone; every agent reads
this README, `AGENTS.md` and its own brief before changing anything.
Read `README.md` §2 and `CONTRACTS.md` too if your brief touches
anything that quotes, settles or scores.

The pass makes the code we have **correct, robust and smaller**, with
no change to the product. It is not a feature pass and not a redesign.

## Where the findings came from

Five read-only audits of `master` at `1267615` (2026-10-22), one per
area. In the same change that added these briefs, the docs were brought
in line with the code: `README.md` (drift register reduced to live
rows), `TECHNICAL_DESIGN.md` (marks what is not built), `CONTRACTS.md`
(marks rules that are *not built*), `AGENTS.md`, `PRODUCT.md`,
`DESIGN.md`, `PART1`–`PART5`, `.env.example`, `docs/ARTIFACTS.md`.
Finished briefs moved to `docs/archive/prompts/`; they are history, not
instructions. **When a doc and the code disagree, the code is the
product; the docs are believed to match it now. If you find a mismatch,
fix the doc in your PR rather than changing behaviour to fit it.**

Baseline at `1267615`: `npm run check` clean (one Biome notice asking
for `biome migrate`, C5's), 396 unit tests and 137 integration tests
green against a local Postgres.

Line numbers in the briefs are as of `1267615` and will drift; find the
code by the symbol named.

## Workstreams

| Brief | Area | Branch |
| --- | --- | --- |
| `c1-engine.md` | Pure engine: LMSR, grid, dealer engine, tournament engine, `config/dealer.ts` | `cl/c1-engine` |
| `c2-dealer.md` | Dealer services, the two cron jobs, the reference API, `verify:replay` | `cl/c2-dealer` |
| `c3-tournament.md` | Tournament services, routes, pages, sign-in and sessions, provenance | `cl/c3-tournament` |
| `c4-markets-ui.md` | Markets screens, read APIs, trading routes, comments, `src/lib/api`, the client lib | `cl/c4-markets-ui` |
| `c5-infra.md` | Scripts, CI workflows, build, test harness, repo hygiene, lint config | `cl/c5-infra` |

All five run in parallel from `master` and each opens one PR to
`master`.

## Rules for every agent

**Ownership.**
- A brief's "Yours" list is what you may edit. Its "Not yours" list is a
  hard boundary.
- A change another workstream must make goes in your PR description
  under "Needs from C*". Never make it in their files.
- Shared files have append-only rules:
  - `src/lib/client/format.ts`, `src/lib/client/query-keys.ts` and
    `src/lib/db/schema.ts` belong to C4, C4 and C2 respectively.
  - Another workstream may **add** an export or a key there (never
    rename, reorder or delete). Say so in the PR.
- Doc files are shared. Change only the sentences your code change makes
  untrue, and merge `master` before you open the PR.

**What a cleanup may change.**
- Delete dead code: no importer in `src/`, `scripts/` or `tests/`. An
  export used only by tests is not dead if the test pins a documented
  invariant; make it file-private only if the test can reach it
  another way.
- Merge duplicated logic into one place.
- Add validation, error handling, locking, timeouts and tests.
- Split functions that carry a complexity `biome-ignore` along the split
  the comment names, then remove the ignore.
- Fix a bug a test can demonstrate. Write the failing test first, in the
  same PR.

**What it may not change** without a decision from Nick, each listed
under "Needs decision" in your brief:
- The `AGENTS.md` "Not open" list.
- Anything that changes a published number:
  - a model mid, quote, reference price, score or aggregate;
  - `backtest/` inputs (any edit to `events.csv`, `sim.py` or
    `analyze.py` changes `inputs_sha256` and forces a new
    `MODEL_VERSION`);
  - the rulebook's published text or rules (a `RULEBOOK_VERSION` bump);
  - blend constants (a `BLEND_VERSION`).
- Product behaviour a user can see (copy aside from fixing a factual
  error), API response shapes, and the scoring rule.
- Never edit an applied migration (`001`–`015`). New schema goes in a
  new migration with the next free number. O3 merged in #31 with
  `015_demo_accounts` (`docs/prompts/onboarding-and-demo/`), so
  take `016` or later and say so in the PR. Two cleanup PRs needing
  migrations take consecutive numbers: C2 first, C3 next.

If an item turns out to need one of these, stop on that item, record
what you found under "Needs decision" in the PR, and carry on with the
rest.

**Verify before fixing.** Every item came from a read-only audit. Before
you change code, confirm the finding against the code (and with a test
where it is a bug). If it does not reproduce, write "did not reproduce"
and why in the PR, and skip it. Do not invent work to fill a brief.

**Gates before you open the PR.** All must be green:

```
npm run check
npm run test:unit
DATABASE_URL_TEST=postgresql://<user>:<pass>@localhost:5432/openmarket_test npm run test:integration
```

- `npm run db:test:local` creates the database on a Homebrew Postgres.
  In a cloud container: `service postgresql start`, create a superuser
  role with a password, then `createdb openmarket_test`.
- Run the browser specs your change touches with `CI` unset
  (`env -u CI npm run test:browser:local`). Chromium may need an
  `executablePath` override in a scratch config outside the repo; never
  run `playwright install`.
- The complexity ceiling (`biome.jsonc`, 25) only goes down. Never add a
  `biome-ignore`.

**PR shape.**
- One PR per workstream.
- Commits grouped by item, each message naming the item number from
  your brief.
- The description is a table of every item in your brief: done, did not
  reproduce, or needs decision, each with one line.
- Then "Needs from C*" and "Needs decision".
- Screens: before/after screenshots at desktop and 375px.

**Merging.** A merge to `master` deploys to production (the Vercel
build migrates and runs `verify:replay`; README §5). Open the PR and
stop. Merge only if Nick's dispatch message for this pass says to; then
merge `master` into your branch first, re-run the gates, and merge.

## Needs decision (collected; Nick)

Each is repeated in the brief that would implement it. Agents do not
act on these.

1. **Charter re-centring** (`CONTRACTS.md`, `RULEBOOK.charter`, served
   at `/api/ref/rulebook`). Build it in the mid model (a model version),
   or drop it from the rulebook (a rulebook version).
2. **Unread rulebook rules.** Wire up or drop `RULEBOOK.review.review_hours`
   (the 24 h queue) and `pressRank` (rank 3's "two independent
   outlets"). Either path is a rulebook version.
3. **Release flags in the binary's leak jump.** `compute-mids.ts`
   counts `release` flags; `sim.py` knows only scoops. Align one way;
   either is a model change.
4. **Dead backtest parameters.** `flag_b_mult`, `sigma_stepup` and the
   unused γ in `sim.py`. Removing them costs a new `MODEL_VERSION` and
   regenerated `params.json` and `prior_golden.json`.
5. **X accounts with no `created_at`.** They currently skip
   `min_account_age_days`. Recommend: fail closed, with a clear refusal
   and a log line.
6. **Comment threads are keyed by the live epoch's market id.** The
   visible thread changes at each roll, and settled threads cannot be
   moderated from `/admin`. Options: key by listing, or list settled ids
   in `/admin`.
7. **Deploy order.** `scripts/vercel-build.ts` migrates and opens
   questions before `next build`. Recommend building first, then
   migrate → seed → replay, so a failed compile changes nothing.
8. **`.impeccable/`.** 145 tracked files, 32 MB of design-tool
   screenshots and mocks, referenced only by `biome.jsonc`. Untrack and
   ignore, or keep.
9. **Unbounded lists.** The leaderboard and a question's
   latest-forecasts list have no limit. Paging them changes a screen.
