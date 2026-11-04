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
- Surfaces now: `/` is a holding page until the daily index page lands;
  `/rulebook` (and `/rulebook/changelog`), `/resolution-sources` and
  `/ref` (the API docs) are published, with `GET /api/ref/rulebook`.
  v1's paths (`/m`, `/t`, `/portfolio`, `/admin`, `/for-policy`)
  redirect to `/`.

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

Current code: `src/lib/engine/rulebook.ts` (v1.0.0, its rules unchanged
from v1) states the rules as data and resolves a binary or a forward
from the events it is given, including the binary's expiry with the
21-day floor (decision 0002), an acquisition (settles at a disclosed
equity value, voids at once on an undisclosed one) and a higher-ranked
revision dated past expiry. `GET /api/ref/rulebook` publishes it with
`rulebook_version` and `as_of` through `withRefRoute`
(`src/lib/api/ref-route.ts`: 60 s anonymous cache, keyed responses
private, one unit of the `ref` quota). `tests/fixtures/rulebook-events.json`
records how it resolves every row of `data/round-history/events.csv`
(each row entering as rank 1, since the file carries no source rank)
under the contract terms v1 listed with. Nothing settles in v2: the
settle job that read the rulebook is archived with the dealer.

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
npm run test:unit        # engine, services, routes, pages
DATABASE_URL_TEST=postgresql://... npm run test:integration
DATABASE_URL_TEST=postgresql://... npx playwright test
npm run dev              # http://localhost:3000, never 127.0.0.1
```

- `.env.local` needs `DATABASE_URL` and `DATABASE_URL_UNPOOLED`. The npm
  scripts load `.env.local` when it exists; exported variables take
  precedence. `npm run db:migrate` runs the migrations in order to
  latest; `001`–`019` are v1's and stay (production has run them, and
  `008` and `013` delete v1 data). v1's tables stay in the database; v2
  code reads only `api_keys`, `api_key_usage` and `rate_limits`.
- Integration tests create isolated schemas and explicitly scope their
  migration tables, so concurrent suites do not share migration state.
- Reference API: the public quota is 60 requests a minute per network,
  or a key's own with `Authorization: Bearer <key>` (migration
  `010_api_keys`); an unknown or revoked key is refused (401
  `API_KEY_INVALID`). `npm run api-key:create -- --name=<desk>
  [--quota=600] [--tier=design_partner]` prints a key once and stores
  its SHA-256; a `design_partner` key (migration `018_api_key_tiers`)
  expires 365 days after creation and is then refused with 401
  `API_KEY_EXPIRED`. `api_key_usage` counts each key's served requests
  per UTC day. In production, network buckets read Vercel's trusted
  `x-vercel-forwarded-for` header with `VERCEL=1`; local development
  shares one unlimited loopback caller. Limits return HTTP 429 with
  `Retry-After`.
- EDGAR: `SEC_USER_AGENT` (a name and a contact) is required by every
  EDGAR request (`scripts/research/edgar-nport-marks.ts` today).
- Data exports: `npm run export:round-history` writes
  `public/data/round-history.*` from `data/round-history/events.csv`
  and `sources.csv`; `npm run export:resolution-sources` regenerates
  `docs/tradeables/resolution-sources.md`; `npm run export:objections`
  writes the anonymised objection catalog. The first two take
  `-- --check` (exit 1 when the committed file is stale).
- Vercel Cron: `vercel.json` has no schedules until ingest lands
  (P2). Cron routes require `Authorization: Bearer $CRON_SECRET` (at
  least 16 characters; production build validation requires it).

## 5. CI and deployment

CI (`.github/workflows/ci.yml`, PostgreSQL 17 service) runs typecheck,
lint and audits, unit tests, integration tests, `next build`, and the
Playwright smoke spec on desktop and mobile Chromium (against `next
dev`). The Playwright run has an 18-minute global timeout, and the
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
| `events.csv` has 56 priced rounds | Partly | 59 `priced_round` rows; 56 fall in Jan 2024–Oct 2026, three are earlier (Anduril Dec 2022, Anthropic May 2023, Modal Oct 2023). |
| The rulebook's not-built rules | Moot in v2 | `NOT_BUILT` (charter re-centring, the rank 3–4 review queue, the correcting settlement) names v1 dealer code that is archived; P6 rewrites the rulebook for the mark side. |
| `/ref` documents the index | Not built | `/ref` documents `/api/ref/rulebook` only; the index's routes and the v2 envelope are P5's. |
