# First-maker slot

What OpenMarket offers a market maker or prop desk before the real-
money venue opens. This page promises a dated place in line and
nothing else. It is sent as is; it is not a term sheet.

## What a slot is

The first right to quote as a second dealer on OpenMarket's listed
names (OpenAI, Anthropic, Anduril, Modal, Instinct; two contracts each)
when the real-money venue opens, on the public rulebook, with the
position cap and spread floor published at that time. Slots are
numbered in the order accepted. A slot holder sees maker terms before
any desk without one and may decline them.

## What you can read today

- The settlement rulebook, versioned, at `/rulebook` and
  `/api/ref/rulebook`.
- The contract definitions in `CONTRACTS.md`: a quarterly timing
  binary and a cash-settled forward on the next post-money, clipped at
  plus or minus 1.0 log units, void with refund on no print by a per-
  name expiry.
- The reference price and the model's forecast log for each name at
  `/api/ref/[slug]` and `/api/ref/[slug]/mids`, public and unredacted.
- The paper books at `/m`, where the venue quotes both contracts as
  dealer.
- The backtest's public outputs at `/data/backtest/`: the prior's
  calibration error per print, void rates by name, and resolutions
  per quarter.
- The round-history dataset at `/data/round-history.csv`.

## What you cannot read, by design

The construction of the model mid, the dealer's depth and cap
parameters, the blend weights, and any other desk's terms. A slot does
not change that until terms exist and are offered.

## What accepting means

Nothing binding on either side. Your desk is entered in a register
with a slot number and date. You receive the terms first when they
exist, and the reference feed on a design-partner key if you want it
before then. You may withdraw at any time by saying so.

## Expiry

A slot expires if the real-money venue has not opened within twelve
months of the slot date. Expired slots are listed as such and may be
renewed by asking.

## Why this is worth having

A dealer-made book with a hard position cap and a published mid is
bounded risk with a known counterparty rule, on five names that have
no other two-sided market. The first desks to quote it set the
spreads the rest of the market inherits.

Contact: Nick Adesina, by X DM or the address on the site.
