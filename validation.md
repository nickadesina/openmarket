# Cleanup review and combined validation

The six PRs are open; none is merged or deployed to production. The nine product/model decisions in the dispatch remain untouched.

| PR | Area | Review status |
| --- | --- | --- |
| [32](https://github.com/nickadesina/openmarket/pull/32) | Documentation and dispatch | Current-product documentation; updated for O3 having merged |
| [33](https://github.com/nickadesina/openmarket/pull/33) | C1 engine | Standalone CI and Backtest passed |
| [35](https://github.com/nickadesina/openmarket/pull/35) | C2 dealer | Draft; depends on C3 migration fixtures and C4 error codes |
| [36](https://github.com/nickadesina/openmarket/pull/36) | C3 tournament | Draft; migration 017 follows C2's 016, and admin status needs C4 |
| [37](https://github.com/nickadesina/openmarket/pull/37) | C4 markets UI | Draft; coordinated auth assertions need C2 and C3 |
| [34](https://github.com/nickadesina/openmarket/pull/34) | C5 infrastructure | Standalone CI and Backtest passed |

[The combined review branch](https://github.com/nickadesina/openmarket/tree/cl/cleanup-validation) contains all six PRs and resolves their documentation overlaps. Its tested commit is `262de6bc22546106ed8bff17c7efb993dd3b4108`. This is a review branch, not a production merge. The dependent drafts must be integrated together and gated before any deployment; their standalone CI is not green.

## Why the critical fixes are small

- Historical replay looks up the question ID already recorded in a reference row. Relinking does not rewrite history or invent a fallback price.
- Dealer and settlement transactions take listing locks before instrument locks. Dealer locks listings in sorted order before flag processing, which also touches instruments.
- Settlement retains one transaction per instrument. A failure rolls that transaction back, is recorded, and does not stop later instruments; the overall job still fails visibly.
- Only the session endpoint slides expiry, updating the row and issuing the matching cookie together. Other authenticated reads do not silently extend only the database expiry.
- Portfolio identity has one nullable cache contract; consumers handle signed-out and failed reads explicitly. Retrying reloads both identity and portfolio data.
- Scheduled cron workflows fail when their secret is missing. No new scheduler or retry service was added.

## Complexity, with limits

The existing Biome ceiling stays 25; no new complexity suppressions or dependencies were added. Replay's former score of 90, binary ticket's 79, forward ticket's 75, trade execution's 42 and median's 35 are split into focused functions and shared helpers. Maximum measured source-function complexity falls from 90 to 25. The engine/config subset's maximum falls from 35 to 17 while its measured sum remains unchanged.

This is not a claim of zero total complexity growth. Measuring the same `src/**/*.ts{,x}` files against master `07671bf`, stripping existing complexity ignores in a scratch copy, and summing reported function scores greater than 1 gives **3543 before and 3574 after (+31, 0.875%)**. Validation, provenance checks, failure isolation and explicit UI recovery states require additional branches. Shared calculations and smaller functions reduce local reasoning burden, but the aggregate metric rises slightly. This diagnostic excludes tests and scripts and is not a complete measure of architectural complexity. The PR descriptions explain each tradeoff.

The requested lower lint ceiling is deferred: existing functions still reach 25, and lowering it now would require additional unrelated refactoring. No extra abstraction was introduced just to manipulate that number.

## Preserved contracts

- Backtest inputs, simulator, analyzer, output artifacts and the pinned prior/rulebook/parameter tests are byte-for-byte unchanged against master.
- Applied migrations 001–015 are unchanged. Only new migrations 016 and 017 were added.
- Published numeric assertions remain intact. Regressions cover relink replay, concurrent locking, rollback and settlement continuation, cookie refresh, provenance omissions, identity recovery and cron configuration.
- Findings that did not reproduce, and changes requiring a product decision, are itemized in each PR rather than implemented speculatively.
- Before/after screenshots use disposable local fixtures and live on this evidence-only branch, outside the production diff.

## Verification

- Node 22.23.4, local PostgreSQL 17, system Chromium; no production database was used.
- `npm run check`: passed.
- Unit/property suite: 543 passed across 71 files.
- PostgreSQL integration suite: 168 passed across 25 files.
- `npm run build`, with database URLs unset: passed.
- Full desktop/mobile browser suite: 52 passed, 2 intentional skips for desktop-only controls (54 cases total, one complete run).
- `npm run verify:replay` against the populated browser database: passed; 10 markets, cash difference 0, 8 questions/4 forecast events, 10 mids/92 quotes/10 references, no findings. Historical relink/provenance cases are separately covered by integration tests.
- The docs PR's remote CI passed all pre-browser gates but hit ECONNRESET during a mobile registration setup. Its failed job was retried and remains in progress at this handoff. C1/C5 CI and Backtest are green; C2–C4 standalone CI is blocked by the documented dependencies.

The first combined integration run had three stale 401 assertions for authenticated non-admin users. Their owning agents changed them to the specified 403 contract; anonymous requests still assert 401. The rerun passed all 168 tests. No authorization check or assertion was removed.
