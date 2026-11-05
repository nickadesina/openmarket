# P5 — The daily page, name pages, API, CSV, docs

Read `docs/prompts/v2/README.md` ("API and pages" is your spec),
decision `0003`, `METHODOLOGY.md`, `CONTRACTS.md`, `DESIGN.md`,
`PRODUCT.md`, and the read services P4 built
(`services/index/get-name-index.ts`, `list-names.ts`).

## API

- `src/lib/services/index/ref-envelope.ts`: `{ methodology_version,
  ce_version, rulebook_version, as_of, lag_note }` first in every
  payload; `lag_note` states the N-PORT lag in one sentence.
- The routes in the v2 brief, each a thin `withRefRoute` over one
  service (`ref-names`, `ref-name`, `ref-marks`, `ref-revisions`,
  `ref-spv`, `ref-methodology`, `ref-corrections`; `/api/ref/rulebook`
  exists). Keyset pagination for marks with the kept cursor helpers.
  Route tests and integration tests over real parsed fixtures.
- CSV downloads (`/data/filer-marks.csv`, `/data/certificate-terms.csv`,
  `/data/spv-matches.csv`): route handlers generating from the tables,
  60 s cache, a `Link: <…/data/LICENSE>; rel="license"` header, and
  `public/data/LICENSE` with the CC BY 4.0 notice and the attribution
  line. Every row carries its document URL and accession.

## Pages

- `/` — the daily page: every watchlist name with its latest consensus
  per label, dispersion, family count, latest filing date and a link to
  its page. Names with no marks are listed as "no filer marks" with the
  reason (not held by a '40 Act fund, or not ingested). The lag stated.
- `/n/[slug]` — consensus and dispersion over time per label, every
  family's mark as a dot linking its filing (accession and URL), the last
  print as a line, the structure table from the certificate and the
  common-equivalent result (or "unsupported: <reason>"), the SPV panel
  when a vehicle exists. Every number links to the document it came
  from. Build the chart with what the repo already has (or plain SVG);
  read `DESIGN.md`'s chart rules.
- `/methodology` renders `METHODOLOGY.md` (reuse the document components
  that render `/rulebook`) with the live constants from
  `engine/index/methodology.ts`.
- `/corrections` — the corrections policy (corrections are new versions
  with a diff; rows are superseded, never edited; how to report one) and
  every `corrections` row, newest first.
- `/ref` — rewrite the API docs for v2: each route, an example payload
  generated from the local database (not hand-written), keys and quota,
  CC BY 4.0.
- `/rulebook`, `/resolution-sources` stay. The app shell's nav: Index,
  Methodology, Rulebook, API, Corrections.
- Open Graph text per name page: the name, the dispersion figure and the
  filing date — this is what a post links to.

## Docs

- `TECHNICAL_DESIGN.md` (new, v2): how the index is built, from the code
  as it stands, marking what is not built.
- `PRODUCT.md`: the v2 product limits (what the index never says, the
  lag, the source rule, the audience).
- `README.md`: section 1 and the running instructions for v2 (env,
  `index:*` scripts, cron), the drift register reset to v2's open rows.
- `AGENTS.md`: the layout and gates as they now are (keep the Next.js
  block at the top byte for byte).
- `docs/ARTIFACTS.md`: re-index.
- `docs/prompts/v2/README.md`: mark each part built, with what is not.

## Tests

Browser smoke specs (`tests/browser`) for `/`, one `/n/[slug]`,
`/methodology`, `/corrections` against a seeded test database (seed
through the import services from real fixtures). Unit tests for the
envelope and CSV escaping.

## Done when

The gates and `npm run build` pass; a local run with the real ingested
data renders every page; screenshots of `/` and one name page are in
your report's scratch directory (not committed).
