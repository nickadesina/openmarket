# P2 — Schema, SEC client, EDGAR search, N-PORT ingest, fund pages, cron

Read `docs/prompts/v2/README.md` (the schema and layers there are the
contract) and decision `0003`. P1 has removed v1; you start from a small
green tree. `scripts/research/edgar-nport-marks.ts` is a working
prototype of the N-PORT pull: promote its logic, don't rewrite it blind.

## Build

1. **Migration `020_marks_index`** exactly as the v2 brief's data model
   (add check constraints for the enums, the indexes the read paths need:
   `filer_marks (issuer_id, security_label, as_of)`,
   `source_documents (source_class, filed_on)`). Update
   `src/lib/db/schema.ts`. Integration test: migrates, constraints hold.
2. **Watchlist sync.** `data/index/watchlist.json` (written in Part 0:
   20 names plus `candidates`) → `issuers` via
   `npm run index:watchlist`. Validate it with zod; verify each name's
   `search_phrases` and `match_pattern` against real full-text search
   hits and fix false positives/negatives (e.g. "Stripe" in unrelated
   holdings, Rippling's legal name People Center, Harvey's Counsel AI).
   Record `incorporation_state` only from a filing (Form D
   `jurisdictionOfInc`), with the source document; otherwise null.
3. **Layers.** `src/lib/ingest/fetch/sec.ts` (the polite SEC client;
   refuses without `SEC_USER_AGENT`), `src/lib/ingest/parse/nport.ts`
   (from the prototype: registrant, CIK, series, period, each holding),
   `src/lib/ingest/parse/efts.ts` (full-text search responses, paging,
   the 10,000-hit ceiling by narrowing date ranges). Add the `ingest`
   rules to `scripts/audit-deps.ts` and its test.
4. **Week-1 output.** `npm run index:search` writes
   `data/index/filings-by-name.csv` (issuer, form, filer, CIK, family,
   filed, period, accession, URL; fixed order; idempotent) and
   `data/index/filer-counts.md` (per issuer: filings, distinct
   registrants, distinct families; the densest five first; the fetch
   time). Run it for real and commit both outputs.
5. **Filer families.** `data/index/filer-families.json`: map every
   registrant CIK the search found to a family (Fidelity's trusts →
   "Fidelity (FMR)", T. Rowe Price's → "T. Rowe Price", and so on), with
   the evidence (the adviser named in the filing, or the trust name).
   Unmapped CIKs default to themselves. P3's engine reads this shape:
   `{ version, families: [{ slug, name, ciks: string[], evidence }] }`.
6. **N-PORT ingest.** `services/index/ingest-nport.ts`: for each hit,
   fetch the primary document, store `source_documents` (rank from the
   rulebook's source class if P6 has landed, else the brief's order),
   parse holdings matching the issuer's pattern, write `filer_marks`
   with `security_label`/`security_kind` from P3's
   `engine/index/series.ts` if it exists, else a local parser you then
   reconcile. Idempotent. Record `ingest_runs`.
   `npm run index:ingest -- --source=nport [--since=YYYY-MM-DD] [--issuer=slug]`.
   Run it for real against the local dev database and report counts per
   issuer.
7. **N-CSR.** Full-text search lists them (step 4). Parsing the HTML
   schedule of investments is optional here: if you can parse the
   watchlist rows of a real N-CSR reliably (value, shares, title,
   acquisition date, cost), ingest them as `ncsr`; otherwise list the
   filings only and say so in your report.
8. **Fund pages.** Fidelity monthly holdings (Contrafund, Blue Chip
   Growth, Growth Company), ARK Venture Fund holdings, Destiny Tech100
   (DXYZ) NAV and holdings. For each, check from the container whether
   the page or file serves without a login and is not disallowed by
   robots.txt. If yes, a parser with a real trimmed fixture and an ingest
   source (`fund_holdings_page` / `closed_end_nav`). If no, write down
   exactly what you found in `data/index/sources-status.md` and move on.
9. **Cron.** `GET /api/cron/ingest` (CRON_SECRET bearer as v1's
   `src/lib/auth/cron.ts`), daily in `vercel.json`, incremental since
   the last ok `ingest_runs` for each source, 300 s limit, stops cleanly
   before it. Route test.

## Tests

Parsers against real trimmed fixtures under `tests/fixtures/index/`
(one N-PORT with a watchlist holding, one search response page). Ingest
idempotence and supersession in integration tests (no network: inject
the fetcher). No test calls EDGAR.

## Done when

The gates pass; `filings-by-name.csv`, `filer-counts.md`,
`filer-families.json` and `sources-status.md` are committed from real
runs; your final report gives the counts per issuer and the densest five
names, and lists every source you could not reach.
