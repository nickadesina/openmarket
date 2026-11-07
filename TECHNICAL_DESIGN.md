# Technical design: the marks index (v2)

How the index is built, from the code as it stands on 2026-11-05. The
product is decision `0003`; the build contract is
`docs/prompts/v2/README.md`; the arithmetic's public spec is
`METHODOLOGY.md`; the settlement rules are `src/lib/engine/rulebook.ts`
(published at `/rulebook`). Where this file and the code disagree, the code
is right and this file is a defect. Section 11 lists what is not built.
v1's technical design (the dealer) is `docs/archive/v1/TECHNICAL_DESIGN.md`.

## 1. Shape

One per-share mark on one security, from one filer, as of one date, with
its source document, is a `filer_marks` row. Everything published is a pure
function of those rows, the other tables and the checked-in files under
`data/index/`, recomputed on every read under the versions the payload
names. Nothing derived is stored.

```
EDGAR (full-text search, N-PORT XML, Form D XML)     data/index/*.json, data/round-history/*.csv
        │ ingest/fetch (the only network code)                 │
        ▼ ingest/parse (pure parsers)                          ▼
   services/index/ingest-*, import-*  ──────►  PostgreSQL (migrations 020–023)
                                                     │
                       services/index/get-name-index, list-names, ref-*, data-csv
                         (engine/index: labels, families, consensus, dispersion,
                          revisions, mark vs print, SPV premium, waterfall)
                                                     │
              ┌──────────────────────────────────────┼──────────────────────────┐
     /api/ref/* (withRefRoute)           /data/*.csv (withCsvRoute)      pages (server components)
```

## 2. Layers

| Path | What | May import |
| --- | --- | --- |
| `src/lib/engine/index/` | Pure arithmetic: `series.ts` (labels), `mark.ts` (per-share), `families.ts`, `consensus.ts`, `listing.ts` (listed names, headline), `print.ts` (mark versus print), `revisions.ts`, `spv.ts`, `waterfall.ts` (`CE_VERSION`), `methodology.ts` (`METHODOLOGY_VERSION`, every constant) | engine only |
| `src/lib/engine/rulebook.ts` | Rulebook 2.0.0: prints, source classes and ranks by purpose, the contract rules | engine only |
| `src/lib/ingest/parse/` | `nport.ts`, `efts.ts`, `form-d.ts`, `ncen.ts`, `submissions.ts`, `watchlist.ts`, `families.ts`, `certificate.ts`, `spv-quote.ts`, `xml.ts` | engine, ingest/parse, zod |
| `src/lib/ingest/fetch/` | `sec.ts` (the SEC client), `efts.ts` (full-text search paging), `disk-cache.ts` | ingest, node builtins |
| `src/lib/services/index/` | One file per operation (section 4–6) | engine, ingest, db, api |
| `src/app/api/ref/*`, `src/app/data/*` | Thin routes | services |
| `src/app/**/page.tsx` | Server components; read services directly (the audit allows `app` anything) | anything |
| `src/components/*` | UI; services as types only | services as types |

`scripts/audit-deps.ts` enforces the table; `scripts/audit-styles.ts` the
type ramp, the 4px grid and the colour tokens.

## 3. Data model

Migration `020_marks_index` holds the v2 tables: `issuers`,
`source_documents`, `filer_marks`, `prints`, `certificates`,
`certificate_series`, `spv_vehicles`, `spv_quotes`, `corrections`,
`ingest_runs` (columns in `docs/prompts/v2/README.md`). `021` makes a
holding unique once as filed and once per correction; `022` lets a
certificate be corrected like a mark (`superseded_by`,
`transcription_sha256`) and adds an issuer's listing (`listed_on`,
`listing_url`); `023` adds a certificate's newest series, common shares
authorized and the terms the conversion does not model. Triggers keep
`source_documents` and `corrections` append-only and let a filer mark
change only by being superseded once. Money is `numeric` USD; dates of
record are `date` (read as `YYYY-MM-DD` strings, `db/client.ts`).
Migrations `001`–`019` are v1's and stay; v2 reads only `api_keys`,
`api_key_usage` and `rate_limits` of v1's tables.

## 4. Ingest

Run in this order (README §4 has the commands):

1. `index:watchlist` syncs `data/index/watchlist.json` (20 names, 7
   candidates; search phrases, a match pattern, the listing, Form D
   phrases) into `issuers`.
2. `index:search` runs EDGAR full-text search for every phrase over
   NPORT-P, N-CSR and N-CSRS and writes `filings-by-name.csv`,
   `filer-counts.md` and `filing-counts.json` (the counts as data, which
   the pages read; `--recount` rewrites the two counts files from the CSV
   without searching).
3. `index:families` drafts `filer-families.json` from each registrant's
   latest N-CEN adviser; Nick reviews it (version 0.1.0 today).
4. `index:ingest -- --source=nport` fetches each N-PORT primary document
   the search found, stores it once (`(document_url, content_sha256)`),
   and writes each holding matching an issuer's pattern as a `filer_marks`
   row as filed: balance, units, value, `value / balance` when the units
   are shares, the label from `classifySecurity`, and the rulebook's rank.
   An amendment supersedes its fund's earlier report for the period.
5. `index:ingest -- --source=form_d` reads Form Ds whose vehicle name
   matches an issuer's vehicle pattern into `spv_vehicles` (or
   `unmatched`); an issuer's own Form D sets `incorporation_state` and is a
   print-side date and size.
6. `index:prints` imports `data/round-history/events.csv` priced rounds
   into `prints`.
7. `index:certificates` validates and imports
   `data/index/certificates/<slug>/<filed_on>.json` and links each to the
   round it prices; a changed transcription is a correction.
8. `index:spv-quotes` imports `data/index/spv-quotes/` captures.
9. `index:relabel` re-reads every live label with the classifier and
   publishes the differences as one `parser` correction.

The SEC client sends `SEC_USER_AGENT` on every request and keeps one start
per 150 ms with backoff on 429 and 5xx. `GET /api/cron/ingest` (Vercel
Cron, 07:23 UTC, `CRON_SECRET`) runs N-PORT incrementally from a week
before the last ok `ingest_runs` row, stopping 45 s before the 300 s limit.

Real data in the development database on 2026-11-05: 5,003 N-PORT
documents and 813 Form Ds; 15,293 live marks on 13 names; 7 names with
none (section 6).

## 5. The arithmetic

`engine/index/` implements `METHODOLOGY.md` 0.1.0 and nothing else
(`tests/engine/index/methodology.test.ts` holds the constants table to the
code). Labels: preferred series and `Common` enter per-share series;
`SPV interest`, `Warrant`, `SAFE`, `Convertible Note` and `Unclassified`
are published but compared with nothing. A family's mark is the median of
its funds' marks on a label and date (`intra_family_split` above 0.1 %);
the consensus is the median of each family's latest mark in a calendar
quarter; dispersion is `(max − min) / median` from two families. Marks as
of a listed name's prospectus date or later enter no series. The headline
label is the one with the most families in the latest quarter with a
consensus. `resolveFamily` indexes a families object's CIKs once (a
`WeakMap`), so a name with thousands of marks resolves in linear time.

## 6. Read services

- `getNameIndex(db, slug)` (`get-name-index.ts`): the issuer; live marks
  split by `seriesStatus` into the series' inputs and `marks_summary`;
  per label the consensus by quarter (with dispersion, the families used
  and mark versus print), each family mark with its documents, and
  revisions; prints; the live certificate's structure with
  `commonEquivalent` and `structureGap` (or `unsupported` / `no_headline`
  with the reason); SPV vehicles (latest Form D per vehicle CIK) and quotes
  with premiums; `coverage` and `no_marks` (`name-coverage.ts`); and
  `out_of_series`, the live marks outside every series grouped by status
  and label with the rule's sentence and the newest twelve as filed. The
  independent reads run concurrently.
- `name-coverage.ts` imports `data/index/filing-counts.json` (bundled, as
  `published-families.ts` bundles the families file) and states why a name
  has no live mark from those counts: named in no N-PORT, N-CSR or N-CSRS
  (Cognition, Modal, Safe Superintelligence, Thinking Machines Lab); named
  only in N-CSR text, which is not parsed (Scale AI, Anysphere); or named
  in N-PORT filings that were read with no matching holding (Rippling:
  Powerlaw Corp.'s 0002052053-26-000004), else not yet ingested.
- `listNames(db)` computes every watchlisted name's index concurrently and
  keeps the daily page's row of each (about 0.4 s warm on the development
  data; was 1.1 s sequential with the linear family scan).
- The routes' services (`ref-*.ts`) wrap these under the envelope;
  `data-csv.ts` streams the CSV tables in keyset batches.

## 7. API and downloads

Every `/api/ref/*` payload opens with `methodology_version`, `ce_version`,
`rulebook_version`, `as_of`, `lag_note` (`ref-envelope.ts`). Routes:
`names`, `{slug}`, `{slug}/marks` (keyset, `include=superseded`,
`label=`), `{slug}/revisions`, `{slug}/spv`, `methodology`
(`include=families`), `corrections`, `rulebook`. `withRefRoute`
(`api/ref-route.ts`) validates the query's names and values (and the slug)
before it draws one unit of the `ref` quota (60 a minute per network, or a
key's own), caches anonymous responses 60 s and keeps keyed ones private.
`/ref` documents every route with an example payload generated from the
development database (`npm run export:ref-examples` writes
`docs/tradeables/ref-examples.json`).

Downloads (`withCsvRoute`, CC BY 4.0, `Link: …/data/LICENSE`):
`/data/filer-marks.csv`, `/data/certificate-terms.csv`,
`/data/spv-matches.csv`; `issuer=<slug>` limits filer marks and SPV
matches to one name, the file each name page links. Every row carries its
accession and document URL.

**Response size.** Vercel caps a function's buffered response body at
4.5 MB (`FUNCTION_PAYLOAD_TOO_LARGE`); its guide to that limit names
streaming as the way past it ("streaming functions, which don't have this
limit", vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions,
read 2026-11-05). The CSV routes stream a `ReadableStream` one database
batch at a time and never hold the file, so the full file (8.1 MB live,
12.7 MB with superseded rows on the development data) is served as a
stream; the per-name files (the largest, SpaceX with superseded rows, is
4.9 MB) are the same stream filtered. If a deployment ever shows a 413 on
the full file, the per-name files are the fallback and the pages already
link them. Pages and JSON payloads are buffered: the largest name page
(Databricks) is 3.1 MB of HTML, 0.24 MB gzipped.

## 8. Pages

Server components under `src/app`; pages that read the database are
`force-dynamic` and call the services directly (`getRuntimeDatabase()`), so
a page and its API payload come from the same function. Static pages read
repository files at build.

- `/`: every watchlist name with a consensus (headline label and quarter,
  consensus, dispersion, families, latest filing, last print), highest
  dispersion first, each figure linking the name page's quarter; then the
  names without one with the reason (`no_marks`, or "no per-share series"
  when every live mark is outside the series, as for a name whose holdings
  are all Unclassified). The lag and the versions are stated.
- `/n/[slug]`: the headline figures (each linking its quarter or its
  filing); the listing note for a listed name; per label a plain-SVG chart
  (`components/index/mark-chart.tsx`: every family mark a dot linking its
  first filing, the consensus line at quarter ends, the quarter's range,
  the last print as a dashed line at its date and, with a certificate
  price, at its per-share price; log scale when the range is threefold),
  the consensus by quarter, every family mark of the latest four quarters
  with its filing (earlier quarters fold), and revisions; the marks outside
  the series as filed; prints; structure; the SPV panel (Form D vehicles,
  and why no unit quote is published); the per-name CSVs and JSON. Open
  Graph and Twitter text: the name, the dispersion and families, the label
  and quarter, the latest filing date (`components/index/share-text.ts`).
- `/methodology`: `METHODOLOGY.md` through the document component, its
  Constants table rebuilt from `METHODOLOGY`
  (`tradeables/methodology-doc.ts`).
- `/corrections`: the policy and every `corrections` row, newest first,
  with its diff.
- `/rulebook`, `/rulebook/changelog`, `/resolution-sources`, `/ref`: kept.
  Nav: Index, Methodology, Rulebook, API, Corrections; resolution sources
  from the footer. v1's paths redirect to `/`.

## 9. Tests

`npm run test:unit` (engine, parsers, services, routes, pages' helpers);
`npm run test:integration` (PostgreSQL, one schema per suite, rows written
by the import services from real EDGAR fixtures in
`tests/fixtures/index/`); the browser smoke specs (`tests/browser/`),
whose global setup runs `tests/browser/seed.ts` against
`DATABASE_URL_TEST`: the real watchlist, three real N-PORT filings, the
round history and two Form Ds, through the same services.

## 10. Deployment

Vercel and Neon; `scripts/vercel-build.ts` validates the environment,
migrates and builds. `.env.example` is the contract: `DATABASE_URL`
(pooled), `DATABASE_URL_UNPOOLED`, `CRON_SECRET`, `APP_ORIGIN`,
`SEC_USER_AGENT`. The ingest scripts run from an operator's machine
against the database; only N-PORT runs in the cron.

## 11. Not built

- N-CSR and N-CSRS schedules: listed by the search, not parsed
  (`data/index/sources-status.md`).
- Fund holdings pages (Fidelity: a client-side app; ARK Venture: a
  JavaScript challenge) and DXYZ (no per-holding value): not built.
- SPV unit quotes: no public page quotes units without a login; the SPV
  premium is never computed on real data.
- Certificates: none transcribed, so no structure table, no per-share
  print, no mark versus print and no common-equivalent on any name.
- Form D, prints, certificates and quotes are not in the daily cron.
- A route serving the index as published on a past date, and series under
  an earlier `methodology_version` (rulebook `NOT_BUILT`).
- Page caching: every page view recomputes from the rows (the API is
  cached 60 s at the edge; the pages are not).
