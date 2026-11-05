# OpenMarket methodology

**v0.1.0 — draft, Nick's to sign before the first post.**

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
`docs/RULEBOOK_CHANGELOG.md`. Version 0.1.0 of this methodology does not
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

Funds' fiscal quarters end in different months. A family's mark enters the
calendar quarter its as-of date falls in, and within a calendar quarter each
family contributes its latest mark on the label. Marks from different months
of one quarter are therefore compared with each other; a revaluation inside
the quarter shows as dispersion.

## Consensus mark

Per label per calendar quarter, the consensus mark is the median of the
family marks, published with `n_families`. With an even number of families
the median is the mean of the middle two. The consensus is never a mean of
all marks, and families are not weighted by position size.

## Dispersion

Per label per calendar quarter, dispersion is `(max − min) / median` of the
family marks, in percent, with the high and the low family named. It is
published only with at least 2 families (`min_families_for_dispersion`) and a
median above zero.

Example, 2026Q3, Anthropic PBC Series F-1 Preferred, on eight filings (not
every filer of the quarter):

| Family | As of | Shares | Value | Mark | Accession |
| --- | --- | --- | --- | --- | --- |
| Capital Group | 2026-08-31 | 2,859,590 | $2,148,467,158.80 | $751.32 | 0001193125-26-439060 |
| Fidelity Mt. Vernon Street Trust | 2026-08-31 | 1,000 | $777,530.00 | $777.53 | 0000035402-26-006778 |
| T. Rowe Price International Funds | 2026-07-31 | 73,486 | $43,283,952.12 | $589.0095 | 0001099263-26-010105 |
| Franklin Strategic Series | 2026-07-31 | 49,656 | $29,247,855.73 | $589.0095 | 0002071691-26-023300 |
| NYLIM Funds | 2026-07-31 | 147,622 | $86,950,760.41 | $589.0095 | 0002071691-26-022387 |

(Capital Group's row is Growth Fund of America's; New Economy Fund's mark is
the same, above.) The consensus is the median of five, $589.0095, with
`n_families` 5. Dispersion is (777.53 − 589.0095) / 589.0095 = 32.0 %, high
Fidelity Mt. Vernon Street Trust, low Franklin Strategic Series (the three
July marks agree to four decimals; Franklin's, $589.00949996 before
rounding, is the lowest).
Here the dispersion separates the July 31 marks from the August 31 marks.

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
consensus mark on the label the vehicle holds:
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
period 2026-08-31, filed 2026-10-30). Every page states the lag. A quarter's
consensus can change as late filers' reports arrive; each payload carries
the `as_of` it was computed at.

## What is never done

- A filer's mark is never adjusted, interpolated, smoothed, carried forward
  or filled. A missing filing is a missing row.
- Marks on different labels are never pooled, and funds are never compared
  in place of families.
- The consensus is never a mean, and no family is weighted by position size.
- Nothing is forecast, no model mid is published, and no view is given on
  where a name should trade.

## Constants

Every constant of this version, as `src/lib/engine/index/methodology.ts`
exports it and `/api/ref/methodology` publishes it:

| Constant | Value | Meaning |
| --- | --- | --- |
| `methodology_version` | `0.1.0` | This document's version. |
| `ce_version` | `0.1.0` | The common-equivalent conversion's version. |
| `ce_basis` | `authorized` | Preferred share counts in the waterfall are shares authorized. |
| `per_share_units` | `NS` | A per-share mark is computed only for holdings counted in shares. |
| `revision_threshold_ln` | `0.005` | Smallest \|ln(new / old)\| that is a revision. |
| `leader_window_days` | `180` | Days before a revision in which its leader is sought. |
| `intra_family_split_tolerance` | `0.001` | Spread among a family's funds, as a fraction of the family mark, above which the family mark is flagged. |
| `min_families_for_dispersion` | `2` | Fewest families for which dispersion is published. |

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
