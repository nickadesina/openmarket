# Artifacts index

Every design, spec and evidence artifact for OpenMarket, where it
lives, and what it is for. Repo files win over Claude Docs when they
disagree; a Claude Doc that has an in-repo copy is listed with it.

## Canonical, in this repository

| File | What it is | Read it when |
| --- | --- | --- |
| `README.md` | The MVP contract: product, decision record D1–D14 with status against code, non-goals, how to run, drift register | before any product or scope change |
| `CONTRACTS.md` | Normative semantics of the two instruments per name (binary, forward), the dealer's bound, lifecycle, tournament mapping | before touching anything that quotes, settles or scores |
| `TECHNICAL_DESIGN.md` | How the dealer design is built inside this codebase: schema, jobs, state machine, API, bridge, backtest CI, milestones (all done but 4, ingest), open decisions; marks what is not built | before touching the dealer, or starting ingest |
| `AGENTS.md` / `CLAUDE.md` | Operating rules for agents: gates, layout, conventions, what is not open | every session |
| `PRODUCT.md`, `DESIGN.md` | Product voice and the visual system | before changing a screen |
| `PART1.md`–`PART5.md` | Layer references: engine (1), persistence and transactions (2), read APIs (3), the markets UI (4), deployment (5); superseded on product decisions by `README.md` §2 | when working in `src/lib/engine`, `src/lib/services`, `src/app/api`, the markets screens, or the build |
| `.env.example` | The environment contract: every variable the app, scripts and build read | adding or reading an env var |
| `docs/prompts/cleanup/` | The robustness and cleanup pass: a dispatch README and one brief per workstream | running that pass |
| `docs/prompts/onboarding-and-demo/` | Historical briefs O1–O3 (O1, O2 stage 1 and O3 merged; status in its README) | reviewing onboarding and demo history |
| `docs/archive/prompts/` | Finished briefs kept for history: `implement-dealer.md` (milestones 1–3, 5–8), `tournament-contracts/` (decision 0004) | never as instructions |
| `docs/decisions/NNNN-*.md` | Agreed changes that supplement the design: 0001 `event_flags` and the ingest hand-off, 0002 the binary's event window and expiry, 0004 tournament questions follow the contracts, 0005 labelled demo accounts (there is no 0003 in the repository) | before any milestone a decision names |
| `tests/browser/*.spec.ts`, `tests/browser/global-setup.ts`, `tests/browser/seed-dealer.ts` | Browser specs (dealer, tournament, onboarding, account, restrictions) and the Playwright setup that migrates, lists the five names and runs one dealer job against `DATABASE_URL_TEST` (no production route) | changing the market page, board, ticket or portfolio |
| `docs/prompts/tradeables/README.md` | Brief for the ten tradeables: the resolution-source map, the public datasets, the reviewable rulebook, the feed trial, the maker slot, questions on request, the objection catalog, distribution, the policy case study | building anything under `docs/tradeables/`, `public/data/` or the `/resolution-sources`, `/rulebook`, `/ref`, `/for-policy` pages |
| `docs/tradeables/*` | The tradeables' content: `resolution-sources.json` (source of truth) and `.md` (rendered), `objections.md` (seeded catalog), `case-study.md`, `maker-slot.md`, `maker-register.md`, `feed-trial.md`, `distribution.md` | sending any of them, or adding a row after a call |
| `public/data/round-history.{csv,json}`, `public/data/backtest/*` | Public exports: the joined round history with sources and tiers, and the redacted backtest outputs (calibration errors, resolutions, void rates). Generated from `backtest/` in the tradeables pass; `npm run export:tradeables` must reproduce them | before sending data to anyone |
| `docs/RULEBOOK_CHANGELOG.md`, `docs/RULEBOOK_REVIEWERS.md`, `.github/ISSUE_TEMPLATE/rulebook-review.md` | The rulebook's version history, who reviewed it, and how a review is filed | changing `RULEBOOK_VERSION` or crediting a reviewer |
| `tests/fixtures/event-flags.json` | 161 fixture flags (scoop / release / print) derived from `backtest/events.csv`; what settlement and mid-model tests read until ingest exists | writing any test that needs a flag |

## Backtest (evidence for D11–D12)

`backtest/` — see `backtest/README.md` for how to run it and
`backtest/RESULTS.md` for what the numbers mean.

| Path | What it is |
| --- | --- |
| `backtest/sim.py` | Prior (leave-one-out tier step-up, Weibull hazard, leak overrides), dealer (LMSR binary, clipped forward with cap, event-flag widening), four trader scenarios |
| `backtest/analyze.py` | Runs the scenarios on an events file; writes `out/summary.csv`, `out/calibration.csv`, `out/losses_T12.csv`, `out/meta.json`, four PNG charts |
| `backtest/golden.py` | Reruns the calibration run (T = 12, no trader, leave-one-out, from 2024) and records sim.py's prior for the listed names with its inputs; writes `out/prior_golden.json` |
| `backtest/events.csv` | Merged events: 64 rows, 59 priced rounds (56 in Jan 2024–Oct 2026; three earlier ones seed the prior), 14 companies, to Oct 19 2026; tenders/secondaries recorded but excluded as prints; no URL column (its digest is pinned) |
| `backtest/data/sources.csv` | A located source URL and rank for the listed names' prints (Instinct's Seed has none); `seed:listings` joins it to `events.csv` and refuses an anchor without a URL. `tests/fixtures/listing-sources.csv` is the tests' placeholder copy |
| `backtest/data/labs.csv` | OpenAI and Anthropic rounds with leak dates and notes on conflicts |
| `backtest/data/anduril_modal_instinct.csv` | The three red-hot names |
| `backtest/data/analogs.csv` | Cursor, SSI, xAI, Mercor, Harvey, Cognition, Perplexity, Valar Atomics, Greptile |
| `backtest/out/*` | Committed results of the last run — four charts and four CSV/JSON tables, each read in `backtest/RESULTS.md`, plus `params.json` (every parameter the app reads, with the SHA-256 of the inputs that produced it; imported by `src/lib/config/dealer.ts`) and `prior_golden.json` (sim.py's binary p, forward opening mid and weekly mid for the five names, with inputs; `tests/engine/dealer/prior.test.ts` holds `src/lib/engine/dealer/prior.ts` to it at 1e-9) |
| `backtest/requirements.txt` | Pinned pandas, numpy, matplotlib for `backtest.yml` |
| `tests/fixtures/rulebook-events.json` | How rulebook v1 resolves every row of `events.csv` and each listed name's forward lives and binary quarters; a rule change re-baselines it |

Fact-check status: 13 of 14 key dates and valuations confirmed against
primary or Tier-1 sources on 2026-10-19; the FT Anthropic $150B+ leak
is dated by pickups (Jul 25–26, 2025), not the FT page itself.

## Claude Docs (working copies and history)

| Doc | Link | Status |
| --- | --- | --- |
| OpenMarket Technical Design | https://claude.ai/artifact/SneDWGMo7tB7QisN521brb | in-repo copy: `TECHNICAL_DESIGN.md` (2026-10-21) |
| OpenMarket Contract Specification — Agent & Dependency-Graph Guide | https://claude.ai/artifact/4iJtm24xcQ6w3WRcWLLLZA | in-repo copy: `CONTRACTS.md`; the doc also carries the backtest results section and Nick's inline edits (Oct 19) |
| OpenMarket Tournament: Design Doc | https://claude.ai/artifact/L6oXCYtHUXoopLCkyGActG | implemented, merged to `master` in #2; README D9 |
| OpenMarket Dependency Graph (v2) | https://claude.ai/artifact/AeMtaUQev3Xq42uD3NKUfm | superseded by `TECHNICAL_DESIGN.md` §12 for build order; still the pre-seed critical path |
| OpenMarket — Timing/Survival Strip Design Doc | https://claude.ai/artifact/DnvuLuE3unH7pjWyQ857Wv | the "by date" markets that became D11's quarterly binary |
| OpenMarket Product Design Doc | https://claude.ai/artifact/19dP1XaJVaZsYc9kMWyaKM | product-side companion to `PRODUCT.md` |
| OpenMarket Redesign Sketches | https://claude.ai/artifact/MNyS3dyYy5AWaiGxoDKufF | visual direction behind `DESIGN.md` |
| OpenMarket MVP Contract | https://claude.ai/artifact/95S4iWriGyzd7Da3on5m9S | the original LMSR-ladder contract; superseded by `README.md` §2 |
| OpenMarket legal landscape | https://claude.ai/artifact/NeDrmCUNs2F4dMwvaoRTAe | research, not advice; informs the SBS caveat in D11/`TECHNICAL_DESIGN.md` §13 |
| OpenMarket: The Case for Regulated Valuation Outcome Contracts (draft) | https://claude.ai/artifact/NXoJu2coJMRHBPqy55Up2t | white paper draft; the structural model section predates the forward design |
| OpenMarket: technical one-pager | https://claude.ai/artifact/Hf6dKh8GmoQ2ePFrVq4h4g | Q&A for crypto-native conversations (Oct 5); rails section still current, instrument section superseded |
| Investor One-Pager / investor dossier | https://claude.ai/artifact/DXCX5t86Rwhdh9gBXzqfku / https://claude.ai/artifact/VvT3qJMNGVPHJWjUAroZnm | fundraising; not engineering inputs |
| Hanson (2002) LMSR — condensed | https://claude.ai/artifact/XZLj9pjhE6EBadpLjw8eAS | reference for the binary market maker |

## Not in the repository, by design

Investor materials, the X playbook, and the legal-landscape research
stay as Claude Docs. Nothing an agent needs to build from is only
there.
