<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# OpenMarket, for agents

Paper-money markets on private-company valuations. The code on `master` lists names for the dealer (`listings`, `instruments`) and runs a forecasting tournament under `/t` (README D9) whose questions are the dealer's two contracts, one p of YES on a binary or one level on a forward (`docs/decisions/0004`), and whose sign-in is the only identity: a paper balance opens for a tournament user on first use (README D1). `/` redirects to the tournament; the paper markets live at `/m` (board) and `/m/[slug]` (one ticket for both contracts), five names with a quarterly binary and a next-print forward each, quoted by the venue as dealer. The 41-bucket grid is a read-only implied ladder; ingest (`TECHNICAL_DESIGN.md` §4) is not built. `README.md` section 2 (D10–D14) is the decision record, `CONTRACTS.md` is normative for the instruments, `TECHNICAL_DESIGN.md` says how it is built (and marks what is not), and `backtest/` is the evidence — read the first two before touching anything under `src/lib/engine/dealer` or `src/lib/services/dealer`. Product limits live in `PRODUCT.md`; the visual system and its named rules live in `DESIGN.md`. Read both before changing a screen.

## Gates (all run in CI; run them before you finish)

```
npm run check            # typecheck + biome + style audit + layer audit
npm run test:unit        # engine, services, routes, property tests
npm run test:integration # PostgreSQL suites; needs DATABASE_URL_TEST (a disposable database)
npm run verify:replay    # ledger invariants against DATABASE_URL_UNPOOLED
```

- `biome.jsonc` is lint and format; each disabled rule carries its reason inline. `noExcessiveCognitiveComplexity` is a ratchet: functions above it carry a `biome-ignore` naming the split to make. Lower the ceiling, never add ignores.
- `scripts/audit-styles.ts`: no literal `font-size` outside `tokens.css`, every rem on the 4px grid, no color literal outside `tokens.css` except white, the module tab only via `.moduleTab`.
- `scripts/audit-deps.ts`: engine imports engine only; services never import UI; components use services as types and get data through `/api`.

## Layout of the code

- `src/lib/engine` pure LMSR arithmetic, and the buckets, median and quantiles of the dealer market's read-only implied ladder. No I/O. `engine/tournament` holds the tournament's scoring (`score.ts`: the binary log score, the forward score, the time average), crowd (`aggregate.ts`: pooled p, median level) and forecast payload (`forecast.ts`: validation and the canonical string `event_hash` covers, legacy vectors included). The tournament has no buckets.
- `src/lib/engine/dealer` the dealer design's pure code: `rulebook.ts` (what settles, versioned), `prior.ts` (sim.py's prior: tier, binary p, forward mid; held to `backtest/out/prior_golden.json`), `forward.ts` (quote, fill, collateral, payout), `binary.ts` (LMSR seed, price clamp, loss bounds), `lifecycle.ts` (`instruments.state` transitions and their effects), `blend.ts` (the reference price and its published schedule under `BLEND_VERSION`; policy, not a backtest parameter). `src/lib/services/dealer` one file per dealer operation: the dealer job's steps in `DEALER_STEPS` order (`apply-flags` → `list-instruments` → `compute-mids` → `requote` → `reference-prices`, run by `run-dealer-job`), `settle-instruments` (the settle job: promote, resolve, pay or void, roll; one transaction per instrument), `get-instrument-quote` and `execute-forward-trade`; `dealer-books.ts` holds what they share (live states, the listing-to-quote mapping, inventory, quote rows), and `verify-dealer` recomputes every mid, quote and reference row. `get-dealer-health` and `get-dealer-admin` feed the dealer job's report, `dealer-alerts.yml` (daily widening and job-freshness alarm, excluding its own probes) and `/admin/dealer`. Vercel Cron schedules dealer, settle and provenance in `vercel.json`; the alert is the only scheduled job Action.
- The reference API: `src/app/api/ref/*` routes go through `withRefRoute` (`src/lib/api/ref-route.ts`: 60 s anonymous cache (keyed requests are private), `ref` quota); one service per route in `services/dealer/ref-*` (`ref-listings`, `ref-reference`, `ref-history`, `ref-mids`, `ref-flags`; the rulebook route reads `get-rulebook.ts`), each putting the version envelope first via `ref-common.ts` (envelope, slug lookup, keyset cursors) and `ref-access.ts` (network bucket or API key). Keys: `src/lib/auth/api-key.ts`, `npm run api-key:create`; only the SHA-256 is stored.
- `src/lib/config/dealer.ts` reads `backtest/out/params.json`; never write a parameter in code. A rerun of `backtest/analyze.py` that changes it adds a model version with the file's digest to `PARAMS_SHA256_BY_MODEL_VERSION`; never rewrite a published one.
- `src/lib/services` one file per operation on the ledger (`quote`, `execute-trade`, `get-market`, `get-marks`, `verify-replay`); `services/tournament` likewise for the tournament. `quote` and `execute-trade` find their book through `trade-book.ts`: a dealer binary by `market_id` (clamped, live only); `services/dealer/settle-lmsr-book.ts`'s `settleLmsrBook` pays any LMSR book.
- `src/app/api` thin routes over services. `src/components` client UI, one folder per module with its `.module.css`.
- `src/styles/tokens.css` the six-step type ramp, row heights, one red. `src/styles/shared.module.css` composable primitives (`.moduleTab`, `.seal`, `.buttonBase`, `.primaryButton`, `.inputFrame`, `.sectionHead`, `.visuallyHidden`, `.skeletonBlock`, …); compose them rather than restating.

## Conventions

- Imports are relative and carry the `.js` extension (`../../lib/client/format.js`); there is no path alias. Type-only imports use `import type`.
- Client formatting lives in `src/lib/client/format.ts`, requests in `api.ts`, React Query keys in `query-keys.ts`, and trade submission in `use-trade-execution.ts`. Add a formatter there before writing an `Intl` instance in a component.
- Contract prices (average fill, price after) are probabilities of a $1 payout and render through `formatContractPrice`; cash (cost, proceeds, marked value) renders through `formatUsd` or `formatCents`. Every trade review (forward, binary, the portfolio's sale) renders its rows through `src/components/quote-review`.
- Module CSS never uses `!important` (Biome enforces it); a rule that must outrank a same-file default gets a scoped selector with a one-line comment saying what it outranks.

## Local traps

- Browse `http://localhost:3000`, never `127.0.0.1`: dev resources are origin-checked and hydration fails silently.
- Sign in through `/t/signin`: X needs `X_CLIENT_ID`; without it, a username and password. With `TOURNAMENT_DEV_SIGN_IN=1` under `next dev` the header and tournament nav offer a handle-only sign-in. `/admin` and `/t/admin` admit the accounts in `TOURNAMENT_ADMIN_X_IDS`, written lowercase (`dev:<handle>` for a dev sign-in, `password:<username>`). Mutations reject requests without a browser `Origin`, so sign in through the UI, not curl.
- Browser tests: `brew services start postgresql@17 && npm run db:test:local`, then `npm run test:browser:local` (Playwright boots its own server on port 3100 against that database; specs skip when `DATABASE_URL_TEST` is unset).
- Playwright reads `CI`: with it set, it serves on the shell's `APP_ORIGIN` (default `http://127.0.0.1:3000`; must be http with a port) instead of port 3100; `PLAYWRIGHT_APP_ORIGIN` overrides either. A shell with `CI=true` exported runs the local suite in CI mode. `env -u CI npm run test:browser:local` restores the local layout.
- The npm scripts load `.env.local` when it exists (`--env-file-if-exists`); exported variables take precedence.
- Dev data: `npm run db:migrate && npm run seed:listings -- --listed-at=<ISO>` (the listed names from `backtest/`; `npm run seed:tournament` for the tournament's questions), then `npm run verify:replay`. The only scripted trading history is the demo accounts' (`npm run seed:demo` after a dealer run; decision `0005`).
- Real data only. Never invent rows, stats, or copy; every figure on a screen derives from the API. One exception (decision `0005`): the five labelled demo accounts `npm run seed:demo` creates trade the listed names through the real services, to show the markets working; they never sign in, forecast or post, and every row of theirs carries a "Demo" tag.
- Dealer parameters (μ, λ, k, σ per tier, b, Q, κ, T) are read from `backtest/out/params.json` via `src/lib/config/dealer.ts`. Change them by changing the backtest and re-running `python3 backtest/analyze.py`, never by editing the config.
- Not open to agents: two contracts per name; void-and-refund on no print; log units in the engine; the dealer always quotes; every published price carries its model, rulebook and blend versions.
