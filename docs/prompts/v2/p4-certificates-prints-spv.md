# P4 — Certificates, prints, SPVs

Read `docs/prompts/v2/README.md`, decision `0003`, `METHODOLOGY.md` and
`src/lib/engine/index/` (P3), and the ingest layer P2 built
(`src/lib/ingest`, `services/index/ingest-nport.ts`, migration `020`).

## Certificates

Delaware certificates are bought per document and read by Nick (or a
model, reviewed by Nick). The engineering is the format and the import.

- `data/index/certificates/README.md`: the JSON shape, one file per
  certificate at `data/index/certificates/<slug>/<filed_on>.json`:
  issuer slug, filed_on, file number, kind (restated | amendment), where
  it was bought and when, the PDF's SHA-256 (the PDF is not committed),
  entered_by, and one entry per series (label, original issue price,
  liquidation multiple, participating, cap, seniority, shares authorized,
  conversion price, ratchet text if any) plus common shares authorized.
  A zod schema in `src/lib/ingest/parse/certificate.ts` is the spec.
- `npm run index:certificates` validates every file and imports it
  (`source_documents` of class `delaware_coi`, `certificates`,
  `certificate_series`); a changed file for an imported certificate is a
  correction (new rows, old ones superseded, a `corrections` row), never
  an update in place.
- Do not invent a certificate. Commit no certificate file unless it
  transcribes a real document you have; the README and a test fixture
  shaped like the schema (clearly marked as a schema fixture with
  invented, obviously-synthetic issuer `example-co`, never a watchlist
  name) are enough.

## Prints

- `npm run index:prints` imports `data/round-history/events.csv`'s
  `priced_round` and `ipo` rows for watchlist issuers into `prints`
  (`origin = 'events.csv'`, the source URL from the round-history
  dataset). Idempotent.
- When a certificate is imported, the print it prices (match on issuer
  and the newest series' issue date window; record the match rule) gets
  `series_label` and `price_per_share_usd` from it.

## SPVs

- Form D: `src/lib/ingest/parse/form-d.ts` parses a Form D
  `primary_doc.xml` (issuer name, CIK, jurisdiction, entity type,
  related persons, offering amounts, minimum investment, sales
  commissions and finders' fees, date of first sale, industry and
  fund type). Real trimmed fixture.
- `services/index/ingest-form-d.ts` finds Form D filings by full-text
  search on each watchlist phrase, keeps those whose issuer looks like a
  vehicle (pooled investment fund, or a name with "SPV", "Series",
  "Fund", "Holdings", "Opportunity", "Co-Invest", a series LLC), and
  matches the underlying by alias in the vehicle name (`match_method =
  'alias'`) — record the matching text in `match_note`. Unmatched
  vehicles are stored as `unmatched`, never guessed. Also records the
  issuer's own Form D (not an SPV) for `incorporation_state` and for
  round size and date as `prints` evidence where a round has no other
  rank-1/2 source. `npm run index:ingest -- --source=form_d`. Run it for
  real; commit nothing but code and your report.
- Unit quotes: check whether any SPV platform publishes per-unit asking
  prices on pages served without a login and not disallowed by
  robots.txt. Write what you found in `data/index/sources-status.md`.
  Build `data/index/spv-quotes/README.md` (one JSON per capture: URL,
  captured_at, page SHA-256, platform, quoted price per share or implied
  valuation, fee terms, layers) and `npm run index:spv-quotes` to import
  them. No scraper, no file for a quote you did not capture from a real
  page.

## Read services (for P5)

`services/index/get-name-index.ts`: everything one name page needs,
computed with P3's engine from the tables: per label the quarterly
consensus and dispersion series, family marks with their documents,
revisions, the last print, the certificate structure table and the
common-equivalent result, the SPV vehicles and quotes with premiums.
`services/index/list-names.ts`: the daily page's rows. Integration tests
with rows inserted through the import services (no hand-written SQL
fixtures of filings: use a real parsed fixture document).

## Done when

The gates pass; the importers are idempotent; the read services return
the shapes P5 will serve; your report lists what the real Form D run
found per issuer and the unit-quote finding.
