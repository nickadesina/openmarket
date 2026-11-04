# P1 — Archive v1, keep the gates green

Read `docs/prompts/v2/README.md` and decision `0003` first. v1 is tagged
(`archive/dealer-v1`, `archive/tournament-v1` on `5335ae5`); this part
removes it from `master`'s tree so v2 starts from a small, green base.

## Remove

- Dealer: `src/lib/engine/dealer/*` except `rulebook.ts` (moves, below),
  `src/lib/services/dealer/*` except what the ref infrastructure needs
  (see Keep), `src/lib/config/dealer.ts`, `listing-anchors.ts`,
  `demo-accounts.ts`, the LMSR engine and implied ladder
  (`src/lib/engine/{lmsr,seed,buckets,contracts,distribution,median,…}`)
  unless something kept imports them, trade/quote/portfolio/market
  services, `src/lib/solana`.
- Tournament: `src/lib/engine/tournament`, `src/lib/services/tournament`,
  `src/lib/config/tournament*.ts`, X OAuth, tournament sessions and
  passwords, `/t/*` pages and `/api/t/*` routes.
- Trading UI: `/m`, `/m/[slug]`, `/portfolio`, `/admin`, `/admin/dealer`,
  `/for-policy`, `/ref/trial`, every component only they use, the client
  hooks and query keys only they use.
- Routes: `/api/{activity,admin,cron/dealer,cron/settle,forward,instruments,markets,portfolio,quote,trade}`,
  `/api/ref/[slug]/*` and `/api/ref/listings` (P5 writes the v2 ones).
- Scripts: `seed-*`, `provenance-batch`, `export-proposer-questions`,
  `export-backtest-public`, `export-ref-examples`, `verify-replay`
  (ledger replay has no ledger to replay), `scripts/research/polymarket-*`.
- `backtest/` except `events.csv`, which moves to
  `data/round-history/events.csv` (update every reader:
  `export-round-history`, `round-history.ts`, `resolution-sources`, the
  rulebook fixture test). `backtest/data/sources.csv` moves alongside it
  if a kept reader uses it.
- `public/data/backtest/`, `.github/workflows/{backtest,dealer-alerts}.yml`,
  the dealer and settle crons in `vercel.json` (leave `crons` empty; P2
  adds ingest), the `verify:replay` step in CI and in `vercel-build.ts`,
  `seed:tournament` in `vercel-build.ts`.
- Tests for anything removed, including browser specs. Keep a browser
  smoke spec only if something renders; P5 rewrites them.
- `PART1.md`–`PART5.md` and `TECHNICAL_DESIGN.md` move to
  `docs/archive/v1/` unchanged. README D1–D14 move to
  `docs/archive/v1/README-decisions.md` unchanged.

## Keep

- `src/lib/db/*`. **All migration files stay** (`001`–`019`): the
  migrator needs them in order, and production has run them. If one
  imports removed code, inline the constant it needs into the migration
  with a comment; do not change what it does.
- `src/lib/api/*` route helpers (`withReadRoute`, `withRefRoute`,
  errors, pagination, response, schemas you still use), rate limiting,
  `src/lib/security`, `src/lib/logging`, `src/lib/auth/api-key.ts`,
  `src/lib/auth/cron.ts`, `api-key-create` script, the `ref` quota
  (`ref-access.ts` moves to `src/lib/services/ref-access.ts`), the keyset
  cursor helpers from `ref-common.ts` (move to
  `src/lib/services/ref-common.ts`; drop the dealer envelope — P5 writes
  the v2 envelope; until then a `refEnvelope` with `rulebook_version`
  and `as_of` only is fine).
- `src/lib/engine/dealer/rulebook.ts` → `src/lib/engine/rulebook.ts`
  with its tests and `tests/fixtures/rulebook-events.json`. Do not change
  its rules (P6 does); `/api/ref/rulebook` and `/rulebook` keep working.
- `/resolution-sources`, `/rulebook`, `/rulebook/changelog`, `/ref`
  (strip v1 routes from its docs; P5 rewrites it), `docs/tradeables/*`,
  `public/data/round-history.*`, the export scripts for resolution
  sources, round history and objections.
- `src/styles`, `DESIGN.md`, the app shell (strip nav entries for removed
  pages), the document components.
- `scripts/research/edgar-nport-marks.ts` and `lib.ts` (P2 promotes them).
- `scripts/audit-deps.ts`, `audit-styles.ts`, `migrate.ts`,
  `vercel-build.ts`, `verify-production-config.ts` (drop the env vars that
  only v1 used: X_*, TOURNAMENT_*, SOLANA_*; keep CRON_SECRET).
- `api_keys` and `api_key_usage` behaviour; `npm run api-key:create`.

## Then

- `/` renders a minimal holding page (title, one sentence from decision
  0003, links to `/rulebook`, `/resolution-sources`, `/ref`) until P5.
  `/m/*`, `/t/*`, `/portfolio`, `/admin/*`, `/for-policy` redirect to `/`
  (`next.config.ts` redirects, permanent: false).
- README: section 1 rewritten for v2 from decision 0003 (short); section
  2 keeps D13 (now "Kept, extended in v2"), D15 (already written), and a
  line pointing at `docs/archive/v1/README-decisions.md`; sections 3–6
  cut to what is still true. `AGENTS.md`: rewrite the OpenMarket section
  for the v2 layout (layers table from the v2 brief), keeping the
  Next.js block at the top byte for byte. `.env.example` loses v1 vars,
  gains `SEC_USER_AGENT` (described, no value).
- `package.json`: drop scripts and dependencies nothing uses
  (`lightweight-charts`, `@visx/*`, Solana, Radix if unused) — check with
  grep, keep what the remaining UI imports.

## Done when

`npm run check`, `npm run test:unit`, `npm run test:integration` and
`npm run build` pass; `git grep -n "engine/dealer\|services/tournament\|lmsr"`
returns only migrations, docs and the archive; the commit message names
the tags where v1 lives.
