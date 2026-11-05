# OpenMarket

A published index of private-company marks, built only from public
filings (decision `0003`, D15). The product is the number and its
provenance: one per-share mark on one security, from one filer, as of
one date, with its source document, and the disagreement between
filers derived from those rows. The build is specified in
`docs/prompts/v2/README.md`; `docs/ARTIFACTS.md` indexes every artifact,
in the repo or not.

v1 (paper-money markets quoted by the venue as dealer, and a
forecasting tournament) is archived at the tags `archive/dealer-v1` and
`archive/tournament-v1` (both on `5335ae5`). Its decision record is
`docs/archive/v1/README-decisions.md` (D1–D14); its design documents
are under `docs/archive/v1/`.

## 1. Product

- What it is: an index of the marks registered funds and other
  disclosing holders put on private companies, from N-PORT, N-CSR and
  fund holdings pages, beside the round structure behind headline
  valuations (Delaware certificates) and SPV premiums over consensus
  marks (Form D and public unit quotes).
- Source rule: every input is a public filing, a document bought from a
  public registry, or a price on a page served without a login. Nothing
  from a DM, a leaked letter, a login or a vendor paywall; Forge,
  Caplight and Hiive are excluded.
- A filer's mark is never adjusted, interpolated or smoothed; a missing
  filing is a missing row. Every derived number can be recomputed from
  the rows.
- Versioned methodology: `METHODOLOGY.md` is the public spec, every
  payload carries its versions, and a correction is a new version with
  a diff. The ~60-day N-PORT lag is stated on every page.
- No venue, no quote, no opinions: `CONTRACTS.md` specifies contracts
  that settle on the index; OpenMarket quotes none of them.
- Users: analytical people who need a reference for private-company
  value (funds, administrators, lenders, venues, journalists). See
  `PRODUCT.md` for voice and `DESIGN.md` for the visual system.
- Surfaces: `/` the daily page (every watchlist name's headline
  consensus, dispersion, families, latest filing and last print, and the
  names without a consensus with the reason); `/n/[slug]` one name (each
  security's consensus and dispersion over time, every family mark linked
  to its filing, the marks outside the series as filed, prints, structure,
  the SPV vehicles from Form D); `/methodology`; `/corrections`;
  `/rulebook` (and `/rulebook/changelog`); `/ref` (the API docs);
  `/resolution-sources`. The API is `/api/ref/*` and the CSVs are under
  `/data/` (CC BY 4.0). v1's paths (`/m`, `/t`, `/portfolio`, `/admin`,
  `/for-policy`) redirect to `/`. How it is built: `TECHNICAL_DESIGN.md`.

## 2. Decisions

Each decision carries its status against the current code. D1–D14 are
v1's and are kept, unchanged, in `docs/archive/v1/README-decisions.md`;
D13 is kept here, extended in v2.

### D15. v2: a published marks index, not a venue — Adopted

OpenMarket stops being a venue and becomes a published index of
private-company marks built only from public filings, under Nick's own
name (decision `0003`). The unit is one per-share mark on one security,
from one filer, as of one date, with its source document; consensus,
dispersion, mark versus print, revisions, SPV premium and structure gap
are derived from those rows under a versioned methodology. No contract
is quoted, listed or settled by OpenMarket; `CONTRACTS.md` specifies
contracts others may list against the index. D1, D9–D12 and D14 are
superseded as product decisions; D13 is kept and extended with the
mark-side source classes. v1 lives at the tags `archive/dealer-v1` and
`archive/tournament-v1`. The build: `docs/prompts/v2/README.md`.

### D13. Rulebook and settlement — Kept, extended in v2

A print is the post-money of a priced primary round (IPO first-day
close for the labs). Source ranks 1–4, 7-day revision window, void on
no print. The rulebook is code (`src/lib/engine/rulebook.ts`),
versioned, exported at `/api/ref/rulebook`, with
`data/round-history/events.csv` as its fixture. OpenMarket publishes the
hierarchy, it does not own it. Rules as data: `CONTRACTS.md` →
Definitions. v2 extends it with the mark-side source classes (N-PORT,
N-CSR, fund holdings pages, SPV Form D) and their ranks
(`docs/prompts/v2/p6-rulebook-and-contracts.md`).

Both instruments allow a day after their deadline for an announcement
dated on or before it to be observed: the binary resolves NO, and the
forward voids, one day after T.

Current code: `src/lib/engine/rulebook.ts` (2.0.0,
`docs/RULEBOOK_CHANGELOG.md`) keeps v1's print rules (what a print is, the
announcement rule, ranks 1–4, the seven-day revision window, the one-day
grace) and adds the mark side: nine source classes ranked within five
purposes (`SOURCE_CLASSES`, `sourceRank(class, purpose?)`, the rank ingest
stores on `source_documents.source_rank`), and the rules the contracts in
`CONTRACTS.md` share (observation date, listing floor, repricing void, void
on no filing). Its `NOT_BUILT` names what no route serves yet: the index as
published on a past date, and series under an earlier methodology version.
`GET /api/ref/rulebook` publishes it under the v2 envelope through
`withRefRoute`; `/rulebook` renders it. `tests/fixtures/rulebook-events.json`
records how it resolves every row of `data/round-history/events.csv`.
Nothing settles at OpenMarket.

## 3. Non-goals

A venue, a quote, a model mid or a forecast; trading of any kind, paper
or real; accounts and sign-in for readers; any input that breaks the
source rule; adjusting, filling or smoothing a filer's mark.

## 4. Running it

Requirements: Node 22 (CI and Vercel pin 22; newer local versions work
but are not the deployment target), PostgreSQL 17.

```
npm ci
npm run check            # typecheck, biome, style audit, layer audit
npm run test:unit        # engine, parsers, services, routes, pages' helpers
DATABASE_URL_TEST=postgresql://... npm run test:integration
DATABASE_URL_TEST=postgresql://... npx playwright test   # seeds the test database first
npm run build
npm run dev              # http://localhost:3000, never 127.0.0.1
```

Environment (`.env.example` is the contract; the npm scripts load
`.env.local` when it exists, and exported variables take precedence):

- `DATABASE_URL` (pooled, the routes and pages) and
  `DATABASE_URL_UNPOOLED` (migrations, the `index:*` scripts, key minting).
  `npm run db:migrate` runs the migrations in order; `001`–`019` are v1's
  and stay, `020`–`023` are the index's.
- `SEC_USER_AGENT`: a name and a contact (an email or an https URL) sent
  with every EDGAR request; the SEC client (`src/lib/ingest/fetch/sec.ts`)
  refuses to run without it and keeps one request start per 150 ms,
  backing off on 429 and 5xx. Agents use
  `OpenMarket-Index/0.1 (+https://openmarket.systems)`; never a personal
  email in code or config.
- `CRON_SECRET` (at least 16 characters) for `/api/cron/*`; `APP_ORIGIN`.
- `DATABASE_URL_TEST`: a disposable database for the integration and
  browser suites.

Filling the index, in order (each EDGAR script takes `--cache=<dir>` for
development reruns):

```
npm run index:watchlist                     # data/index/watchlist.json → issuers
npm run index:search                        # filings-by-name.csv, filer-counts.md, filing-counts.json
npm run index:families                      # drafts filer-families.json from N-CEN (review it)
npm run index:ingest -- --source=nport      # N-PORT holdings → filer_marks [--since= --issuer= --refetch]
npm run index:ingest -- --source=form_d     # Form D → spv_vehicles, the issuer's own offerings
npm run index:prints                        # data/round-history/events.csv → prints
npm run index:certificates                  # data/index/certificates/ (none transcribed yet)
npm run index:spv-quotes                    # data/index/spv-quotes/ (none captured)
npm run index:relabel [-- --dry-run]        # re-read labels; differences as one parser correction
npm run export:ref-examples                 # /ref's example payloads from the database
```

`npm run index:search -- --recount` rewrites the counts files from the CSV
without searching (after the watchlist or the families file changes).

- Vercel Cron: `vercel.json` runs `GET /api/cron/ingest` daily at 07:23
  UTC: N-PORT incrementally from a week before its last ok `ingest_runs`
  row, stopping before the 300 s limit. Form D, prints, certificates and
  quotes run by hand.
- Reference API: the public quota is 60 requests a minute per network,
  or a key's own with `Authorization: Bearer <key>`; malformed queries are
  refused before the quota is drawn. `npm run api-key:create --
  --name=<desk> [--quota=600] [--tier=design_partner]` prints a key once
  and stores its SHA-256; a `design_partner` key expires after 365 days.
  In production, network buckets read Vercel's `x-vercel-forwarded-for`
  with `VERCEL=1`; local development shares one unlimited loopback caller.
- Downloads: `/data/filer-marks.csv` (and `?issuer=<slug>`),
  `/data/certificate-terms.csv`, `/data/spv-matches.csv` (and
  `?issuer=`), streamed (Vercel's 4.5 MB cap applies to buffered bodies;
  `TECHNICAL_DESIGN.md` §7).
- Data exports: `npm run export:round-history` writes
  `public/data/round-history.*`; `npm run export:resolution-sources`
  regenerates `docs/tradeables/resolution-sources.md`; both take
  `-- --check`.

## 5. CI and deployment

CI (`.github/workflows/ci.yml`, PostgreSQL 17 service) runs typecheck,
lint and audits, unit tests, integration tests, `next build`, and the
Playwright smoke spec on desktop and mobile Chromium (against `next
dev`, after `tests/browser/seed.ts` fills the test database from real
filings through the import services). The Playwright run has an 18-minute global timeout, and the
report and traces are uploaded on every run. CI caches Chromium by the
installed `@playwright/test` version.

Deployment is Vercel plus Neon; a merge to `master` deploys to
production. `scripts/vercel-build.ts` validates the environment for the
target, migrates, then runs `next build`, so a failed build leaves the
database already migrated. `.env.example` is the environment contract.

## 6. Drift register

Only rows that are still open or still explain a live difference
between the docs and the code. Closed rows are removed;
`git log -p README.md` keeps them, and v1's are in its tree.

| Claim | Status | Evidence |
| --- | --- | --- |
| The index covers N-CSR, fund holdings pages and closed-end NAVs (decision 0003 §2) | Not built | N-CSR is listed by `index:search`, not parsed; Fidelity, ARK Venture and DXYZ fail the source rule or give no per-holding value (`data/index/sources-status.md`). |
| Mark versus print, structure and the common-equivalent are published | Code built, no data | No certificate is transcribed (`data/index/certificates/`), so every value is empty with its reason. |
| The SPV premium is published (decision 0003 §2) | Not built | No public page quotes SPV units without a login (`sources-status.md`, checked 2026-11-05); the panel shows Form D vehicles only. |
| Every security's mark enters a series | By design, large | 6,297 of 15,293 live marks are `Unclassified` (development data, 2026-11-05) (titles naming the issuer only, e.g. `EPIC GAMES INC PP`); name pages publish them as filed, outside the series. |
| The daily cron runs every source | Partly | N-PORT only; Form D, prints, certificates and quotes run by hand. |
| `events.csv` has 56 priced rounds | Partly | 59 `priced_round` rows; 56 fall in Jan 2024–Oct 2026, three are earlier (Anduril Dec 2022, Anthropic May 2023, Modal Oct 2023). |
| A contract can settle on the index as published on its observation date | Not built | Rulebook `NOT_BUILT`: no past-date route; values are recomputed from the rows. |

## 7. Open for Nick

- Methodology sign-off: `METHODOLOGY.md` is 0.1.0, a draft; 1.0.0 is the
  version in force at the first post.
- Hiive-named vehicles found through Form D (`Hiive Anthropic Series …`):
  the index reads only their SEC filings, never the platform. Whether
  listing them is within the source rule (decision 0003 §4) is a call.
- SpaceX is treated as listed from 2026-06-12, its final prospectus
  (424B4, 0001628280-26-042639): marks as of that date or later enter no
  series, and its headline is 2026Q2's.
- `CONTRACTS.md` leaves open whether OpenMarket's operator is a restricted
  person for every contract on the index.
- Unclassified issuer-only titles: whether a title naming only the issuer
  (`ANTHROPIC PBC`, `EPIC GAMES INC PP`) may ever be read as a series, and
  on what evidence; today they enter no series.
- The corrections reporting address (`/corrections` says it is not yet
  published), and the filer-families file's review (version 0.1.0).
