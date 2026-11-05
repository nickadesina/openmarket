# Contracts

Normative specification of five contracts that settle on the OpenMarket
marks index (decision `0003`, README D15). **OpenMarket designs these
contracts and quotes, lists and settles none of them.** A venue that
lists one licenses the feed and names, in its own rulebook, the
`methodology_version`, the `ce_version` where the contract uses one, and
the `rulebook_version` the contract settles under; the venue runs the
book, holds the collateral, applies its restricted-person rule and
pays. Nothing here is an offer, a quote or a view on where any name
should trade.

The index is specified by `METHODOLOGY.md` (normative for every series);
the formulas below restate it for reading and yield to it where they
differ. The rules the contracts share are code
(`src/lib/engine/rulebook.ts`, `RULEBOOK.contracts`), versioned, and
published at `/rulebook` and `GET /api/ref/rulebook`. A rule marked *not
built* is the contracts' intent; the code does not serve it yet. v1's
contracts (the dealer's quarterly binary and next-print forward) are in
`docs/archive/v1/CONTRACTS-v1.md`.

| Contract | Settles on | Why it is better than the v1 forward |
| --- | --- | --- |
| 1. Mark-level binary | Whether a named filer's next disclosed mark on a series is above a strike | Short-dated, resolves on a filing; the edge belongs to people who talk to GPs, not company insiders |
| 2. Dispersion range | High minus low across filers on a series at the next filing date | A view on disagreement, not on level; nobody inside the company has an edge |
| 3. Mark versus print | Where the next priced round lands relative to the consensus mark | The one number the whole thesis reduces to; settles on a certificate |
| 4. Perp basis | The log difference between a perp venue's mark at expiry and the next certificate price | The tracking error every perp venue and hedging desk carries and cannot price; the venue is the natural customer |
| 5. Structure spread | The headline valuation versus the certificate's common-equivalent at the next round | Prices how much of the headline is preference stack |

Contracts 1 and 2 settle on **marks**; contracts 3, 4 and 5 settle on
the **next priced round**, through its certificate. The two families
share some rules and differ on the rest, below.

## Definitions

| Term | Definition |
| --- | --- |
| Index | OpenMarket's published series of private-company marks, derived from `filer_marks` rows under `METHODOLOGY_VERSION`. Every published number carries `methodology_version`, `ce_version`, `rulebook_version` and `as_of`. |
| Name, label | An issuer (`issuers.slug`) and a security label (`Series F Preferred`, `Common`, …). Marks on different labels are never pooled. |
| Filer mark | One per-share mark on one security, from one filer, as of one date, with its source document. Never adjusted, interpolated, smoothed or carried forward; a missing filing is a missing row. |
| Source rank | A source class's rank within one purpose (`RULEBOOK.source_purposes`). For a filer mark: `ncsr` 1, `nport` 2, `fund_holdings_page` 3, `closed_end_nav` 4. For a round's per-share price and terms: `delaware_coi` 1. A rank picks which of one filer's documents stands for a security and date; it never weighs one filer against another. |
| Filer family | Funds under one adviser, which share a valuation committee (`data/index/filer-families.json`). A family's mark on a label and date is the median of its funds' marks. "Filer" in a contract means a family. |
| Quarter Q | A calendar quarter. A family's mark enters Q by its `as_of`; within Q each family contributes its latest mark. |
| Consensus C | Per label per quarter, the median of family marks, with `n_families`. Never a mean. |
| Dispersion | High minus low across families on a label in Q, as a percentage of the median: `100 · (max − min) / median`, the methodology's normalisation. Needs `n_families ≥ 2`. |
| Repricing event | A priced round, tender or secondary, public S-1, IPO or acquisition of the name, announced per the rulebook at any rank, valuation disclosed or not. |
| Print | The post-money of a priced primary equity round, publicly reported per the rulebook's print-side ranks (1 company or lead-investor release; 2 SEC filing; 3 two independent Tier-1 outlets; 4 one), with the 7-day revision window. |
| Next round R | The first priced round announced strictly after listing and at or before the contract's deadline T, at any rank, valuation disclosed or not (`resolveNextRound`). |
| Certificate price | The new series' original issue price per share in R's Delaware certificate of incorporation (`certificate_series.original_issue_price_usd`), as the index holds it. |
| Common-equivalent CE | Under `CE_VERSION`: the certificate's waterfall evaluated at the headline post-money; the common's per-share payout times the fully diluted share count (`post_money / price per share`). Preferred share counts are shares authorized (`basis: "authorized"`, an upper bound on the preference stack). A ratchet, or any term the function does not model, returns `unsupported`. |
| Deadline T | A print-settled contract's last date for R's announcement, and a mark-level binary's last date for the filer's mark to be published. A contract term. |
| Settlement date | For a print-settled contract: when the index holds R's certificate price, and no later than T plus the venue's certificate lag (a contract term: certificates are bought on order). |
| Observation date D | For a contract on a quarter: 00:00 UTC on the 75th day after Q's last day (`observationDate`). |
| n_min | A contract's minimum number of filer families on a label. At least 2 where a consensus or a dispersion is read; the venue may set more. |
| Void | Every position is cancelled and the venue refunds under its own rulebook. A normal outcome, not an error. |

Units: per-share marks and prices in USD; log ratios are natural logs;
time is UTC.

## Rules every contract shares

- **Versions.** The contract names a `methodology_version` (1.0.0 or
  later: 0.x is a draft), a `ce_version` where it uses one, and a
  `rulebook_version`. It settles under those; a later version never
  changes its settlement. *Not built:* the index publishes each series
  under the current methodology version only; a contract naming an
  earlier one settles on the value recomputed from the published rows
  under that version.
- **What enters.** A contract reads the index as published at its
  observation date, its deadline or its settlement date; a row published
  later does not enter. *Not built:* no route serves the index as
  published on a past date; every row records when it was fetched and
  created, so the value can be recomputed from the rows.
- **Corrections.** A correction (a new row plus a `corrections` row)
  published before a contract settles enters. One published after does
  not re-settle: the index publishes it with its diff, and the settled
  value stands.
- **Restricted persons.** The venue's rulebook names them. At least: the
  name's officers, directors, employees and investors with information
  rights; the staff of a contributing filer's valuation process
  (committee, adviser's pricing team, fund administrator), who know a
  mark before it is filed; and, for contracts 3 to 5, the next round's
  investors and counsel, who know its terms before they are public; and,
  for every contract, OpenMarket's operator and anyone who works on the
  index, who see ingested rows and corrections before they publish. The
  index's defence is that it has no financial interest in its own number.

## Contracts that settle on marks (1, 2)

- **Repricing void.** A repricing event announced strictly after listing
  and at or before the as-of of the marks the contract reads voids it
  (`resolveRepricing`). Committees re-mark a name on a new round, a
  tender or an exit, and the name's insiders know of each first; voiding
  removes the one channel by which their knowledge reaches the marks. An
  event after that as-of does not void: a mark reflects what was known
  or knowable at its date.
- **Void on no filing.** The filers the contract reads publish no mark
  on its label by its observation date or deadline, or fewer than n_min
  families do.
- **A filer stops filing.** Its last mark is never carried forward. A
  series is computed from the families present.

## Contracts that settle on the next round (3, 4, 5)

- **The round is the settlement event.** The contract settles on R
  (`resolveNextRound`). A repricing event does not void it: a tender or
  a secondary before R is not R and changes nothing; R itself settles
  it.
- **Void on no print.** No priced round is announced by T.
- **Void on no certificate.** By the settlement date, the index holds no
  certificate for R giving a per-share price for the new series.
- **Exit void.** An acquisition or IPO announced after listing and
  before R voids the contract: no certificate will price a next round.
- **Closing.** The venue closes the contract to new positions at R's
  first public report (any rank; reporting that a round is in talks is
  not yet an announcement, and a venue may close earlier on it).

## Contract 1 — mark-level binary

Pays 1 if a named filer's next disclosed mark on one label of one name
is at or above a strike K; 0 otherwise.

- **Underlying.** The family mark of the named filer F on label L: the
  median of F's funds' per-share marks for one `as_of`, under the named
  `methodology_version`.
- **Observation.** F's next disclosed mark: the first document of F's
  published in the index after listing and by T that carries a
  per-share mark on L with an `as_of` later than F's latest mark on L
  published at listing. The family mark takes every document of F's for
  that `as_of` published by the end of that UTC day. The contract
  resolves on that publication; it does not wait for T.
- **Settlement source and rank.** Filer marks, `filer_mark` ranks: for
  one fund and date, the higher-ranked document stands. A higher-ranked
  document for the same date published after resolution (the N-CSR
  after the N-PORT) does not re-settle, as a correction does not.
- **Formula.** YES iff `M_F ≥ K` (K in USD per share). Terms: name, L,
  F, K, T.
- **Void.** F publishes no per-share mark on L by T (a holding reported
  without a share balance has no per-share mark). A repricing event
  announced after listing and at or before the mark's `as_of`.
- **Why the edge sits with brokers and analysts.** The observation is
  one committee's number, not the company's. Who can call it are the
  people who talk to the GPs and advisers behind F, and the analysts who
  read F's marking history (the index publishes every revision and how
  far F lags a move). A company insider knows the company, not the
  committee; anything they know reaches the mark only through a
  repricing event, which voids the contract. F's own valuation staff
  are restricted persons.

## Contract 2 — dispersion range

A strip of ranges on the dispersion of family marks on one label of one
name at the next filing date; the range that contains it pays 1, the
rest 0.

- **Underlying.** The index's dispersion on `(name, label, Q)` under the
  named `methodology_version`: high minus low across families, as a
  percentage of the median, `100 · (max − min) / median`, with the high
  and low families named.
- **Observation.** The next filing date is the quarter the contract
  lists into (`observedQuarterEnd`: the current quarter with at least 21
  days left, otherwise the next), read at its observation date D: every
  family's latest mark on the label with `as_of` in Q, from documents
  published by D.
- **Settlement source and rank.** Filer marks, `filer_mark` ranks. A
  family whose funds split by more than 0.1 % is flagged
  `intra_family_split`; the flag changes neither the family mark (the
  median of its funds) nor the settlement.
- **Formula.** Range i pays 1 iff `lo_i ≤ dispersion < hi_i`. The
  ranges partition `[0, ∞)`, the last open above; a value on a boundary
  belongs to the higher range. Terms: name, label, Q, the boundaries,
  n_min (at least 2).
- **Void.** Fewer than n_min families on the label for Q by D. A
  repricing event announced after listing and at or before Q's last
  millisecond. A family that stops filing is absent, which can narrow
  the dispersion; that is the risk the contract carries, and n_min
  bounds it.
- **Why the edge sits with brokers and analysts.** Dispersion is the
  disagreement between committees, not a level. No company insider sets
  it or learns it early, and no single filer controls it. The edge is
  knowing each family's policy (who marks to the last round, who to
  secondaries, who lags), which brokers hear from the GPs and analysts
  read in the index's history.

## Contract 3 — mark versus print

A cash-settled forward on where the next priced round lands relative to
the consensus mark.

- **Underlying.** `X = ln(P_R / C_prior)`, where `P_R` is R's certificate
  price and `C_prior` is the consensus on label L for the latest
  calendar quarter that ended before R's announcement and had at least
  n_min families published at that announcement, under the named
  `methodology_version`. Rows published after R's announcement do not
  enter `C_prior`. X is the negative of the index's mark versus print,
  `ln(mark / print price)`, taken at the round. L is named at listing
  (the newest preferred series with at least n_min families).
- **Observation.** R's announcement fixes `C_prior`; the certificate
  fixes `P_R` on the settlement date.
- **Settlement source and rank.** The certificate (`delaware_coi`, rank
  1 for `print_price_and_terms`; no lower rank enters); R by the
  print-side ranks; `C_prior` from filer marks by `filer_mark` rank.
- **Formula.** Per unit notional N, long:

      payout = N · clip(X − X₀, −κ, +κ)

  Short pays the negative; X₀ is the level a position opens at; the
  clip κ is the venue's term. Max gain or loss per position is N·κ.
  Terms: name, L, T, the certificate lag, κ, n_min.
- **Void.** Void on no print by T. No certificate price for the new
  series by the settlement date. An exit before R. No quarter before R
  with at least n_min families on L published at R's announcement.
- **Where the edge sits.** Before R is reported, its insiders (the
  company, the round's investors and counsel) know `P_R`; the contract
  cannot design that away, so it rests on the venue's restricted-person
  rule and on closing at R's first public report. `C_prior` is public
  before R. Among everyone else, the edge is with brokers who see where
  secondaries clear against the marks and analysts who know how far
  committees sit from the rounds that follow, not with the company,
  which neither sets nor sees the marks.

## Contract 4 — perp basis

A cash-settled swap on the log difference between a perp venue's mark
at expiry and the next round's certificate price.

- **Underlying.** `B = ln(P_perp / P_R)`. `P_perp` is the venue's
  published mark price of its perpetual on the name, time-weighted over
  the UTC day of T (the expiry), per share. A perp quoted as a
  valuation converts with the share count the venue publishes for it,
  named in the contract's terms: that count's error is part of the
  tracking error the contract prices. `P_R` is R's certificate price.
- **Observation.** The perp at T; the certificate on the settlement
  date.
- **Settlement source and rank.** The perp mark and share count are the
  venue's, outside this rulebook. The certificate (`delaware_coi`, rank
  1); R by the print-side ranks.
- **Formula.** Per unit notional N, long:

      payout = N · clip(B − B₀, −κ, +κ)

  Terms: name, the perp and its mark source, the share count, T, the
  certificate lag, κ.
- **Void.** Void on no print by T. No certificate price for the new
  series by the settlement date. An exit before R. The venue publishes
  no perp mark for T. R does not void it.
- **Where the edge sits.** The perp venue and the desks hedging its
  positions carry this tracking error and are its natural customers.
  The edge on `P_R` before R is reported is the round's insiders', as in
  contract 3, and is bounded the same way. After R is reported, the
  headline is public but the per-share price is not until the
  certificate is read: the edge is with analysts who read prior
  certificates and model the share count, not with the company.

## Contract 5 — structure spread

A cash-settled forward on how much of the next round's headline is
preference stack.

- **Underlying.** `G = ln(post_money_R / CE_R)`: R's headline post-money
  (the print of round R, by the print-side ranks and revision window,
  as it stands on the settlement date) over the common-equivalent value
  under the named `ce_version`, from R's certificate. This is the
  index's structure gap for R.
- **Observation.** On the settlement date.
- **Settlement source and rank.** The certificate (`delaware_coi`, rank
  1 for `print_price_and_terms`); the post-money by the print-side ranks.
- **Formula.** Per unit notional N, long:

      payout = N · clip(G − G₀, −κ, +κ)

  Terms: name, T, the certificate lag, `ce_version`, κ.
- **Void.** Void on no print: no priced round by T, or R's post-money
  undisclosed by the settlement date. No certificate for R by the
  settlement date. CE returns `unsupported` (a ratchet, or any term the
  function does not model). An exit before R.
- **Where the edge sits.** The terms are the round's insiders' until the
  certificate is filed and bought, which the venue's restricted-person
  rule and closing at R's first report bound. The edge open to everyone
  else is structural: analysts who read the name's earlier certificates
  (seniority, multiples, participation) and know how its rounds are
  usually papered. The company's employees outside the round know the
  terms no better than the certificate states them.

## Not open

OpenMarket quotes, lists and settles none of these contracts. Void on
no print; void and refund are the venue's. Every published number
carries its versions, and a contract settles under the versions it
names. A filer's mark is never adjusted; a missing filing is a missing
row. Every input obeys the source rule (decision `0003` §4).
