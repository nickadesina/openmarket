# Reference feed, design-partner trial

For anyone who has to show a private-company mark today: a trading
front end, a prime broker, a fund administrator, an index provider, a
lender. Served at `/ref/trial`.

## What you get

- The reference price for each listed name (OpenAI, Anthropic,
  Anduril, Modal, Instinct), both contracts: the binary's probability
  of a priced round by quarter-end and the forward's reference level
  in dollars, with the model's forecast log and the dealer's quote
  history.
- Every payload carries `model_version`, `rulebook_version`,
  `blend_version` and `as_of`, so a price can be cited and reproduced.
- A keyed tier: 600 requests a minute, 60-second cache, the same day
  you ask. The public tier is 60 a minute per network without a key.
- The round-history dataset and the backtest's public outputs.
- A year, free. If the venue starts charging before then, your key
  keeps its terms to the end of the year.

## What you agree to

- When the price appears anywhere a third party can see it, cite
  OpenMarket and the three versions.
- If a price looks wrong, tell us within a week. A rulebook or model
  issue found by a partner is credited in the rulebook changelog.
- One call a quarter on what you do with the feed. That is the whole
  price.

## What it is not

- Not a valuation, an appraisal or investment advice. The reference
  price is a published blend of a model, a dealer's traded price on a
  paper or real-money book and a forecasting crowd, with the weights on
  a published schedule. With no flow and no crowd the reference is the
  model mid and the payload says so.
- Not a guarantee of availability. The feed may change with a version
  bump, never silently, and may be withdrawn with thirty days' notice.
- Not exclusive. Any partner may be named publicly as a design partner
  only with their agreement.

## How to start

Send the name of the desk or product and the address the key should
go to. The key is shown once; only its hash is stored. Docs at `/ref`.
