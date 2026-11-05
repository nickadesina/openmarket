# P3 — Derived series: `src/lib/engine/index` and `METHODOLOGY.md`

Read `docs/prompts/v2/README.md` ("Methodology" is your spec) and
decision `0003`. This part is pure code: no database, no network, no UI.
It runs alongside P2, which builds the tables; your functions take plain
typed rows (define the input types here; P2/P4/P5 map rows onto them).

## Build, in `src/lib/engine/index/`

- `methodology.ts` — `METHODOLOGY_VERSION = "0.1.0"`, every constant
  (revision threshold 0.005 in ln, leader window 180 days, intra-family
  split tolerance 0.001, minimum families for dispersion 2) as one
  exported frozen object, so `/api/ref/methodology` can publish it.
- `series.ts` — `classifySecurity(title, name, assetCategory?)` →
  `{ label, kind }`: `Series F Preferred`, `Series C-1 Preferred`,
  `Common`, `Convertible Note`, `SAFE`, `SPV interest`, `Warrant`,
  `Unclassified`. Handle the real title shapes N-PORT carries ("Anthropic
  PBC Series F", "ANTHROPIC PBC SER F PFD", "Databricks, Inc. Series J
  Preferred", "OpenAI Global LLC Units"…). Fetch a few real N-PORT
  documents from EDGAR to collect titles (`SEC_USER_AGENT` must be set;
  ≤ 10 req/s) and keep the titles you test against in a fixture file
  with their accession numbers.
- `families.ts` — resolve a registrant CIK to a family from the
  `filer-families.json` shape (`{ version, families: [{ slug, name,
  ciks, evidence }] }`; default is the registrant), and
  `familyMarks(marks)` → one mark per family, label and date (median of
  the family's funds; `intra_family_split` flag).
- `consensus.ts` — calendar-quarter bucketing by `as_of`, each family's
  latest mark in the quarter, `consensus` (median, `n_families`) and
  `dispersion` (`(max − min)/median` in percent, high and low families).
- `print.ts` — `markVersusPrint(mark, prints)`: the latest priced print
  on or before the mark's date with a per-share price for the same label
  or the newest series; `ln(mark / pps)`, or null with a reason.
- `revisions.ts` — revisions per family and label, leader and follower
  lags as specified.
- `spv.ts` — SPV premium, gross and net of upfront fee; mgmt fee, carry,
  layers passed through.
- `waterfall.ts` — `CE_VERSION = "0.1.0"`. A liquidation waterfall over
  a certificate's series (seniority, multiple, participating with or
  without cap, non-participating converts when conversion pays more) at
  equity value V; `commonEquivalent(certificate, headlinePostMoney, pps)`
  and `structureGap`. Returns `{ status: "unsupported", reason }` for a
  ratchet or any term it does not model. Basis is `"authorized"`.
- `index.ts` re-exports.

Every function validates its inputs, never mutates them, and is
deterministic. Property tests with `fast-check` where they bite: the
median ignores order; dispersion is scale invariant; the waterfall pays
out exactly V; with all series 1× non-participating, the gap is 0 at
any headline at or above the stack; a higher multiple never lowers the
gap.

## `METHODOLOGY.md` (repo root)

The public spec, written to be read by an LP's valuation team: the
unit of the index, the source rule, source classes and ranks (link the
rulebook), each derived series with its formula and an example from a
real filing's numbers (cite the accession), what is never done (no
adjustment, no smoothing, no fill), the lag, the families and why, the
CE function and its limits, versioning and corrections. Mark it
"v0.1.0 — draft, Nick's to sign before the first post". Plain prose,
the house voice in `PRODUCT.md`; no adjectives about the index itself.

## Done when

`npm run check` and `npm run test:unit` pass; `engine/index` imports
only engine; `METHODOLOGY.md` states every constant `methodology.ts`
exports and nothing it does not. Touch nothing outside
`src/lib/engine/index/`, `tests/engine/index/`, `tests/fixtures/index/`
and `METHODOLOGY.md`.
