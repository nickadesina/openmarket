# v2 build: the marks index

Date: 2026-11-04. Status: brief for agents. Owner: Nick.
Decision: `docs/decisions/0003-v2-marks-index.md` (read it first).

OpenMarket stops being a venue and becomes a published index of
private-company marks built only from public filings. This brief is the
shared contract for every part of the build: the layers, the schema, the
versions, the routes and the rules. Each part has its own file here with
its scope and its "done when". Where a part's brief and this file
disagree, this file wins; where this file and the code disagree after a
part lands, the code's author fixes whichever is wrong in the same commit.

## Rules for every agent

Read `AGENTS.md`, this file, decision `0003`, and your part's brief.
`DESIGN.md` and `PRODUCT.md` before touching a screen.

- **Source rule (decision 0003 §4).** Every input is a public filing, a
  document bought from a public registry, or a price on a page served
  without a login. Never fetch behind a login, a paywall or a robots
  disallow; never touch Forge, Caplight, Hiive, EquityZen or any vendor
  indicator. A source you cannot reach from the container is reported as
  not built, never imitated.
- **Real data only (AGENTS.md).** Test fixtures are real documents fetched
  from the source (trimmed is fine; say so in the fixture's README line),
  never hand-typed imitations. No invented rows, counts or copy. If a
  number cannot be computed from rows, the page says so.
- **Never adjust a filer's mark.** No interpolation, smoothing, carry
  forward or fill. A missing filing is a missing row.
- **SEC fair access.** Every EDGAR request sends `SEC_USER_AGENT` (a name
  and a contact: an email, or an https URL; code refuses to run without
  one; agents use `OpenMarket-Index/0.1 (+https://openmarket.systems)`) and stays under
  ten requests a second (`politeFetcher`, ≥150 ms gap, backoff on 429/5xx).
  Never put Nick's personal email in code or config; the operator sets
  the variable.
- **Versions on everything published.** `methodology_version`,
  `ce_version` (the common-equivalent conversion), `rulebook_version` and
  `as_of` open every payload. Changing a published rule or constant is a
  new version, never an edit (the v1 `BLEND_VERSION` discipline).
- **Gates.** `npm run check`, `npm run test:unit`, and with a database
  `DATABASE_URL_TEST=… npm run test:integration` pass before you commit.
  Commit on the branch you are given with clear messages; do not push
  unless your brief says so.
- **No model mid, no forecast, no quote.** Nothing in v2 prices anything.

## Layers

| Path | What | May import |
| --- | --- | --- |
| `src/lib/engine/index/` | Pure index arithmetic: series labels, filer families, consensus, dispersion, mark vs print, revisions, SPV premium, waterfall and common-equivalent, `METHODOLOGY_VERSION`, `CE_VERSION` | engine only |
| `src/lib/engine/rulebook.ts` | The rulebook (moved from `engine/dealer/` by P1), extended with v2 source classes by P6 | engine only |
| `src/lib/ingest/parse/` | Pure parsers: a document's text in, typed records out (N-PORT XML, EDGAR full-text search JSON, Form D XML, fund holdings pages) | engine, ingest/parse |
| `src/lib/ingest/fetch/` | Source clients: the SEC client (`SEC_USER_AGENT`, polite fetching), page fetchers. The only network code | ingest, node |
| `src/lib/services/index/` | One file per operation: ingest a source, import a certificate, record an SPV quote, read a name's index, the ref payloads | engine, ingest, db, api |
| `src/app/api/ref/*` | Thin routes over services via `withRefRoute` | services |
| `src/components/*` | Client UI; data only through `/api` | services as types |
| `data/index/` | Checked-in inputs Nick edits: `watchlist.json`, `filer-families.json`, `certificates/`, `spv-quotes/` | — |

`scripts/audit-deps.ts` enforces the table (P2 adds the `ingest` rules).

## Data model (migration `020_marks_index`, written by P2)

All money is `numeric` in USD (not cents; per-share marks need more than
two decimals). Dates of record are `date`; instants `timestamptz`.
Nothing is ever updated in place except `superseded_by`; a correction is
a new row plus a `corrections` row.

```
issuers            id uuid pk, slug text unique, name text, legal_name text null,
                   search_phrases jsonb (string[]), match_pattern text (regex source, i flag),
                   incorporation_state text null, incorporation_source_id uuid null → source_documents,
                   watchlisted boolean, created_at
source_documents   id uuid pk, source_class text (enum below), source_rank smallint,
                   accession text null unique, document_url text, filer_cik text null,
                   filer_name text, fund_series_id text null, fund_series_name text null,
                   form_type text null, filed_on date null, period_end date null,
                   fetched_at timestamptz, content_sha256 text, parser_version text,
                   unique (document_url, content_sha256)
filer_marks        id uuid pk, document_id → source_documents, issuer_id → issuers,
                   holding_index int, holding_name text, holding_title text,
                   asset_category text null, security_label text, security_kind text (enum below),
                   balance numeric null, units text null, value_usd numeric,
                   mark_per_share_usd numeric null, fair_value_level text null,
                   is_restricted boolean null, as_of date, superseded_by uuid null → filer_marks,
                   correction_id uuid null → corrections, created_at,
                   unique (document_id, issuer_id, holding_index)
prints             id uuid pk, issuer_id, round_name text, event_type text, announced_on date,
                   post_money_usd numeric null, amount_raised_usd numeric null,
                   series_label text null, price_per_share_usd numeric null,
                   price_source_id uuid null → source_documents (the certificate),
                   source_url text null, origin text ('events.csv' | 'certificate' | 'form_d'),
                   unique (issuer_id, round_name)
certificates       id uuid pk, issuer_id, document_id → source_documents (delaware_coi),
                   filed_on date, kind text ('restated' | 'amendment'), entered_by text, notes text null
certificate_series id uuid pk, certificate_id, series_label text, original_issue_price_usd numeric,
                   liquidation_multiple numeric, participating boolean,
                   participation_cap_multiple numeric null, seniority int (1 = most senior),
                   shares_authorized numeric, conversion_price_usd numeric null,
                   ratchet jsonb null, unique (certificate_id, series_label)
spv_vehicles       id uuid pk, document_id unique → source_documents (form_d), issuer_id null,
                   vehicle_name text, vehicle_cik text, related_persons jsonb, jurisdiction text null,
                   total_offering_usd numeric null, total_sold_usd numeric null,
                   min_investment_usd numeric null, sales_commission_usd numeric null,
                   finders_fee_usd numeric null, first_sale_on date null,
                   match_method text ('alias' | 'manual' | 'unmatched'), match_note text null
spv_quotes         id uuid pk, issuer_id, spv_vehicle_id null, document_id → source_documents,
                   platform text, quoted_price_per_share_usd numeric null,
                   quoted_valuation_usd numeric null, upfront_fee_pct numeric null,
                   mgmt_fee_pct numeric null, carry_pct numeric null, layers int default 1,
                   captured_at timestamptz
corrections        id uuid pk, published_at timestamptz, methodology_version text,
                   kind text ('row' | 'methodology' | 'parser'), summary text, diff_md text,
                   affected jsonb
ingest_runs        id uuid pk, source_class text, started_at, finished_at null,
                   status text ('running' | 'ok' | 'failed'), documents_seen int,
                   documents_new int, marks_new int, error text null
```

`source_class` and its default rank on the mark side (P6 publishes the
final ranks in the rulebook; ingest stores the rank the rulebook gives):
`ncsr` (audited schedule of investments), `nport` (N-PORT-P),
`fund_holdings_page` (Fidelity monthly, ARK Venture), `closed_end_nav`
(DXYZ), `delaware_coi`, `form_d`, `spv_quote_page`, `company_statement`,
`press`.

`security_kind`: `preferred`, `common`, `convertible_note`, `safe`,
`spv_interest`, `warrant`, `other`, `unknown`.

v1 tables stay in the database untouched; v2 code never reads them.

## Methodology (P3 writes `METHODOLOGY.md` and `engine/index`)

The unit is one `filer_marks` row. Everything else is a pure function of
rows plus the checked-in data files, under `METHODOLOGY_VERSION` (start
`0.1.0`: draft until Nick signs it; `1.0.0` is the first post).

- **Security label.** Parsed from the holding's title and name into a
  canonical label (`Series F Preferred`, `Common`, `Convertible Note`,
  `SPV interest`, `Unclassified`). The index reports per label; marks on
  different labels are never pooled.
- **Per-share mark.** `value_usd / balance` when `units = NS` (shares)
  and `balance > 0`; otherwise null and the row counts toward value but
  not toward per-share series.
- **Filer family.** Funds under one adviser share a valuation committee
  and mark identically, so the comparison is between families, not
  funds: `data/index/filer-families.json` maps registrant CIKs to a
  family (default: the registrant itself). A family's mark on a label and
  date is the median of its funds' marks; if they differ by more than
  0.1 % the row is flagged `intra_family_split`.
- **Comparison date.** Funds' quarters end in different months. A
  family's mark enters a calendar quarter by `as_of`; within a quarter
  each family contributes its latest mark.
- **Consensus mark** per label per quarter: median of family marks, with
  `n_families`. Never a mean.
- **Dispersion:** `(max − min) / median` of family marks, in percent,
  with the high and low families named. Needs `n_families ≥ 2`.
- **Mark versus last print:** `ln(mark / print_pps)` where the print is
  the latest priced round announced on or before `as_of` whose
  certificate gives a per-share price for the same label or for the
  newest series. Null without a certificate price.
- **Revisions:** a family's change on a label between consecutive
  marks, when `|ln(new/old)| ≥ 0.005`. The leader of a move is the first
  family to revise in that direction within the 180 days before; each
  follower's lag is days after the leader.
- **SPV premium:** `ln(quoted_pps × (1 + upfront_fee) / consensus)`,
  with the gross premium (fee-free) beside it and management fee, carry
  and layer count reported, not modelled.
- **Common-equivalent and structure gap** (`CE_VERSION` `0.1.0`): the
  certificate's waterfall evaluated at the headline post-money; the
  common-equivalent value is the common's per-share payout at that
  equity value times fully diluted shares (`post_money / pps`). Gap =
  `ln(headline / common_equivalent)`. Preferred share counts come from
  shares authorized (an upper bound on the preference stack) and the
  payload says `basis: "authorized"`. A ratchet, or any term the function
  does not model, returns `{ status: "unsupported", reason }` and the
  name publishes per series only (decision 0003, open question 4).

Constants (thresholds, windows) are exported from
`engine/index/methodology.ts` and published at `/api/ref/methodology`.

## Ingest (P2)

- `npm run index:search` — week 1: EDGAR full-text search for every
  watchlist issuer's phrases over NPORT-P, N-CSR and N-CSRS; writes
  `data/index/filings-by-name.csv` (issuer, form, filer, CIK, filed,
  period, accession, URL) and `data/index/filer-counts.md` (families and
  filings per issuer, the densest five first). Needs `SEC_USER_AGENT`.
- `npm run index:ingest -- --source=nport [--since=]` — parse each
  N-PORT primary document into `source_documents` and `filer_marks`.
  Idempotent on `(document_url, content_sha256)`.
- Fidelity monthly holdings, ARK Venture holdings, DXYZ NAV: same path,
  their own source class, if their pages serve without a login.
- `GET /api/cron/ingest` (Vercel Cron, daily) runs the EDGAR sources
  incrementally and records `ingest_runs`. `CRON_SECRET` as in v1.

## Certificates, prints, SPVs (P4)

- `data/index/certificates/<slug>/<filed_on>.json` — Nick's (or a
  model's, reviewed) transcription of one Delaware certificate: the
  document's filing date and file number, where it was bought, its
  SHA-256 (the PDF itself is not committed), and one entry per series.
  `npm run index:certificates` validates and imports them.
- Prints: `events.csv` priced rounds import into `prints`; a certificate
  adds `series_label` and `price_per_share_usd` to the round it prices.
- `npm run index:ingest -- --source=form_d` finds Form D filings whose
  issuer name matches a watchlist alias plus an SPV pattern, parses the
  Form D XML into `spv_vehicles`, and records how it matched.
- `data/index/spv-quotes/*.json` records unit quotes captured from public
  pages (URL, capture time, page SHA-256, price and fee terms);
  `npm run index:spv-quotes` imports them. No scraper behind a login.

## API and pages (P5)

Envelope on every `/api/ref/*` payload:
`{ methodology_version, ce_version, rulebook_version, as_of, lag_note }`.

- `GET /api/ref/names` — the watchlist with each name's latest consensus,
  dispersion, family count and latest filing date.
- `GET /api/ref/[slug]` — one name: per label the consensus and dispersion
  series, each family's marks (with accession and URL), the last print,
  the structure table and gap, the SPV panel.
- `GET /api/ref/[slug]/marks` — every filer mark, keyset-paginated.
- `GET /api/ref/[slug]/revisions`, `GET /api/ref/[slug]/spv`.
- `GET /api/ref/methodology`, `GET /api/ref/rulebook`, `GET /api/ref/corrections`.
- `/data/filer-marks.csv`, `/data/certificate-terms.csv`,
  `/data/spv-matches.csv` — CC BY 4.0, generated from the tables.

Pages: `/` the daily page (every name, its headline dispersion, the lag
stated), `/n/[slug]` one name (consensus and dispersion over time, every
family's mark as a dot linking its filing, the last print as a line, the
structure table, the SPV panel), `/methodology`, `/corrections`,
`/rulebook`, `/ref` (API docs), `/resolution-sources`. Every number links
to the document it came from. v1 paths (`/m`, `/t`, `/portfolio`,
`/admin`) redirect to `/`.

## Parts

| Part | Brief | Depends on | Touches |
| --- | --- | --- | --- |
| P1 | `p1-archive.md` — remove v1 from the tree, keep the gates green | — | everything v1 |
| P2 | `p2-edgar-ingest.md` — schema, SEC client, search, N-PORT, fund pages, cron | P1 | migrations, `ingest/`, `services/index/ingest-*`, scripts |
| P3 | `p3-derived-series.md` — `engine/index`, `METHODOLOGY.md` | P1 | `engine/index`, tests |
| P6 | `p6-rulebook-and-contracts.md` — rulebook v2 source classes, `CONTRACTS.md` v2 | P1 | `engine/rulebook.ts`, `CONTRACTS.md` |
| P4 | `p4-certificates-prints-spv.md` | P2, P3 | `data/index`, `services/index` |
| P5 | `p5-site-and-api.md` — routes, pages, CSV, docs | P2–P4, P6 | `app`, `components`, docs |

## Open questions this build answers or leaves (decision 0003)

1. Which five names have the most N-PORT filers: P2's
   `filer-counts.md`.
2. Whether a model can parse certificates: P4 builds the import format;
   who fills it is Nick's call.
3. Whether any SPV platform publishes unit quotes without a login: P4
   reports what it found; the SPV series runs on Form D alone otherwise.
4. Ratchets with an IPO-price condition: `CE_VERSION` 0.1.0 returns
   unsupported; per-series only.
5. Whether anyone pays: not an engineering question.
