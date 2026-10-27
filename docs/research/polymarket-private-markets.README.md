# Polymarket markets on private companies

Fetched 2026-10-27T19:10:42.823Z by `scripts/research/polymarket-private-markets.ts`. Private research input; not published.

What it pulled: every market whose own question names OpenAI, Anthropic, Stripe, Databricks, Kraken, SpaceX or xAI, found through Polymarket's public Gamma search (https://gamma-api.polymarket.com/public-search, open and closed events). One row per market and company; a market that names two companies appears under each.

- `resolution_source` is the market's (or its event's) resolution source field as Gamma returns it, often empty; `resolution_text` is the market's description, which carries the resolution rules.
- `outcome` is the outcome whose final price is 1 once UMA marks the market resolved; empty otherwise.
- `last_yes_price_before_close` is the YES token's last daily point at or before the market's close, from the CLOB price history (https://clob.polymarket.com/prices-history, fidelity one day). Open markets have Gamma's `last_trade_price` only.
- `valuation_topic` flags questions about valuation, rounds, listings or acquisitions, by keyword; the rest (model releases, benchmarks) are kept for completeness.

Counts this run:
- OpenAI: 885 markets from 572 matching events.
- Anthropic: 709 markets from 508 matching events.
- Stripe: 101 markets from 38 matching events.
- Databricks: 102 markets from 31 matching events.
- Kraken: 663 markets from 250 matching events.
- SpaceX: 1484 markets from 416 matching events.
- xAI: 147 markets from 162 matching events.
- 4091 rows in all.
