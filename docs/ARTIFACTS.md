# Artifacts index

Every design, spec and evidence artifact for OpenMarket v2 (the marks
index), where it lives and what it is for. Repo files win over Claude Docs
when they disagree. v1's artifacts (the dealer, the tournament, the
backtest) are at the tags `archive/dealer-v1` and `archive/tournament-v1`
and under `docs/archive/`.

## Canonical, in this repository

| File | What it is | Read it when |
| --- | --- | --- |
| `docs/decisions/0003-v2-marks-index.md` | The decision: a published marks index, not a venue; the source rule; the test | before anything |
| `README.md` | Product, decision record (D15, D13 kept), non-goals, running instructions (env, the `index:*` scripts in order, cron), drift register, open questions for Nick | before any product or scope change, and to run anything |
| `TECHNICAL_DESIGN.md` | How the index is built from the code as it stands: layers, data model, ingest, arithmetic, read services, API and downloads (with the response-size note), pages, tests; what is not built | before changing ingest, services, routes or pages |
| `METHODOLOGY.md` | The public spec of the index (0.1.0, draft): the unit, labels, families, consensus, dispersion, listed names, mark versus print, revisions, SPV premium, common-equivalent, constants, corrections | before changing `src/lib/engine/index/`; rendered at `/methodology` |
| `CONTRACTS.md` | Normative spec of the contracts that settle on the index (OpenMarket lists none) | before touching the rulebook's contract rules |
| `PRODUCT.md`, `DESIGN.md` | The product's limits and voice; the visual system and its named rules | before changing a screen |
| `AGENTS.md` / `CLAUDE.md` | Operating rules for agents: gates, layout, conventions, what is not open | every session |
| `docs/prompts/v2/` | The build contract (`README.md`, with each part's status) and one brief per part (P1–P6) | building or reviewing a part |
| `docs/RULEBOOK_CHANGELOG.md`, `docs/RULEBOOK_REVIEWERS.md`, `.github/ISSUE_TEMPLATE/rulebook-review.md` | The rulebook's version history (2.0.0 is the index's), who reviewed it, how a review is filed | changing `RULEBOOK_VERSION` |
| `docs/decisions/0001`, `0002`, `0004`, `0005` | v1's decisions; 0002's 21-day listing floor is kept in the rulebook | history |
| `.env.example` | The environment contract | adding or reading an env var |
| `docs/archive/v1/`, `docs/archive/prompts/`, `docs/prompts/cleanup/`, `docs/prompts/onboarding-and-demo/`, `docs/prompts/tradeables/` | v1's design documents, decision record and briefs; they name v1 files that are only at the archive tags | history, never as instructions |

## Data

| Path | What it is |
| --- | --- |
| `data/index/watchlist.json` | The 20 names and 7 candidates: search phrases, match pattern, listing, Form D phrases (Nick's selection) |
| `data/index/filer-families.json` | Registrant CIKs grouped into families with evidence (0.1.0; drafted by `index:families` from N-CEN) |
| `data/index/filings-by-name.csv`, `filer-counts.md`, `filing-counts.json` | `index:search`'s outputs: every NPORT-P, N-CSR and N-CSRS naming a name; the counts per name; the counts as data, which the pages read to say why a name has no marks |
| `data/index/sources-status.md` | Each source checked against the source rule: built, or not built and why (N-CSR, Fidelity, ARK, DXYZ, SPV unit quotes) |
| `data/index/certificates/README.md`, `data/index/spv-quotes/README.md` | The import formats; no certificate is transcribed and no quote captured |
| `data/round-history/events.csv`, `sources.csv` | The print side: priced rounds with sources; `npm run export:round-history` writes `public/data/round-history.*` |
| `public/data/LICENSE` | CC BY 4.0 notice and attribution line for every download |
| `docs/tradeables/ref-examples.json` | `/ref`'s example payloads, generated from the development database (`npm run export:ref-examples`) |
| `docs/tradeables/resolution-sources.{json,md}`, `objections*.md` | The resolution-source map (rendered at `/resolution-sources`) and the objection catalog, kept from v1 as inputs to the methodology |
| `docs/tradeables/case-study.md`, `distribution.md`, `feed-trial.md`, `maker-*.md`, `questions/` | v1-era tradeables content, kept for reference; not linked from the site |
| `docs/research/` | Private research pulls (see its README) |

## Tests and fixtures

| Path | What it is |
| --- | --- |
| `tests/fixtures/index/` | Real EDGAR documents, trimmed as its README says: N-PORTs, full-text search, N-CEN, submissions, two Form Ds, holding titles |
| `tests/fixtures/certificates/` | The schema fixture's invented issuer `example-co`, for the certificate import and waterfall tests only |
| `tests/fixtures/rulebook-events.json` | How rulebook 2.0.0 resolves every row of `events.csv` |
| `tests/browser/seed.ts`, `global-setup.ts`, `smoke.spec.ts` | The browser suite: a test database filled through the import services from the fixtures, and smoke specs for every page |

## Claude Docs (history)

| Doc | Link | Status |
| --- | --- | --- |
| OpenMarket Technical Design (v1) | https://claude.ai/artifact/SneDWGMo7tB7QisN521brb | v1's dealer design; in-repo copy `docs/archive/v1/TECHNICAL_DESIGN.md`; superseded by `TECHNICAL_DESIGN.md` |
| OpenMarket Contract Specification (v1) | https://claude.ai/artifact/4iJtm24xcQ6w3WRcWLLLZA | v1's instruments; in-repo copy `docs/archive/v1/CONTRACTS-v1.md`; superseded by `CONTRACTS.md` |
| OpenMarket Product Design Doc | https://claude.ai/artifact/19dP1XaJVaZsYc9kMWyaKM | v1 product companion; superseded by `PRODUCT.md` |
| OpenMarket Redesign Sketches | https://claude.ai/artifact/MNyS3dyYy5AWaiGxoDKufF | the visual direction behind `DESIGN.md` |
| OpenMarket legal landscape | https://claude.ai/artifact/NeDrmCUNs2F4dMwvaoRTAe | research, not advice |
| Investor materials | https://claude.ai/artifact/DXCX5t86Rwhdh9gBXzqfku, https://claude.ai/artifact/VvT3qJMNGVPHJWjUAroZnm | fundraising; not engineering inputs |

## Not in the repository, by design

Investor materials, the posting playbook and the legal research stay as
Claude Docs. Nothing an agent needs to build from is only there.
