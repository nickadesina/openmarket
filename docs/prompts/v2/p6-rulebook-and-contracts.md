# P6 — Rulebook v2 source classes, `CONTRACTS.md` v2

Read `docs/prompts/v2/README.md`, decision `0003`, the current
`CONTRACTS.md` and `src/lib/engine/rulebook.ts` (moved there by P1;
`docs/archive/v1/` has the v1 design if you need it).

## Rulebook (`src/lib/engine/rulebook.ts`, `RULEBOOK_VERSION` 2.0.0)

- Keep the print-side hierarchy as it is (what a print is, ranks 1–4,
  the revision window, void on no print) and keep
  `tests/fixtures/rulebook-events.json` resolving as it does.
- Add the mark-side source classes as data: `ncsr`, `nport`,
  `fund_holdings_page`, `closed_end_nav`, `form_d`, `spv_quote_page`,
  `delaware_coi`, `company_statement`, `press`, each with its rank, what
  it can establish (a filer mark, a per-share print price, a round's
  size and date, an SPV's existence and terms, a unit quote), its
  cadence and lag, and its access (free / paid per document / public
  page). Audited N-CSR ranks above N-PORT for the same fund and date; a
  Delaware certificate ranks first for per-share price and terms.
- `sourceRank(sourceClass)` and the table are what ingest stores on
  `source_documents.source_rank`.
- Drop what only the dealer used (the binary and forward instruments'
  resolution functions stay only if the v2 contracts reuse them; the
  contracts below settle on the index, so most do not). Anything removed
  is listed in `docs/RULEBOOK_CHANGELOG.md` under 2.0.0 with the reason.
- `/api/ref/rulebook` and `/rulebook` render the new table (update the
  page sections in `src/lib/tradeables/rulebook-sections.ts` or wherever
  P1 left them). Tests: the table is complete for every `source_class`
  in the migration enum, ranks are unique within a purpose.

## `CONTRACTS.md` v2

Normative specs for the five contracts in decision 0003, in the same
form as the v1 forward spec (archived): mark-level binary, dispersion
range, mark versus print, perp basis, structure spread. For each:
underlying (the exact index series and `methodology_version` it
references), observation (which filing, which date), settlement source
and rank, the formula, the void conditions (no filing by the deadline,
a filer stops filing, a correction after settlement — say what happens),
and why the edge sits with brokers and analysts rather than company
insiders. State at the top that OpenMarket designs these and quotes,
lists and settles none of them; a venue that lists one licenses the feed
and names the index version in its rulebook. Keep "void on no print"
and "every published number carries its versions". The v1 contract text
moves to `docs/archive/v1/CONTRACTS-v1.md` unchanged.

## Done when

`npm run check` and `npm run test:unit` pass; touch only
`src/lib/engine/rulebook.ts`, its tests, `docs/RULEBOOK_CHANGELOG.md`,
the rulebook page/route and its section data, `CONTRACTS.md`, and
`docs/archive/v1/CONTRACTS-v1.md`.
