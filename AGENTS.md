<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# OpenMarket, for agents

Paper-money markets on private-company valuations. Two markets, Anthropic and Stripe. Product limits live in `PRODUCT.md`; the visual system and its named rules live in `DESIGN.md`. Read both before changing a screen.

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
- `src/lib/services` one file per operation on the ledger (`quote`, `execute-trade`, `get-market`, `get-marks`, `verify-replay`).
- `src/app/api` thin routes over services. `src/components` client UI, one folder per module with its `.module.css`.
- `src/styles/tokens.css` the six-step type ramp, row heights, one red. `src/styles/shared.module.css` composable primitives: `.moduleTab`, `.seal`, `.buttonBase`.

## Local traps

- Browse `http://localhost:3000`, never `127.0.0.1`: dev resources are origin-checked and hydration fails silently.
- Sign-in needs `USER_COOKIE_SECRET` in `.env.local`; `/admin` needs `ADMIN_PASSPHRASE_HASH`. Mutations reject requests without a browser `Origin`, so sign in through the UI, not curl.
- Playwright specs skip unless `DATABASE_URL_TEST` is set; they boot their own server on port 3100.
- Rebuild dev data with `npm run reseed:dev` (real anchors, scripted sixteen-day narrative), then `npm run verify:replay`, then `scripts/dump-dev-seed.sh` to refresh `scripts/dev-seed.sql`. `pg_dump` aborts on the Neon 18 / client 17 mismatch; the dumper is psql only.
- Real data only. Never invent rows, stats, or copy; every figure on a screen derives from the API.
