<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# OpenMarket, for agents

A published index of private-company marks built only from public filings (decision `0003`, README D15). The unit is one per-share mark on one security, from one filer, as of one date, with its source document; consensus, dispersion, mark versus print, revisions, SPV premium and structure gap are derived from those rows under a versioned methodology. Nothing in v2 prices anything: no venue, no quote, no model mid, no forecast. v1 (the dealer's paper markets and the forecasting tournament) is archived at the tags `archive/dealer-v1` and `archive/tournament-v1` (`git show archive/dealer-v1:<path>`); its decisions are `docs/archive/v1/README-decisions.md` and its design documents are under `docs/archive/v1/`. The build is `docs/prompts/v2/README.md` (the shared contract: layers, schema, versions, routes) with one brief per part; read it, decision `0003` and your part's brief first. `README.md` is the decision record and the running instructions, `TECHNICAL_DESIGN.md` is how the index is built (and what is not), `CONTRACTS.md` is normative for the contracts that settle on the index, and `METHODOLOGY.md` is the public spec of the index. Product limits live in `PRODUCT.md`; the visual system and its named rules live in `DESIGN.md`. Read both before changing a screen.

## Gates (all run in CI; run them before you finish)

```
npm run check            # typecheck + biome + style audit + layer audit
npm run test:unit        # engine, services, routes, pages
npm run test:integration # PostgreSQL suites; needs DATABASE_URL_TEST (a disposable database)
npm run build
npx playwright test      # browser smoke specs; seeds DATABASE_URL_TEST first (tests/browser/seed.ts)
```

- `biome.jsonc` is lint and format; each disabled rule carries its reason inline. `noExcessiveCognitiveComplexity` is a ratchet: functions above it carry a `biome-ignore` naming the split to make. Lower the ceiling, never add ignores.
- `scripts/audit-styles.ts`: no literal `font-size` outside `tokens.css`, every rem on the 4px grid, no color literal outside `tokens.css` except white, the module tab only via `.moduleTab`.
- `scripts/audit-deps.ts`: engine imports engine only; services never import UI; components use services as types and get data through `/api`. It enforces the layers table below.

## Layout of the code

| Path | What | May import |
| --- | --- | --- |
| `src/lib/engine/index/` | Pure index arithmetic: series labels, filer families, consensus, dispersion, listed names and the headline, mark vs print, revisions, SPV premium, waterfall and common-equivalent, `METHODOLOGY_VERSION`, `CE_VERSION` | engine only |
| `src/lib/engine/rulebook.ts` | The settlement rulebook, versioned (`RULEBOOK_VERSION` 2.0.0), with the v2 source classes and ranks | engine only |
| `src/lib/ingest/parse/` | Pure parsers: a document's text in, typed records out | engine, ingest/parse, zod |
| `src/lib/ingest/fetch/` | Source clients: the SEC client (`SEC_USER_AGENT`, polite fetching), full-text search. The only network code | ingest, node |
| `src/lib/services/index/` | One file per operation: ingest a source, import a file, read a name's index, the ref payloads, the CSVs | engine, ingest, db, api |
| `src/app/api/ref/*`, `src/app/data/*` | Thin routes over services via `withRefRoute` / `withCsvRoute` | services |
| `src/app/**/page.tsx` | Server components; pages that read the database are `force-dynamic` and call the services directly | anything |
| `src/components/*` | UI; data from the page as props or through `/api` | services as types |
| `data/index/` | Checked-in inputs Nick edits (`watchlist.json`, `filer-families.json`, `certificates/`, `spv-quotes/`) and the search's outputs (`filings-by-name.csv`, `filer-counts.md`, `filing-counts.json`, `sources-status.md`) | — |

What is in the tree now:

- `src/lib/engine`: `rulebook.ts` (2.0.0: `SOURCE_CLASSES`, `sourceRank(class, purpose?)`, `NOT_BUILT`), the guards (`assert.ts`) and day arithmetic (`time.ts`), and `index/` (`classifySecurity`, `perShareMark`, `parseFilerFamilies`/`resolveFamily`/`familyMarks`, `consensusSeries`, `isPrivateMark`/`headlinePoint`, `revisions`, `markVersusPrint`, `spvPremium`, `commonEquivalent`/`structureGap`, `METHODOLOGY`). No I/O.
- `src/lib/db`: the client (pooled for routes; a direct client for scripts that leases its one connection to one caller at a time), the migrator, `schema.ts` and migrations `001`–`023`. All migrations stay: production has run them and the migrator needs them in order. v1's tables stay in the database and in `schema.ts`; of them v2 code reads only `api_keys`, `api_key_usage` and `rate_limits`. `020_marks_index` holds the v2 data model (issuers, source_documents, filer_marks, prints, certificates, certificate_series, spv_vehicles, spv_quotes, corrections, ingest_runs); triggers keep source_documents and corrections append-only and let a filer mark change only by being superseded once; `021` makes a holding unique once as filed and once per correction; `022` corrects certificates as rows and adds an issuer's listing; `023` adds a certificate's newest series, common authorized and unmodelled terms. A new table is a new migration, never an edit to a published one.
- `src/lib/api`: route helpers (`withReadRoute` in `request-context.ts`; `withRefRoute` in `ref-route.ts`: the query's names and values parsed before one unit of the `ref` quota, 60 s anonymous cache, keyed requests private; `withCsvRoute` in `csv-route.ts`: the same policy, a streamed body, the licence `Link`; `mutation-route.ts`; errors, pagination, response).
- `src/lib/services`: `ref-access.ts` (the `ref` quota and `insertApiKey`), `ref-common.ts` (keyset cursors), `get-rulebook.ts`, `rate-limit.ts`, and `index/`: `ref-envelope.ts` (the envelope and `LAG_NOTE`), `get-name-index.ts` (one name: labels, family marks, consensus, revisions, prints, structure, SPVs, `out_of_series`, `coverage`, `no_marks`), `list-names.ts`, `name-coverage.ts` (why a name has no marks, from `filing-counts.json`), `ref-*.ts` (the routes' payloads), `data-csv.ts` (the CSVs, `issuer=`), `published-families.ts`, `search-filings.ts`, `build-families.ts`, `sync-watchlist.ts`, `ingest-nport.ts`, `ingest-form-d.ts`, `import-prints.ts`, `import-certificates.ts`, `import-spv-quotes.ts`, `relabel-marks.ts`, `ingest-runs.ts`, `run-scheduled-ingest.ts`, `data-files.ts`.
- `src/lib/ingest`: `fetch/` (`sec.ts`, `efts.ts`, `disk-cache.ts`) and `parse/` (`nport.ts`, `efts.ts`, `form-d.ts`, `ncen.ts`, `submissions.ts`, `watchlist.ts`, `families.ts`, `certificate.ts`, `spv-quote.ts`, `xml.ts`). Fixtures: `tests/fixtures/index/` (real EDGAR documents, trimmed; its README says how) and `tests/fixtures/certificates/` (the schema fixture's invented issuer).
- `src/lib/auth`: `api-key.ts` (keys are `om_` plus 43 base64url characters; only the SHA-256 is stored; `npm run api-key:create`) and `cron.ts` (`CRON_SECRET`).
- `src/lib/tradeables`: the resolution-source map, the round-history dataset, the objection catalog's export, the rulebook page's sections, the `/ref` page's field docs (`ref-docs.ts`), `methodology-doc.ts` (METHODOLOGY.md with the engine's constants), `repo-docs.ts`.
- `src/app`: `/` (the daily page), `/n/[slug]`, `/methodology`, `/corrections`, `/rulebook` (and `/changelog`), `/resolution-sources` (and `.md`), `/ref`; `/api/ref/{names,[slug],[slug]/marks,[slug]/revisions,[slug]/spv,methodology,corrections,rulebook}`, `/data/{filer-marks,certificate-terms,spv-matches}.csv`, `GET /api/cron/ingest` (Vercel Cron, daily). `next.config.ts` redirects v1's paths to `/`.
- `src/components`: `app-shell` (nav: Index, Methodology, Rulebook, API, Corrections), `document` (repository Markdown as React), `index/` (the index pages: `format.ts`, `mark-chart.tsx` plain SVG, `name-sections.tsx`, `structure-spv.tsx`, `versions.tsx`, `share-text.ts`, `index.module.css`).
- `src/styles/tokens.css` the six-step type ramp, row heights, one red. `src/styles/shared.module.css` composable primitives (`.moduleTab`, `.seal`, `.buttonBase`, `.primaryButton`, `.inputFrame`, `.sectionHead`, `.visuallyHidden`, `.skeletonBlock`, …); compose them rather than restating.
- Scripts: `npm run index:watchlist`, `index:search` (`--recount`), `index:families`, `index:ingest -- --source=nport|form_d`, `index:prints`, `index:certificates`, `index:spv-quotes`, `index:relabel`, `export:ref-examples` (README §4 gives the order). Browser tests: `tests/browser/seed.ts` (run by `global-setup.ts`) fills `DATABASE_URL_TEST` through the import services from the real fixtures.

## Conventions

- Imports are relative and carry the `.js` extension (`../../lib/engine/rulebook.js`); there is no path alias. Type-only imports use `import type`.
- Versions open every published payload (`methodology_version`, `ce_version`, `rulebook_version`, `as_of`; until P5 the envelope is `rulebook_version` and `as_of`). Changing a published rule or constant is a new version, never an edit.
- Module CSS never uses `!important` (Biome enforces it); a rule that must outrank a same-file default gets a scoped selector with a one-line comment saying what it outranks.

## Local traps

- Browse `http://localhost:3000`, never `127.0.0.1`: dev resources are origin-checked and hydration fails silently.
- Browser tests: `brew services start postgresql@17 && npm run db:test:local`, then `npm run test:browser:local` (Playwright boots its own server on port 3100; specs skip when `DATABASE_URL_TEST` is unset).
- Playwright reads `CI`: with it set, it serves on the shell's `APP_ORIGIN` (default `http://127.0.0.1:3000`; must be http with a port) instead of port 3100; `PLAYWRIGHT_APP_ORIGIN` overrides either. A shell with `CI=true` exported runs the local suite in CI mode. `env -u CI npm run test:browser:local` restores the local layout.
- The npm scripts load `.env.local` when it exists (`--env-file-if-exists`); exported variables take precedence.
- EDGAR: every request sends `SEC_USER_AGENT` (a name and a contact; code refuses to run without it) and stays under ten requests a second. Never put a personal email in code or config; the operator sets the variable.

## Not open to agents

- The source rule (decision 0003 §4): every input is a public filing, a document bought from a public registry, or a price on a page served without a login. Never fetch behind a login, a paywall or a robots disallow; never touch Forge, Caplight, Hiive, EquityZen or any vendor indicator. A source you cannot reach is reported as not built, never imitated.
- Real data only. Never invent rows, stats, or copy; every figure on a screen derives from the API. Test fixtures are real documents fetched from the source (trimmed is fine; say so), never hand-typed imitations.
- Never adjust a filer's mark: no interpolation, smoothing, carry forward or fill. A missing filing is a missing row.
- No model mid, no forecast, no quote. Every published number carries the versions that produced it.
