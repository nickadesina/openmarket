# Product

## Register

product

## What it is

A published index of private-company marks, built only from public
filings (decision `0003`). For each watchlist name it shows what registered
funds say a share is worth, filing by filing, the consensus across filer
families, and how far the families disagree, with every figure linked to
the document it came from. It also lays out the round structure behind a
headline valuation (Delaware certificates) and the SPV vehicles in a name
(Form D).

## Users

Analytical readers who need a reference for private-company value and want
to check it: fund administrators and valuation committees, allocators,
lenders, venues that may license the feed, and journalists. They arrive at
the daily page or at one name's page from a post. No account, no sign-in;
the API and the CSVs serve the same numbers to machines (CC BY 4.0).

## Limits (what the index never says)

- No quote, no model mid, no forecast, no view on where a name should
  trade. Nothing on the site prices anything; `CONTRACTS.md` specifies
  contracts others may list against the index, and OpenMarket lists none.
- A filer's mark is never adjusted, interpolated, smoothed, carried forward
  or filled. A missing filing is a missing row; a name no fund files on is
  listed with the reason, not estimated.
- Marks on different securities are never pooled; funds under one adviser
  are one family; the consensus is a median, never a mean, and never
  weighted by position size.
- A number that cannot be computed from rows is not shown: the page says
  what is missing (no certificate transcribed, no unit quote captured, one
  family only).

## The lag

N-PORT-P, the main source, is public about 60 days after the month-end it
reports. Every page and payload states it; the latest quarter can change as
late reports arrive, and every payload carries the `as_of` it was computed
at.

## The source rule

Every input is a public filing, a document bought from a public registry,
or a price on a page served without a login. Nothing from a DM, a leaked
letter, a login, a paywall or a vendor indicator; Forge, Caplight, Hiive
and EquityZen are excluded. A source that fails the rule is reported as not
covered, never imitated.

## Brand personality

Institutional, analytical, restrained. Calm under scrutiny: the filing and
the arithmetic, stated plainly, with the version that produced each number.

## Anti-references

Not a trading terminal, not a crypto dashboard, not a valuation vendor's
teaser. No hype language, no "fair value" claims, no colour used as
decoration, no invented density.

## Design principles

1. Provenance before polish: every figure links to its document.
2. Show the disagreement, not a single answer.
3. Say what is missing and why, in the place the number would be.
4. Versions on everything published; corrections are new versions with a
   diff.
5. Dense, legible tables over cards; one chart per security.

## Accessibility & inclusion

Meet WCAG 2.2 AA. Every chart has a text summary and the table it draws;
movement and status never rely on colour alone; focus is visible; tables
scroll inside their own box at phone width rather than the page.
