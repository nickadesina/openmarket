# Contracts

Normative specification of five contracts that settle on the OpenMarket
marks index (decision `0003`, README D15). **OpenMarket designs these
contracts and quotes, lists and settles none of them.** A venue that
lists one licenses the feed and names, in its own rulebook, the
`methodology_version` and `rulebook_version` the contract settles
under; the venue runs the book, holds the collateral, applies its
restricted-person rule and pays. Nothing here is an offer, a quote or a
view on where any name should trade.

The index is specified by `METHODOLOGY.md` (normative for every series);
the formulas below restate it for reading and yield to it where they
differ. The rules every contract shares are code
(`src/lib/engine/rulebook.ts`, `RULEBOOK.contracts`), versioned, and
published at `/rulebook` and `GET /api/ref/rulebook`. A rule marked *not
built* is the contracts' intent; the code does not serve it yet. v1's
contracts (the dealer's quarterly binary and next-print forward) are in
`docs/archive/v1/CONTRACTS-v1.md`.

## Definitions

| Term | Definition |
| --- | --- |
| Index | OpenMarket's published series of private-company marks, derived from `filer_marks` rows under `METHODOLOGY_VERSION`. Every published number carries `methodology_version`, `ce_version`, `rulebook_version` and `as_of`. |
| Name, label | An issuer (`issuers.slug`) and a security label (`Series F Preferred`, `Common`, …). Marks on different labels are never pooled. |
| Filer mark | One per-share mark on one security, from one filer, as of one date, with its source document. Never adjusted, interpolated, smoothed or carried forward; a missing filing is a missing row. |
| Source rank | A source class's rank within one purpose (`RULEBOOK.source_purposes`). For a filer mark: `ncsr` 1, `nport` 2, `fund_holdings_page` 3, `closed_end_nav` 4. A rank picks which of one filer's documents stands for a security and date; it never weighs one filer against another. |
| Family mark | Funds under one adviser share a valuation committee: a family's mark on a label and date is the median of its funds' marks (`data/index/filer-families.json`). |
| Quarter Q | A calendar quarter. A family's mark enters Q by its `as_of`; within Q each family contributes its latest mark. |
| Consensus C | Per label per quarter, the median of family marks, with `n_families`. Never a mean. |
| Dispersion | `100 · (max − min) / median` of family marks on a label in Q, in percent. Needs `n_families ≥ 2`. |
| Print | The post-money of a priced primary equity round, publicly reported per the rulebook's print-side ranks (1 company or lead-investor release; 2 SEC filing; 3 two independent Tier-1 outlets; 4 one), with the 7-day revision window. For the labs, an IPO's first-day close is also a print. Not: SAFEs, notes, same-price extensions, secondaries, tenders, debt. |
| Print price | A round's per-share price. The index uses a rank-1 price only: the Delaware certificate (`delaware_coi`). |
| Anchor print | The print in force at listing (`lastPrint`), with its certificate's per-share price, named in the contract's terms with its source documents. |
| Listing | A contract observes the quarter it lists in if at least 21 days remain, otherwise the next (`observedQuarterEnd`). |
| Window | From the listing instant (exclusive) to Q's last millisecond, UTC. |
| Repricing event | A priced round, tender or secondary, public S-1, IPO or acquisition of the name, announced per the rulebook at any rank, valuation disclosed or not. |
| Observation date D | 00:00 UTC on the 75th day after Q's last day (`observationDate`). The contract reads the index as published at D; a row published later does not enter. |
| n_min | The contract's minimum number of filer families on its label at D. At least 2; the venue may set more. |
| Void | Every position is cancelled and the venue refunds under its own rulebook. A normal outcome, not an error. |

Units: per-share marks and prices in USD; log ratios are natural logs;
time is UTC.

## Rules every contract shares

These are `RULEBOOK.contracts`; each contract below adds its own.

- **Versions.** The contract names a `methodology_version` (1.0.0 or
  later: 0.x is a draft) and a `rulebook_version`. It settles under
  those; a later version never changes its settlement. *Not built:* the
  index publishes each series under the current methodology version
  only; a contract naming an earlier one settles on the value
  recomputed from the published rows under that version.
- **Observation.** The settlement value is the series as published at
  D, from the rows present at D. *Not built:* no route serves the index
  as published on a past date; every row records when it was fetched
  and created, so the value at D can be recomputed from the rows.
- **Repricing void.** A repricing event announced inside the window
  voids the contract (`resolveRepricing`). Fund committees re-mark a
  name on a new round, a tender or an exit, and the name's insiders know
  of each before anyone else; voiding removes the one channel by which
  their knowledge reaches the observation. An event after Q ends does
  not void: marks as of Q reflect what was known or knowable in Q.
- **Void on no print.** A contract whose series needs a print voids
  when none qualifies by D.
- **Void on no filing.** No filer mark on the label for Q by D, or fewer
  than n_min families, voids the contract.
- **A filer stops filing.** Its last mark is never carried forward. The
  series is computed from the families present; the contract voids only
  if fewer than n_min remain.
- **Corrections.** A correction (a new row plus a `corrections` row)
  published before D enters. One published after D does not re-settle:
  the index publishes it with its diff, and the settled value stands as
  published at D.
- **Restricted persons.** The venue's rulebook names them. This spec's
  design limits the edge to them: the name's officers, directors,
  employees and investors with information rights, and the staff of a
  contributing filer's valuation process (committee, adviser's pricing
  team, fund administrator), who know a mark before it is filed.

## Contract 1 — mark-level binary

Pays 1 if the consensus mark on one label of one name for quarter Q is
at or above a strike K; 0 otherwise.

- **Underlying.** The index's consensus mark `C(name, label, Q)` under
  the named `methodology_version`.
- **Observation.** At D: every family's latest mark on the label with
  `as_of` in Q, from documents published in the index by D.
- **Settlement source and rank.** Filer marks, `filer_mark` ranks
  (`ncsr` 1, `nport` 2, `fund_holdings_page` 3, `closed_end_nav` 4):
  for one fund and date, the higher-ranked document stands.
- **Formula.** YES iff `C ≥ K` (K in USD per share). Terms: name,
  label, Q, K, n_min.
- **Void.** A repricing event in the window; no mark on the label for
  Q by D, or fewer than n_min families; a correction after D does not
  re-settle.
- **Why the edge sits with brokers and analysts.** The observation is
  what independent valuation committees write down, not a number the
  company sets or sees. Committees mark from observable inputs (recent
  transactions, comparable companies), so the broker who sees secondary
  flow and the analyst who models each family's marking history (the
  index publishes its revisions and lags) have the edge. A company
  insider's information reaches the mark only through a repricing
  event, which voids the contract.

## Contract 2 — dispersion range

A strip of ranges on the dispersion of family marks on one label of one
name for quarter Q; the range that contains it pays 1, the rest 0.

- **Underlying.** The index's dispersion
  `100 · (max − min) / median` of family marks on `(name, label, Q)`
  under the named `methodology_version`, with the high and low families
  named.
- **Observation.** As contract 1.
- **Settlement source and rank.** As contract 1. A family whose funds
  split by more than 0.1 % is flagged `intra_family_split`; the flag
  does not change the family mark (the median of its funds) or the
  settlement.
- **Formula.** Range i pays 1 iff `lo_i ≤ dispersion < hi_i`. The
  ranges partition `[0, ∞)`, the last open above; a value on a boundary
  belongs to the higher range. Terms: name, label, Q, the boundaries,
  n_min (at least 2: dispersion needs two families).
- **Void.** As contract 1. A family that stops filing is absent, which
  can narrow the dispersion; that is the risk the contract carries, and
  n_min bounds it.
- **Why the edge sits with brokers and analysts.** Dispersion is the
  disagreement between committees. No company insider sets it or
  learns it early, and no single filer controls it. The edge is reading
  each family's policy (who marks to the last round, who marks to
  secondaries, who lags), which is public in the index's history.

## Contract 3 — mark versus print

A cash-settled forward on how far the filers' consensus on one label
sits from the anchor print's per-share price at quarter Q.

- **Underlying.** The index's mark versus print,
  `X = ln(C(name, label, Q) / print_pps)`, under the named
  `methodology_version`, where the print is the latest priced round
  announced on or before the mark's `as_of` whose certificate gives a
  per-share price for the label or for the newest series.
- **Observation.** At D, as contract 1; the print is the anchor print.
- **Settlement source and rank.** Filer marks by `filer_mark` rank; the
  print price from `delaware_coi` (rank 1 for `print_price_and_terms`;
  no lower rank enters); the print itself by the print-side ranks and
  revision window.
- **Formula.** Per unit notional N, long:

      payout = N · clip(X − X₀, −κ, +κ)

  Short pays the negative; X₀ is the level a position opens at; the
  clip κ is the venue's term. Max gain or loss per position is N·κ.
  Terms: name, label, Q, the anchor print, κ, n_min.
- **Void.** Void on no print: the series is null at D (no certificate
  price for the label or the newest series). The series at D references
  a print other than the anchor (a certificate imported after listing
  for an earlier round can do this). A repricing event in the window
  (which includes any new round). No mark or fewer than n_min families.
- **Why the edge sits with brokers and analysts.** The print is fixed
  at listing and public; the only uncertainty is where committees mark
  relative to it. Brokers see whether secondaries clear above or below
  the round; analysts read how each family has historically marked
  away from a print. An insider who knows of the next round gains
  nothing: the round voids the contract.

## Contract 4 — perp basis

A quarterly cash-settled swap on the basis between a venue's perpetual
future on a name and the index's consensus mark.

- **Underlying.** The index's consensus mark `C(name, label, Q)` on the
  name's reference label (named at listing: the newest preferred series
  with at least n_min families), under the named `methodology_version`,
  and the venue's own perp price.
- **Observation.** The perp: the venue's published mark price,
  time-weighted over Q's last UTC day. The index: at D, as contract 1.
  A perp quoted as a valuation V converts to per share with the anchor
  print's fully diluted count: `P = V · print_pps / post_money`. That
  count ignores shares issued since the print; it is a convention the
  contract states, not a model.
- **Settlement source and rank.** The perp price is the venue's,
  outside this rulebook. The consensus as contract 1; for the
  conversion, the post-money by the print-side ranks and the per-share
  price from `delaware_coi`.
- **Formula.** `B = ln(P / C)`. Per unit notional N, long:

      payout = N · clip(B − B₀, −κ, +κ)

  Terms: name, label, Q, the anchor print (valuation-quoted perps), the
  perp's price source, κ, n_min.
- **Void.** Void on no print: a valuation-quoted perp with no anchor
  print does not list, and the repricing void keeps the anchor in force
  to D. A repricing event in the window. No mark or fewer than n_min
  families. The venue fails to publish its perp price for Q's last day.
- **Why the edge sits with brokers and analysts.** The basis is the gap
  between what a perp's traders pay and what committees mark, roughly
  60 days later. Brokers who see both secondary flow and the perp's
  order flow, and analysts who know how fast each family follows a
  move, can price the convergence. Insiders see neither the perp's book
  nor the committees' marks, and a round voids the quarter.

## Contract 5 — structure spread

A cash-settled forward on the spread between the consensus marks on two
labels of one name in quarter Q: how much the committees pay for a
senior series over a junior one.

- **Underlying.** `S = ln(C(name, A, Q) / C(name, B, Q))`, two consensus
  series under the named `methodology_version`; A and B are named at
  listing (a senior preferred series and a junior one, or a preferred
  series and `Common`).
- **Observation.** At D, as contract 1, for each label.
- **Settlement source and rank.** As contract 1, per label.
- **Formula.** Per unit notional N, long:

      payout = N · clip(S − S₀, −κ, +κ)

  Terms: name, labels A and B, Q, κ, n_min per label.
- **Void.** A repricing event in the window (a new series reshapes the
  stack). Either label has no mark or fewer than n_min families at D.
- **Not the structure gap.** The index also publishes the structure gap,
  `ln(headline / common_equivalent)` under `ce_version`, from the
  certificate's waterfall. A contract does not settle on it: it is
  arithmetic, fixed the day the certificate is bought. The spread is
  what committees actually mark, and the gap beside it is the
  waterfall's view.
- **Why the edge sits with brokers and analysts.** Seniority,
  preference multiples and participation are in the certificate, which
  anyone can buy; the analyst who reads it and knows how each committee
  treats the preference stack has the edge. Brokers see series-level
  secondary prices. The company's insiders know the terms no better than
  the certificate states them, and a new round voids the contract.

## Not open

OpenMarket quotes, lists and settles none of these contracts. Void on
no print; void and refund are the venue's. Every published number
carries its versions, and a contract settles under the versions it
names. A filer's mark is never adjusted; a missing filing is a missing
row. Every input obeys the source rule (decision `0003` §4).
