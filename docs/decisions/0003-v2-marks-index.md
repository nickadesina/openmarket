# 0003 — v2: from venue to marks index

Date: 2026-11-04. Status: decided (Nick, 2026-11-04, "OpenMarket v2: from
venue to marks index"). Supersedes README D1, D9–D12 and D14 as product
decisions; D13 (rulebook) is kept and extended. The v1 code is archived at
the tags `archive/dealer-v1` and `archive/tournament-v1` (both on
`5335ae5`, the last v1 commit on `master`); nothing in v1 is deleted from
history.

## Why

The thesis is unchanged: private-company pricing is obfuscated, and
whoever becomes the reference price for the twenty most-watched private
names owns something funds, administrators, lenders and perp venues will
pay for. What changes is where the price comes from.

v1 tried to manufacture the price by quoting two-sided markets as dealer.
The mechanism was sound (four rebuilds, a backtest, a versioned rulebook,
a bounded worst case) but the venue needed a counterparty and OpenMarket
was it; the model mid never moved because ingest was never built; the
forward asked strangers for a level only insiders know; the tournament had
no uptake; and the natural counterparties are US institutions that cannot
touch an offshore venue.

v2 extracts the price from marks that sophisticated holders already have
to disclose, and publishes the disagreement between them.

## Decision

1. **OpenMarket is a published index of private-company marks**, built
   only from public filings, under Nick's own name. The product is the
   number and its provenance.
2. **Three outputs, three public sources.** Cross-fund dispersion on the
   same security (N-PORT, N-CSR, fund holdings pages). Round structure
   behind headline valuations (Delaware certificates of incorporation).
   SPV premiums over consensus marks (Form D and public unit quotes).
3. **The unit of the index** is one per-share mark on one security, from
   one filer, as of one date, with its source document (an EDGAR accession
   number where there is one). Every other number is derived from those
   rows and can be recomputed from them. A filer's mark is never adjusted,
   interpolated or smoothed; a missing filing is a missing row.
4. **Source rule.** Every input is a public filing, a document bought from
   a public registry, or a price on a page with no login. Nothing from a
   DM, a leaked letter, a login or a vendor paywall. Forge, Caplight and
   Hiive are excluded. This rule is the legal posture and the credibility
   of the index at once.
5. **Versioned methodology.** `METHODOLOGY.md` is the public spec;
   every payload carries `methodology_version`; corrections are new
   versions with a diff, never silent edits. The ~60-day N-PORT lag is
   stated on every page.
6. **No venue, no quote.** OpenMarket specifies contracts that settle on
   the index (`CONTRACTS.md`) and quotes none of them. A venue that wants
   to list one licenses the feed and names the index in its rulebook.
7. **No opinions.** No forecasts, no model mid, no view on where a name
   should trade. Posts are the filing and the arithmetic.

## What carries over, what is archived

| Component | Disposition |
| --- | --- |
| Rulebook and resolution hierarchy | Kept and extended: N-PORT, N-CSR, fund holdings pages and SPV Form D become source classes with their own ranks |
| Round-history dataset (`events.csv`, `public/data/round-history.*`) | Kept: the print side of every mark-versus-print comparison; per-share prices from certificates are added |
| Versioned `/api/ref/*` payloads, API keys, quota | Kept; the payload is the index, not a dealer mid |
| Decision records, agent briefs | Kept; v2 briefs under `docs/prompts/v2/` |
| Next.js site | Kept as the daily page; trading UI removed |
| Backtest (`backtest/sim.py`, `analyze.py`, `out/`) | Archived (tag); `events.csv` moves to the round-history dataset |
| Dealer engine and services, LMSR, trading UI, portfolio | Archived (tag) |
| Tournament, X OAuth, leaderboard, provenance | Archived (tag) |
| Tradeables artifacts | Source map and objection catalog kept as inputs to the methodology page; dealer-specific pages archived |

Archived means removed from `master`'s tree and reachable at the tags.
Database tables v1 created are left in place (no destructive migration);
the v2 code does not read them.

## Test

Six months from the first post, not a timebox. The index has worked if,
without being asked, at least one of: an administrator, allocator or
lender requests the design-partner key; a journalist cites the dispersion
number with the site as source; a venue asks to list against the feed; a
conversation about a seat starts because of the account. If none has,
the methodology and data stay public under CC BY 4.0 and it stops being
treated as a path.

## Not engineering (Nick's, before the first post)

LLC owning the domain, repo and account; media liability policy; one
lawyer read of the methodology page, the corrections policy and the
source rule; employer conflict check; the real-name account. Certificate
reading, the methodology prose and the posting stay with Nick; the
parsers, ingest, derived series, API and pages are the build
(`docs/prompts/v2/README.md`).
