# A US founder building valuation contracts on private companies

For policy counsel, trade associations and anyone writing a comment
letter on pre-IPO derivatives. Everything here is public and may be
quoted with a link. Served at `/for-policy`; the rulebook version and
the data links on that page are filled from the repository so the page
never cites a version that is not live.

## Who

Nicholas Adesina, San Francisco. Previously the first engineer on the
current product at Eragon, an enterprise AI company backed by a16z
Speedrun and Khosla Ventures. Building OpenMarket alone.

## What

OpenMarket lists five private companies (OpenAI, Anthropic, Anduril,
Modal, Instinct) with two contracts each, quoted by the venue as
dealer around a published model mid:

- A quarterly timing binary that pays $1 if the company announces a
  priced primary round by the calendar quarter-end. For the two labs
  the event is a public S-1 filing.
- A cash-settled forward on the natural log of the company's next
  post-money valuation against the position's entry, with the payout
  clipped at plus or minus 1.0 log units, that voids with full refund
  if no print occurs by a per-name expiry.

The product OpenMarket sells is the reference price: a published,
versioned blend of the model mid, the traded price and a forecasting
tournament's crowd, for each listed name, through a public API. The
contracts are how the price gets made.

Definitions are in `CONTRACTS.md`; the settlement rulebook is code,
versioned, and published at `/api/ref/rulebook` and in prose at
`/rulebook`. Today the markets are paper money and the tournament is
live.

## How it settles

A print is the post-money of a priced primary equity round, publicly
reported. SAFEs, notes, same-price extensions, secondaries, tenders
and debt are not prints. Sources rank 1 (company or lead-investor
release), 2 (SEC filing), 3 (two independent Tier-1 outlets citing
closed terms), 4 (one Tier-1 outlet). A higher-ranked source within a
seven-day revision window supersedes a settlement. No print by expiry
voids the forward with refund. OpenMarket publishes this hierarchy; it
does not own it, and anyone may adopt it.

## The path

1. Paper markets and a log-scored forecasting tournament, now.
2. A real-money venue offshore, US-geofenced, with the venue as
   dealer, as the bootstrap.
3. A listing on a CFTC-registered designated contract market as the
   business, with the reference price licensed to venues, lenders,
   fund administrators and acquirers.

## The question a founder cannot answer alone

Whether a cash-settled forward on a single private company's next
post-money, settled on a published third-party rulebook rather than a
share price, is a security-based swap under the SEC or a commodity
forward or event contract under the CFTC. The quarterly binary looks
like an event contract. The forward is the gap. The Hyperliquid Policy
Center's August 2026 letter to the SEC, which proposes listing pre-IPO
perps only inside a window after a public S-1 filing with the oracle
disclosed in advance, describes the product OpenMarket's lab binary
already is.

## What the founder will do for a letter

- Be named as a US founder building this product, with the contract
  definitions and rulebook linked.
- Supply the round-history dataset (dates, post-money, source and
  rank for every priced round of the listed names and comparables
  since 2024) and the dispersion of public marks on the listed names.
- Co-sign or file a supporting comment on classification, listing
  eligibility tied to a public S-1 window, and disclosed settlement.

## Links

- Rulebook: `/rulebook` and `/api/ref/rulebook`
- Contracts: `CONTRACTS.md`
- Round-history dataset: `/data/round-history.csv`
- Resolution-source map: `/resolution-sources`
- Reference API: `/ref`
