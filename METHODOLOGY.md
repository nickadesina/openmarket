# OpenMarket methodology

**v0.2.0 — draft, Nick's to sign before the first post.**

This document specifies how OpenMarket turns public filings into the numbers
it publishes. The arithmetic is `src/lib/engine/index/`; every payload names
the version of this document it was computed under (`methodology_version`).
Where this text and that code disagree, the disagreement is a defect and is
corrected as described under [Versioning and corrections](#versioning-and-corrections).

## The unit

The unit of the index is one per-share mark on one security, from one filer,
as of one date, with the document it came from (an EDGAR accession number
where there is one). Every other number OpenMarket publishes is a function of
those rows and of the checked-in data files under `data/index/`, and can be
recomputed from them.

A holding's **per-share mark** is its reported fair value divided by its
reported balance, when the balance is counted in shares (N-PORT `units` =
`NS`) and is greater than zero. Otherwise the per-share mark is empty: the
row counts toward the value a filer holds but not toward any per-share
series. A negative value (a short position) has no per-share mark.

Example. Fidelity Equity Growth K6 Fund (registrant Fidelity Mt. Vernon
Street Trust, CIK 707823) reported, as of 2026-08-31, a holding titled
`ANTHROPIC PBC SERIES F-1 PC PP` with a balance of 1,000 shares and a value of
$777,530.00 (accession 0000035402-26-006778). Its per-share mark is
777,530.00 / 1,000 = $777.53.

## The source rule

Every input is a public filing, a document bought from a public registry, or
a price on a page served without a login. Nothing comes from a direct
message, a leaked letter, a login or a vendor paywall. Forge, Caplight,
Hiive and EquityZen, and any vendor's indicator, are excluded. A source that
cannot be reached under this rule is reported as not covered; it is never
approximated.

## Source classes and ranks

Each source document carries a source class and the rank the rulebook gives
that class. The classes are, in the build brief's default order:

1. `ncsr`: the audited schedule of investments in a fund's N-CSR or N-CSRS.
2. `nport`: Form N-PORT-P.
3. `fund_holdings_page`: a fund's own holdings page (for example Fidelity's
   monthly holdings, ARK Venture's holdings).
4. `closed_end_nav`: a listed closed-end fund's NAV disclosure.
5. `delaware_coi`: a Delaware certificate of incorporation (series terms and
   original issue prices).
6. `form_d`: Form D (SPV vehicles and their offering terms).
7. `spv_quote_page`: a public page quoting units of an SPV.
8. `company_statement`: the company's own statement.
9. `press`: press reports.

The ranks themselves, and which source settles a contract written on the
index, are the rulebook's: published at `/rulebook`, defined in
`src/lib/engine/rulebook.ts`, with changes recorded in
`docs/RULEBOOK_CHANGELOG.md`. This version of the methodology does not
combine classes: rows from two classes for the same fund, label and date are
two rows of that fund, and the fund contributes their median.

## Security labels

The index reports per security. Each holding's title and name, as the filer
wrote them, are read into one canonical label: `Series F Preferred`,
`Series C-1 Preferred`, `Common`, `Convertible Note`, `SAFE`, `SPV interest`,
`Warrant`, or `Unclassified`. Marks on different labels are never pooled.

The rules, applied to the title and then to the name:

- A vehicle that holds the security (`… LLC (invested in …)`, `(economic
  exposure to …)`, `SPV`, `a series of … LLC`, an LLC or LP followed by
  the name of what it holds, or an LLC or LP named as a fund, investors,
  partners, opportunity or co-invest vehicle, such as `Anduril Investors
  LLC, Series G`) is `SPV interest`, whatever it holds.
- A SAFE, a convertible note and a warrant are labelled by their form, even
  when the title also names a series.
- Rights, swaps, loans, and holdings the filer categorizes as debt or a
  derivative are `Unclassified`.
- A series code after `Series`, `Ser`, `Srs` or `Sr` (with a space or a
  dot: `SER.G`), after `Class`/`Cl` on a title that says preferred, or
  before `PC`, is that series of preferred. A number after the letter is
  written with a dash (`SERIES H 1` and `Series H1` are `Series H-1
  Preferred`).
- A title that says common, or names a class with no preferred marker, is
  `Common`, unless the filer categorizes it as preferred equity (EP), when
  it is `Unclassified`. Units of an LLC with no series or common marker are
  `Unclassified`.
- The name is used only when the title names no label. When the title and
  the name name different labels, the holding is `Unclassified`.
- The filer's asset category never names a series. Funds file preferred
  series as common equity (EC); it only says what kind of security an
  otherwise silent title is.

Example. The same security appears as `ANTHROPIC PBC CL F-1 PFD PP
(PHYSICAL) (NOT LISTED OR TRADING)` (Growth Fund of America, 0001193125-26-439060),
`ANTHROPIC PBC SER F-1 CVT PFD PP` (T. Rowe Price Global Stock Fund,
0001099263-26-010105), `ANTHROPIC PBC SERIES F-1 PC PP` (Fidelity,
0000035402-26-006778) and `Anthropic PBC, Series F-1` with asset category EC
(Franklin Growth Opportunities Fund, 0002071691-26-023300). All four are
`Series F-1 Preferred`. A title that is only the issuer's name, such as
`Anthropic PBC`, is `Unclassified`.

Only preferred series and `Common` enter per-share series. `SPV interest`,
`Warrant`, `SAFE`, `Convertible Note` and `Unclassified` rows are kept and
published with the filer's marks, but one of those labels covers instruments
with different terms (vehicle, strike, cap, principal), so a per-share figure
on one is not compared with another's. Example: Tema Photonics & Optical ETF
reported `Anthropic SPV Exposure`, 1,820 units at $2,003,820.00, as of
2026-08-31 (0001193125-26-441394), $1,101.00 per unit. That is a unit of a
vehicle, not a share of the company, and it is not compared with share marks.

## Filer families

Funds under one adviser share a valuation committee and mark a security
identically, so comparing two funds of one adviser measures nothing. The
comparison is between families. `data/index/filer-families.json` maps
registrant CIKs to a family, with the evidence for each grouping; a
registrant it does not list is its own family. The file carries its own
version, and a change to it is published like any other change.

A family's mark on a label as of a date is the median of its funds' marks
(a fund with several rows on that label and date contributes their median).
When its funds' marks differ by more than 0.1 % of the family mark
(`(max − min) / median > intra_family_split_tolerance`), the family mark is
published with the flag `intra_family_split`.

Example. Growth Fund of America (CIK 44201, series S000009228) and New
Economy Fund (CIK 719608, series S000009598) are both Capital Group's American
Funds. As of 2026-08-31 they reported Series F-1 holdings of 2,859,590 shares
at $2,148,467,158.80 (0001193125-26-439060) and 346,983 shares at
$260,695,267.56 (0001193125-26-439062): $751.32 each. Mapped to one family,
they give one family mark of $751.32, without the flag.

## Comparison date

Families are compared only on the same date: a mark's as-of date, the
report date the filing gives (in N-PORT, `repPdDate`, usually a month-end). Funds'
fiscal quarters end in different months, so on a given date only some
families report; a family's mark as of July 31 is never compared with
another's as of August 31, because the gap between them would measure
reporting timing as well as disagreement.

Per label, each as-of date on which any family marked the label is one
point of the series, with every family's mark as of exactly that date. A
family with no mark on that date is absent from it: no mark is carried
forward from an earlier date or back from a later one. A point with fewer
than three families publishes its family marks and no consensus or
dispersion (below).

## Listed names

The index measures private marks. Once an issuer's final IPO prospectus
(Form 424B4) is on EDGAR, a fund's mark on its stock is set from the
market, not by a valuation committee. A mark as of the prospectus's filing
date or later is therefore published with the filer's other marks, but
enters no per-share series: no family mark, consensus, dispersion,
revision or mark versus print. Marks as of an earlier date are unchanged.
The date and the prospectus are recorded in `data/index/watchlist.json`
(`listing`), from EDGAR, never from a report.

Example. SpaceX's final prospectus was filed on 2026-06-12 (424B4,
0001628280-26-042639). Its headline is its consensus on `Common` as of
2026-04-30, $526.59 from four families (BlackRock Global Allocation Fund,
0002071691-26-015449; Fidelity Blue Chip Growth Fund, 0000035402-26-004040;
Franklin Growth Opportunities Fund, 0002071691-26-014424; T. Rowe Price
Global Stock Fund, 0001099263-26-008016; each $526.59 a share); funds'
marks as of 2026-06-30 and after, filed at Level 1 or Level 2 of the
fair-value hierarchy (quoted prices, or quoted prices less a lock-up
discount), are listed-stock marks.

The rule reads the listing date, not a filer's fair-value level: a filer
that files a private holding at Level 1 is a filer's mark like any other
and is not dropped.

## Headline label

A name's daily figure is the consensus on one label as of one date: the
latest as-of date on which any label has a consensus (at least three
families), and on that date the label with the most families. Ties go to
the label with the higher consensus, then to the label that sorts first. A
name with no as-of date on which three families marked one label has no
headline; the daily page says so, with the most families any one date has.
The name page shows every label and every date; the headline only orders
the daily page.

## Consensus mark

Per label per as-of date, the consensus mark is the median of the family
marks as of that date, published with `n_families`. It is published only
with at least 3 families (`min_families_for_consensus`): with two, the
median is the midpoint of two filers' marks, and the figure would be a
statement about one pair of funds rather than a consensus. With an even
number of families the median is the mean of the middle two. The consensus
is never a mean of all marks, and families are not weighted by position
size.

## Dispersion

Per label per as-of date, dispersion is `(max − min) / median` of the family
marks as of that date, in percent, with the high and the low family named.
It is published only with at least 3 families (`min_families_for_dispersion`)
and a median above zero.

Example, Anthropic PBC Series H-1 Preferred as of 2026-08-31. Four families
marked it on that date; one fund's filing stands for each below, and every
fund of each family marked the same per share (development data,
2026-11-07):

| Family | Fund | Shares | Value | Mark | Accession |
| --- | --- | --- | --- | --- | --- |
| Capital Group | AMCAP Fund | 797,780 | $599,388,069.60 | $751.32 | 0001193125-26-439051 |
| Fidelity (FMR) | Fidelity Equity Growth K6 Fund | 1,400 | $1,088,542.00 | $777.53 | 0000035402-26-006778 |
| Strategic Advisers LLC | Strategic Advisers International Fund | 800 | $622,024.00 | $777.53 | 0000035402-26-006887 |
| T. Rowe Price | T. Rowe Price Spectrum Moderate Allocation Fund | 1,622 | $1,280,390.58 | $789.39 | 0001099263-26-011054 |

The consensus is the median of four, (777.53 + 777.53) / 2 = $777.53, with
`n_families` 4. Dispersion is (789.39 − 751.32) / 777.53 = 4.9 %, high
T. Rowe Price, low Capital Group.

Franklin Templeton's latest mark on the series is as of 2026-07-31:
Franklin Growth Opportunities Fund, 67,909 shares at $39,999,046.14
(0002071691-26-023300), $589.01. It enters the 2026-07-31 point (Fidelity,
Franklin Templeton and T. Rowe Price, each $589.01: consensus $589.01,
dispersion under 0.1 %), not the 2026-08-31 one. Version 0.1.0 put it in
the 2026Q3 point with the four August marks, and published a dispersion of
25.8 % that measured when the funds report (see
[Version history](#version-history)).

Example below the threshold. Anthropic Series F-1 Preferred as of
2026-08-31 has two families, Capital Group (Growth Fund of America,
2,859,590 shares at $2,148,467,158.80, 0001193125-26-439060: $751.32) and
Fidelity (Fidelity Equity Growth K6 Fund, 1,000 shares at $777,530.00,
0000035402-26-006778: $777.53). Both marks are published on the name page;
the date has no consensus and no dispersion.

## Mark versus last print

For a mark on a label as of a date, the print is the latest round announced
on or before that date whose certificate of incorporation gives a per-share
price (original issue price) for the newest series; if the newest round's
certificate has not been read, the latest priced round for the mark's own
label. The comparison is `ln(mark / print_pps)`. Without a certificate price
it is empty, with the reason (`no_print_on_or_before_mark`,
`no_certificate_price`, or `zero_mark`).

No example: as of this draft no certificate has been transcribed into
`data/index/certificates/`, so every mark-versus-print value is empty.

## Revisions

A family's revision on a label is the change between two consecutive family
marks on that label when `|ln(new / old)| ≥ 0.005`
(`revision_threshold_ln`). A change to or from a mark of zero is a revision
with no log change. The revision's date is the as-of date of the new mark.

The leader of a revision is the first other family to revise the same label
in the same direction within the 180 days before it
(`leader_window_days`); the revision is a follower, and its lag is the days
from the leader's revision to its own. A revision with no such family leads.
Revisions on the same day do not lead each other. The rule looks at the
direction and date of revisions, not at the level each family moved to.

Example, on the filings above and two earlier ones:

- T. Rowe Price Global Stock Fund marked Series F-1 at 28,526,530.34 / 73,486
  = $388.19 as of 2026-04-30 (0001099263-26-008016) and $589.0095 as of
  2026-07-31: ln(589.0095 / 388.19) = 0.4169, up.
- Growth Fund of America marked it at 1,684,325,676.11 / 2,859,590 =
  $589.0095 as of 2026-05-31 (0001193125-26-323081) and $751.32 as of
  2026-08-31: ln(751.32 / 589.0095) = 0.2434, up.

On these filings T. Rowe Price leads, and Capital Group follows with a
lag of 31 days. Capital Group had marked $589.0095 two months before T. Rowe
Price reached it; the rule does not count that, because it reads revisions,
not levels.

## SPV premium

For a unit quote on a public page, with a per-share price, against the
headline consensus computed from the points as of the capture's date or
earlier (a page rarely says which series a vehicle holds; the payload names
the label and the as-of date used):
`ln(quoted_pps × (1 + upfront_fee) / consensus)`, with the fee-free premium
`ln(quoted_pps / consensus)` beside it. Fees are recorded as percentages. When
the page states no upfront fee, only the fee-free premium is published. The
management fee, carry and the number of vehicle layers are reported as the
page states them and are not modelled.

No example: as of this draft no unit quote has been captured into
`data/index/spv-quotes/`.

## Common-equivalent and structure gap

The common-equivalent conversion has its own version, `ce_version` 0.1.0. It
evaluates the liquidation waterfall in a certificate of incorporation at the
headline post-money valuation of a round:

- Fully diluted shares are `headline / pps`, where `pps` is the round's
  per-share price. Preferred share counts are shares authorized (`basis:
  "authorized"`), so the stack evaluated is at least the stack outstanding.
  Common is fully diluted shares less every preferred series as converted
  (shares × original issue price / conversion price).
- Preferences are paid by seniority (1 is most senior); series of equal
  seniority share pro rata by preference. A series' preference is its
  liquidation multiple × original issue price × shares.
- What is left is shared pro rata by as-converted shares among common,
  converted series and participating series. A participation cap is total
  proceeds as a multiple of original issue price; a capped series takes no
  more than its cap.
- A non-participating series, and a capped participating series, converts to
  common when converting pays it more. Series are considered in order of the
  value per as-converted share at which converting pays, and the outcome is
  the first set of conversions in which no series would do better by
  choosing the other way.

The common-equivalent value is common's per-share payout at the headline
times fully diluted shares. The structure gap is
`ln(headline / common_equivalent)`. With every series 1× non-participating,
converting one for one, and none issued above the round's price, the gap
is 0.

Limits of 0.1.0. The function returns `{ status: "unsupported", reason }`,
and the name is published per series only, for: a ratchet (including one
conditioned on an IPO price); any term the transcription records that the
function does not model (cumulative dividends, redemption rights,
pay-to-play, and the like); preferred authorized, as converted, at or above
the fully diluted share count; common receiving nothing at the headline; and
no stable set of conversions. It treats every fully diluted share that is not
preferred (options, warrants, the pool) as common with no exercise price. It
evaluates one equity value, the headline; it says nothing about exits at
other values.

No example: as of this draft no certificate has been transcribed.

## Lag

N-PORT-P is public only after a delay. In the filings cited here, each
fund's public report covers the last month of one of its fiscal quarters and
was filed 54 to 60 days after that date (for example, 0001193125-26-439060:
period 2026-08-31, filed 2026-10-30). Every page states the lag. A date's
point gains families as late filers' reports for that date arrive, so its
consensus and dispersion can change; each payload carries the `as_of` it was
computed at.

## What is never done

- A filer's mark is never adjusted, interpolated, smoothed, carried forward
  or filled. A missing filing is a missing row.
- Marks on different labels are never pooled, marks as of different dates
  are never compared, and funds are never compared in place of families.
- The consensus is never a mean, and no family is weighted by position size.
- Nothing is forecast, no model mid is published, and no view is given on
  where a name should trade.

## Constants

Every constant of this version, as `src/lib/engine/index/methodology.ts`
exports it and `/api/ref/methodology` publishes it:

| Constant | Value | Meaning |
| --- | --- | --- |
| `methodology_version` | `0.2.0` | This document's version. |
| `ce_version` | `0.1.0` | The common-equivalent conversion's version. |
| `ce_basis` | `authorized` | Preferred share counts in the waterfall are shares authorized. |
| `per_share_units` | `NS` | A per-share mark is computed only for holdings counted in shares. |
| `revision_threshold_ln` | `0.005` | Smallest \|ln(new / old)\| that is a revision. |
| `leader_window_days` | `180` | Days before a revision in which its leader is sought. |
| `intra_family_split_tolerance` | `0.001` | Spread among a family's funds, as a fraction of the family mark, above which the family mark is flagged. |
| `min_families_for_consensus` | `3` | Fewest families on one label and as-of date for which a consensus is published. |
| `min_families_for_dispersion` | `3` | Fewest families on one label and as-of date for which dispersion is published. |

## Versioning and corrections

Every payload opens with `methodology_version`, `ce_version`,
`rulebook_version` and `as_of`. A change to a rule or a constant in this
document is a new version, published with a diff; a published version is
never edited. Versions 0.x are drafts; 1.0.0 is the version in force at the
first post.

A correction to a published number is a new row and an entry at
`/corrections` (`/api/ref/corrections`): what changed, why, the diff, and
the rows affected. A row is never edited in place; the corrected row
supersedes it. Corrections are of three kinds: a row (a filing read wrong),
the methodology (a rule changed), or a parser (a reading rule changed).

## Version history

Each version is published with a correction of kind `methodology` at
`/corrections`, carrying the diff.

### 0.2.0 (2026-11-07, draft)

What changed:

- **Comparison date.** Consensus and dispersion are computed per label per
  as-of date, from each family's mark on exactly that date, not per
  calendar quarter from each family's latest mark in it.
- **Three families.** A consensus needs three families on the label and
  date (`min_families_for_consensus`, new), and so does dispersion
  (`min_families_for_dispersion`, 2 → 3). A date with fewer publishes its
  family marks only.
- **Headline.** The latest as-of date with a consensus, and on it the
  label with the most families. A name without one has no headline and
  says why.
- **SPV premium** reads the headline among the points as of the capture's
  date or earlier.
- **Payloads** (breaking): a consensus point's `quarter`, `quarter_start`
  and `quarter_end` are replaced by `as_of`, and its `consensus_usd` is
  null below three families (its `mark_vs_print` is then `none`,
  `no_consensus`); the name's `headline.quarter` and the names list's
  `quarter` are `as_of`; an SPV premium's `consensus_quarter` is
  `consensus_as_of`; `no_headline` (code and reason) is new on the name and
  on each names row.

Why:

1. **Mismatched dates.** Under 0.1.0 families whose fiscal quarters end in
   different months were compared across different as-of dates. Anthropic
   PBC Series H-1 Preferred, 2026Q3, showed dispersion 25.8 %, low Franklin
   Templeton $589.01; Franklin's mark is as of 2026-07-31 and the other four
   families' as of 2026-08-31 ($751.32 to $789.39, 4.9 % apart). The gap
   was reporting timing, not disagreement between committees.
2. **Two families.** With two families the median is their midpoint and the
   dispersion is one pairwise gap that names both funds as the high and the
   low. A name whose only labelled filers were two families showed a
   dispersion of 83.6 % as its headline, while the other filers' marks on
   that issuer (titles naming only the issuer, so `Unclassified`) stayed
   outside every series. A headline that is a statement about two named
   funds is not a consensus.

What moves: names whose latest consensus mixed months now lead with a
single date (Anthropic: Series H-1 Preferred as of 2026-08-31, $777.53 from
four families, dispersion 4.9 %, was $777.53 from five, 25.8 %); names with
no date on which three families mark one label have no headline. The diff
is `docs/corrections/methodology-0.2.0.md`.

### 0.1.0 (2026-11-04, draft)

The first draft: consensus and dispersion per label per calendar quarter,
from each family's latest mark in it; dispersion from two families.
