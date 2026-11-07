# Rulebook changelog

Newest first. A version changes only by a new entry here and a new
`RULEBOOK_VERSION`; a published version is never edited.

## 2.1.0 (2026-11-07)

Follows methodology 0.2.0, which compares filer families only on the
same as-of date and publishes a consensus or a dispersion only from
three families. The marks family's settlement rule now reads "the
spread of filer families' marks on one as-of date within the
contract's quarter" (it read "on a quarter"). Calendar quarters remain
the contracts' observation windows; no other rule changes.

## 2.0.0 (2026-11-04)

The rulebook of the marks index (decision 0003). Nothing settles at
OpenMarket: the contracts in `CONTRACTS.md` settle on the index, and a
venue that lists one names this version in its rulebook.

Kept, same rule: what a print is (the post-money of a priced primary
round; an IPO's first-day close for the labs), the announcement rule,
source ranks 1 to 4 with the Tier-1 outlets and syndication, the
seven-day revision window and the one-day observation grace. Two
conversions are reworded without the dealer's settlement: a range
"counts" at its midpoint, and a price per share alone "is not a
post-money". Every row of `data/round-history/events.csv` classifies as
it did under 1.0.0, and every forward settlement 1.0.0 recorded is a
print at the same post-money under 2.0.0.

Added:

- The mark side: nine source classes (`ncsr`, `nport`,
  `fund_holdings_page`, `closed_end_nav`, `delaware_coi`, `form_d`,
  `spv_quote_page`, `company_statement`, `press`), each with its
  document, cadence, lag and access, ranked within five purposes (a
  filer mark; a round's per-share price and terms; a round's size and
  date; an SPV's existence and terms; a unit quote). An audited N-CSR
  ranks above the N-PORT for the same fund and date; a Delaware
  certificate ranks first for per-share price and terms. A rank orders
  sources within one purpose and never across them, and never weighs
  one filer against another. `sourceRank` gives the rank ingest stores
  on `source_documents.source_rank`.
- The rules the contracts on the index share, in two families. Those
  that settle on marks (mark-level binary, dispersion range): the
  observation date (75 days after the quarter ends), the listing floor
  (21 days, decision 0002's), the repricing void (a priced round,
  tender, public S-1, IPO or acquisition announced before the marks'
  as-of, valuation disclosed or not), void on no filing, a filer that
  stops filing. Those that settle on the next priced round (mark versus
  print, perp basis, structure spread): the round is the settlement
  event and does not void them; void on no print by the deadline; void
  on no certificate price for the new series; an acquisition or IPO
  first voids. For all: corrections after settlement do not re-settle,
  and versions.
- `resolveNextRound`: the next priced round after listing, or a void on
  no print or on an exit.
- `resolvePrints` and `lastPrint`: every print a name has had, each
  standing on the best-ranked source in its revision window, and the
  print in force at a date.

Changed:

- `charter` becomes `certificate`. A certificate of incorporation is
  never a print (it states no post-money); it no longer re-centres a
  model mid, because v2 has none.
- `revision` no longer refers to an instrument's expiry.

Removed, with the reason:

- `binary` (the quarterly timing binary: YES on a round by
  quarter-end, labs on a public S-1, its roll) and `forward` (the
  next-print forward: settle on the first print after open, void and
  refund collateral on no print, acquisitions, roll). They were the
  dealer's two instruments, archived at `archive/dealer-v1`. What the v2
  contracts reuse survives under new names: the binary's window test
  as `resolveRepricing` (now on every repricing event) and
  `resolveNextRound`, its 21-day expiry floor as `observedQuarterEnd`,
  and the forward's revision logic as `resolvePrints` and its void on
  no print in `resolveNextRound`.
- `resolveBinary`, `resolveForward`, `binaryExpiry`, `resolvesBinary`,
  the `BinaryEvent` type (a name's lab status is now `NameKind`) and the
  dealer's flag fields on the round terms type (`lead`, `pps_usd`,
  `outlet`, `quote`, none load-bearing).
- `review` (rank 1 and 2 auto-resolve, a 24-hour queue for ranks 3 and
  4): the dealer's settle job read it, and nothing settles at
  OpenMarket now.
- The three not-built notes (charter re-centring, the rank 3 and 4
  review queue, the correcting settlement). Each described archived
  dealer code. The not-built notes at 2.0.0 are the index's own: no
  route yet serves the index as published on a past date, and the
  index publishes under one methodology version at a time.

`tests/fixtures/rulebook-events.json` is re-baselined: the binary's
quarters and the forward's lives give way to each name's prints and
each calendar quarter's repricing window.

## 1.0.0 (2026-10-21)

First published version. A print is the post-money of a priced
primary round (IPO first-day close for the labs); source ranks 1 to 4;
seven-day revision window; one-day observation grace; the binary's
event window and 21-day expiry floor per decision 0002; no print by
expiry voids the forward with full refund; an acquisition settles at a
disclosed equity value or voids. Rules marked not built in
`CONTRACTS.md` (charter re-centring, rank 3 and 4 review queue,
correcting settlement) are the contract's intent and are not enforced
by the code at this version.
