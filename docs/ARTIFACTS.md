# Artifacts index

Every design, spec and evidence artifact for OpenMarket, where it
lives, and what it is for. Repo files win over Claude Docs when they
disagree; a Claude Doc that has an in-repo copy is listed with it.

## Canonical, in this repository

| File | What it is | Read it when |
| --- | --- | --- |
| `README.md` | The MVP contract: product, decision record D1–D14 with status against code, non-goals, how to run, drift register | before any product or scope change |
| `CONTRACTS.md` | Normative semantics of the two instruments per name (binary, forward), the dealer's bound, lifecycle, tournament mapping | before touching anything that quotes, settles or scores |
| `TECHNICAL_DESIGN.md` | How the dealer design is built inside this codebase: schema, jobs, state machine, API, bridge, backtest CI, 8-week plan, open decisions | before starting any milestone in §12 |
| `AGENTS.md` / `CLAUDE.md` | Operating rules for agents: gates, layout, conventions, what is not open | every session |
| `PRODUCT.md`, `DESIGN.md` | Product voice and the visual system | before changing a screen |
| `PART1.md`–`PART5.md` | The original build parts (engine, persistence, read APIs, UI, deployment) for the LMSR ladder; still accurate as engine/persistence/API reference, superseded on product decisions by `README.md` §2 | when working in `src/lib/engine`, `src/lib/services`, `src/app/api` |
| `docs/prompts/implement-dealer.md` | The implementation brief for the agent that builds the dealer design | when starting that work |

## Backtest (evidence for D11–D12)

`backtest/` — see `backtest/README.md` for how to run it and
`backtest/RESULTS.md` for what the numbers mean.

| Path | What it is |
| --- | --- |
| `backtest/sim.py` | Prior (leave-one-out tier step-up, Weibull hazard, leak overrides), dealer (LMSR binary, clipped forward with cap, event-flag widening), four trader scenarios |
| `backtest/analyze.py` | Runs the scenarios on an events file; writes `out/summary.csv`, `out/calibration.csv`, `out/losses_T12.csv`, `out/meta.json`, four PNG charts |
| `backtest/events.csv` | Merged events: 64 rows, 56 priced rounds, 14 companies, Jan 2024–Oct 19 2026; tenders/secondaries recorded but excluded as prints |
| `backtest/data/labs.csv` | OpenAI and Anthropic rounds with leak dates and notes on conflicts |
| `backtest/data/anduril_modal_instinct.csv` | The three red-hot names |
| `backtest/data/analogs.csv` | Cursor, SSI, xAI, Mercor, Harvey, Cognition, Perplexity, Valar Atomics, Greptile |
| `backtest/out/1_forward_loss_per_print.png` | House loss on the forward per print, five listed names, insider vs leak-reader, against the $25k cap |
| `backtest/out/2_void_rate.png` | Share of forward lives that void at T = 3 vs 12 months per name — the chart behind the per-name-T decision |
| `backtest/out/3_prior_calibration.png` | Realised ln(print) minus the prior mid, 45 prints, by tier, with the spread floor and the clip marked |
| `backtest/out/4_resolutions_per_quarter.png` | Priced rounds per quarter, listed vs analog names — how often the scoreboard moves |
| `backtest/out/summary.csv` | Per scenario × T × group: settlements, voids, void rate, forward and binary loss totals / per-unit / max |
| `backtest/out/losses_T12.csv` | Per-print forward loss and per-name binary loss under each scenario at T = 12 |
| `backtest/out/calibration.csv` | Per-print prior error with tier, used for σ_tier |
| `backtest/out/params.json` | Every parameter the app's model and dealer read, with the SHA-256 of the backtest inputs that produced it; imported by `src/lib/config/dealer.ts` |
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
| OpenMarket Tournament: Design Doc | https://claude.ai/artifact/L6oXCYtHUXoopLCkyGActG | implemented on branch `claude/kind-bohr-nf4w3p`; README D9 |
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
