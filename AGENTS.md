<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# OpenMarket, for agents

Paper-money markets on private-company valuations. The code on `master` runs two 41-bucket LMSR markets (Anthropic, Stripe); the adopted design is five names with a quarterly binary and a next-print forward each, quoted by the venue as dealer. `README.md` section 2 (D10–D14) is the decision record, `CONTRACTS.md` is normative for the instruments, `TECHNICAL_DESIGN.md` is the build plan, and `backtest/` is the evidence — read the first two before touching anything under `src/lib/engine/dealer` or `src/lib/services/dealer`. Product limits live in `PRODUCT.md`; the visual system and its named rules live in `DESIGN.md`. Read both before changing a screen.

## Gates (all run in CI; run them before you finish)

```
npm run check            # typecheck + biome + style audit + layer audit
npm run test:unit        # engine, services, property tests
npm run verify:replay    # ledger invariants against DATABASE_URL_UNPOOLED
```

- `biome.jsonc` is lint and format; each disabled rule carries its reason inline. `noExcessiveCognitiveComplexity` is a ratchet: functions above it carry a `biome-ignore` naming the split to make. Lower the ceiling, never add ignores.
- `scripts/audit-styles.ts`: no literal `font-size` outside `tokens.css`, every rem on the 4px grid, no color literal outside `tokens.css` except white, the module tab only via `.moduleTab`.
- `scripts/audit-deps.ts`: engine imports engine only; services never import UI; components use services as types and get data through `/api`.

## Layout of the code

- `src/lib/engine` pure LMSR arithmetic, buckets, median and quantiles. No I/O.
- `src/lib/engine/dealer` the dealer design's pure code: `rulebook.ts` (what settles, versioned). `src/lib/services/dealer` one file per dealer operation.
- `src/lib/config/dealer.ts` reads `backtest/out/params.json`; never write a parameter in code. A rerun of `backtest/analyze.py` that changes it adds a model version with the file's digest to `PARAMS_SHA256_BY_MODEL_VERSION`; never rewrite a published one.
- `src/lib/services` one file per operation on the ledger (`quote`, `execute-trade`, `get-market`, `get-marks`, `verify-replay`).
- `src/app/api` thin routes over services. `src/components` client UI, one folder per module with its `.module.css`.
- `src/styles/tokens.css` the six-step type ramp, row heights, one red. `src/styles/shared.module.css` composable primitives: `.moduleTab`, `.seal`, `.buttonBase`.

## Conventions

- Imports are relative and carry the `.js` extension (`../../lib/client/format.js`); there is no path alias. Type-only imports use `import type`.
- Client formatting lives in `src/lib/client/format.ts`, requests in `api.ts`, React Query keys in `query-keys.ts`, and trade submission in `use-trade-execution.ts`. Add a formatter there before writing an `Intl` instance in a component.
- Contract prices (average fill, price after) are probabilities of a $1 payout and render through `formatContractPrice`; cash (cost, proceeds, marked value) renders through `formatUsd` or `formatCents`. Both trade reviews render their rows through `src/components/quote-review`.
- Module CSS never uses `!important` (Biome enforces it); a rule that must outrank a same-file default gets a scoped selector with a one-line comment saying what it outranks.

## Local traps

- Browse `http://localhost:3000`, never `127.0.0.1`: dev resources are origin-checked and hydration fails silently.
- Sign-in needs `USER_COOKIE_SECRET` in `.env.local`; `/admin` needs `ADMIN_PASSPHRASE_HASH`. Mutations reject requests without a browser `Origin`, so sign in through the UI, not curl.
- Browser tests: `brew services start postgresql@17 && npm run db:test:local`, then `npm run test:browser:local` (Playwright boots its own server on port 3100 against that database; specs skip when `DATABASE_URL_TEST` is unset).
- `@next/env` re-runs `$` expansion over any process variable that `.env.local` also defines, so an `ADMIN_PASSPHRASE_HASH` (`scrypt$16384$…`) passed to `next dev` from the environment arrives as `scrypt6384…` and admin login 500s. `playwright.config.ts` escapes the hash as `\$` when `.env.local` shadows it; do the same for any ad-hoc dev server, or write the hash to `.env.local` and let the file win.
- Playwright reads `CI` to pick port 3000 and the checkout's own `APP_ORIGIN`; a shell with `CI=true` exported runs the local suite in CI mode. `env -u CI npm run test:browser:local` restores the local layout.
- Rebuild dev data with `npm run reseed:dev` (real anchors, scripted sixteen-day narrative), then `npm run verify:replay`, then `scripts/dump-dev-seed.sh` to refresh `scripts/dev-seed.sql`. `pg_dump` aborts on the Neon 18 / client 17 mismatch; the dumper is psql only.
- Real data only. Never invent rows, stats, or copy; every figure on a screen derives from the API.
- Dealer parameters (μ, λ, k, σ per tier, b, Q, κ, T) are read from `backtest/out/params.json` via `src/lib/config/dealer.ts`. Change them by changing the backtest and re-running `python3 backtest/analyze.py`, never by editing the config.
- Not open to agents: two contracts per name; void-and-refund on no print; log units in the engine; the dealer always quotes; every published price carries its model, rulebook and blend versions.
