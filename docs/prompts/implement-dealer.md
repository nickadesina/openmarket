# Brief: implement the dealer design without adding complexity

You are implementing the architecture change recorded in `README.md`
§2 (D10–D14), specified in `CONTRACTS.md`, and planned in
`TECHNICAL_DESIGN.md`, inside the `nickadesina/openmarket` repository.
Read those three files and `AGENTS.md` in full before writing code.
`docs/ARTIFACTS.md` tells you where everything else is;
`docs/decisions/` holds agreed changes that supplement the design —
read every file there before starting a milestone it names.

**Milestone 4 (ingest) is owned elsewhere** — see
`docs/decisions/0001-event-flags-and-ingest-handoff.md`. You create
the `event_flags` table in `007_dealer` with the pinned shape in that
file, and until ingest lands your tests read
`tests/fixtures/event-flags.json`.

## What you are building

Five listed names, two contracts each — a quarterly timing binary on
the existing two-outcome LMSR and a dealer-quoted next-print forward
with clip, cap, per-name expiry and void-and-refund — exactly as
`CONTRACTS.md` defines them; plus the jobs that feed them (ingest is
not yours: see below), the mid model, settlement and roll, and a
read-only reference-price API. Do not re-derive the instrument from
this brief; `CONTRACTS.md` is normative.

## The constraint that governs every choice

**Do not increase the complexity of this codebase.** Concretely:

- No new services, runtimes, queues, websockets, or external
  databases. Three cron routes under `src/app/api/cron/` called by
  GitHub Actions workflows, exactly as `provenance.yml` on the
  tournament branch does. If you are tempted to add a worker, stop.
- No new money system. A forward position is a `trades` row (cash,
  idempotency, replay) plus a `forward_positions` row for the
  instrument-specific fields. Collateral is a reservation against
  `users.cash_balance_cents` through the existing ledger.
- No new market maker for the binary. `n_buckets = 2` on the existing
  LMSR engine and the existing `quote` / `execute-trade` services.
  If the engine needs a change to support two buckets cleanly, make
  that change; do not fork it.
- No new identity. Tournament sign-in (X OAuth or username) is the
  identity for everything; the restricted-person attestation is a
  field on the existing affiliation editor.
- No new UI framework or component library. The market page keeps its
  chart and ticket. The strike ladder becomes read-only. The ticket
  gains a Long/Short toggle, notional, live bid/ask in dollars, max
  gain/loss and expiry. Reuse `quote-review` for the review step.
- Pure engines, thin services, thin routes — the existing layering,
  enforced by `scripts/audit-deps.ts`. New engine code goes in
  `src/lib/engine/dealer/` and imports engine only. New services go
  in `src/lib/services/dealer/`, one file per operation. Routes stay
  thin.
- One migration, `007_dealer` (after the tournament branch's
  `004`–`006`), additive only. Log tables get the same append-only
  trigger the tournament uses. `verify:replay` must rebuild every new
  derived figure from the logs; extend it, do not bypass it.
- Parameters are data. `src/lib/config/dealer.ts` reads
  `backtest/out/params.json`. A hand-edited parameter is a failing
  test. Write that test first.
- Delete what the change makes dead. If the 41-bucket seeding,
  strike-ladder trading paths, or any PART-document behaviour is no
  longer reachable after a milestone, remove it in that milestone's
  PR, with the README drift row updated. The repo should be smaller
  in concepts when you finish, not larger.
- Every published number carries `model_version`, `rulebook_version`
  and (for the reference) `blend_version`. No exceptions, including
  the admin page.

## Milestones, one PR each, in this order

Each PR is small enough to review in one sitting, passes every gate in
`AGENTS.md`, and updates `README.md` §2 status lines and the drift
register for anything it changes. Do not start a milestone whose
dependencies are not merged.

1. **Merge the tournament branch** (`claude/kind-bohr-nf4w3p`) to
   `master`. Resolve conflicts in favour of the branch; replace README
   D9 with the branch's own D9 section. CI green including Playwright.
2. **Rulebook + fixtures + backtest CI.** `src/lib/engine/dealer/
   rulebook.ts` (versioned; the v1 table from `CONTRACTS.md`),
   `GET /api/ref/rulebook`, a fixture test that resolves every row of
   `backtest/events.csv` through it, and `.github/workflows/
   backtest.yml` that runs `python3 backtest/analyze.py` on PRs
   touching `backtest/`, `src/lib/engine/dealer/` or
   `src/lib/config/dealer.ts` and posts `out/summary.csv` as a PR
   comment. `backtest/analyze.py` must also write `out/params.json`
   (μ, λ, k, σ per tier, p_floor, s_floor, per-name T proposals).
3. **Schema + seed.** `007_dealer`: `listings`, `instruments`,
   `event_flags`, `model_mids`, `quotes`, `forward_positions`,
   `reference_prices`, `tournament_instrument_links`, `cron_runs`;
   `markets.instrument_id`. Kysely types. `npm run seed:listings` for
   the five names with verified last prints (use
   `backtest/events.csv` as the source of truth), idempotent on
   `(company, listed_at)`. Migrate + replay in the build.
4. **Ingest — not yours.** Owned per
   `docs/decisions/0001-event-flags-and-ingest-handoff.md`. Skip it;
   milestones 5–8 depend on the table and the fixture, not on the
   job.
5. **Mid model.** `src/lib/engine/dealer/prior.ts`, a port of the
   prior in `backtest/sim.py`; `/api/cron/mid`; a test asserting
   agreement with `sim.py` to 1e-9 on `events.csv` (run the Python in
   the test via a committed golden file, not a subprocess).
6. **Dealer + settlement.** `binary.ts` (LMSR, two outcomes),
   `forward.ts` (quoter per `CONTRACTS.md` → The dealer), the
   `instruments.state` machine with one fixture test per transition,
   `/api/cron/dealer` + `dealer.yml`, `/api/cron/settle` +
   `settle.yml`, `dealer_pnl` view, ticket UI changes. Gate: five
   names quoting on staging; a fixture print settles both instruments
   and lists successors in one transaction each. Delist the old
   Anthropic/Stripe ladder markets in this PR unless Nick says
   otherwise.
7. **Tournament bridge.** `tournament_instrument_links`, `outcome =
   void` on `tournament_questions`, the crowd component into
   `reference_prices`, `POST /api/t/questions/[slug]/evidence`,
   attestation field. Gate: crowd weight appears in the blend on a
   question with ≥ 10 forecasters.
8. **Reference API + admin + alerts.** `/api/ref/*` per
   `TECHNICAL_DESIGN.md` §8, `blend.ts`, `api_keys`, `/admin/dealer`
   (pnl, source last-success, widened instruments, resolution queue),
   a daily Actions job that fails on a >72 h widen (the silent-source
   check ships with ingest; read `source_health` against an empty
   table until then). Gate: public endpoints cached 60 s with versions in every
   payload.

## How to work

- Before each milestone, write the tests for its gate, then the
  engine, then the service, then the route, then the UI. Pure engine
  code gets property tests where the existing engine has them.
- Keep `README.md` §2 truthful: every decision line you touch gets a
  current status (Implemented / Drifted / Open) and a "Current code:"
  sentence. Add a drift-register row for anything you discover that
  the docs get wrong, including in these three documents.
- Real data only, as `AGENTS.md` says. Listing anchors come from
  `backtest/events.csv` with its source URLs. Never invent a print.
- When `CONTRACTS.md` and `TECHNICAL_DESIGN.md` disagree, `CONTRACTS.md`
  wins on semantics and `TECHNICAL_DESIGN.md` wins on structure; say
  which you followed in the PR.
- Things you may not change without Nick: two contracts per name;
  void-and-refund on no print; log units in the engine; the dealer
  always quotes; parameters from the backtest; versions on every
  published number; the five names; per-name T. If a decision in
  `TECHNICAL_DESIGN.md` §13 blocks you, implement the default stated
  there and list it in the PR under "Decisions taken by default".
- Each PR description: what changed, what was deleted, what gate it
  passes, which README lines moved, decisions taken by default, and
  the `backtest.yml` summary if it ran.

## Definition of done

Five names with live two-way quotes on both contracts in play money;
the public reference tape with versions in every payload; tournament
questions linked to the same contracts; `verify:replay` rebuilding
every derived number; the LMSR ladder gone as a trading surface; the
repo with fewer product concepts than it has today, not more.
