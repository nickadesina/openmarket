Methodology 0.1.0 → 0.2.0 (METHODOLOGY.md, "Version history"). No filer's
row changes; every derived figure is recomputed from the same rows.

**What changed**

| | 0.1.0 | 0.2.0 |
| --- | --- | --- |
| Comparison date | Calendar quarter; each family's latest mark in it | The mark's as-of date; each family's mark on exactly that date, none carried forward |
| Consensus | From one family | From 3 families (`min_families_for_consensus`, new) |
| Dispersion | From 2 families | From 3 families (`min_families_for_dispersion`) |
| Headline | Latest quarter with a consensus | Latest as-of date with a consensus; none, with the reason, when no date has 3 families on one label |
| Payload | `quarter`, `quarter_start`, `quarter_end`; `headline.quarter`; `consensus_quarter` | `as_of`; `headline.as_of`; `consensus_as_of`; `consensus_usd` null below 3 families; `no_headline` |

**Why.** Families whose fiscal quarters end in different months were
compared across different dates: Anthropic Series H-1 Preferred, 2026Q3,
showed 25.8 % dispersion with the low family's mark as of 2026-07-31 and the
other four as of 2026-08-31 ($751.32 to $789.39). And with two families the
median is a midpoint and the dispersion one pairwise gap that names both
funds: a name whose only labelled filers were two families led the daily
page with 83.6 %.

**What moves.** The daily page's headline per name, development data
recomputed 2026-11-07 under families 0.1.0 (production moves the same way;
its figures depend on what it has ingested):

| Name | 0.1.0: label, quarter | Consensus | Families | Dispersion | 0.2.0: label, as of | Consensus | Families | Dispersion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Anduril | Series H Preferred, 2026Q3 | $68.95 | 5 | 6.6 % | Series H Preferred, 2026-08-31 | $70.69 | 4 | 6.4 % |
| Anthropic | Series H-1 Preferred, 2026Q3 | $777.53 | 5 | 25.8 % | Series H-1 Preferred, 2026-08-31 | $777.53 | 4 | 4.9 % |
| ByteDance | Series E-1 Preferred, 2026Q3 | $342.99 | 2 | 7.3 % | Series E-1 Preferred, 2026-06-30 | $334.24 | 3 | 5.0 % |
| Canva | Common, 2026Q3 | $1,448.21 | 7 | 37.2 % | Common, 2026-08-31 | $1,401.57 | 5 | 22.0 % |
| Databricks | Series G Preferred, 2026Q3 | $253.00 | 6 | 5.2 % | Common, 2026-08-31 | $253.00 | 5 | 0.0 % |
| Epic Games | Common, 2026Q2 | $393.14 | 2 | 83.6 % | None: at most 2 families on one date | | | |
| Figure AI | Common, 2026Q3 | $194.86 | 1 | | None: at most 1 family on one date | | | |
| Harvey | Series F Preferred, 2026Q2 | $33.64 | 1 | | None: at most 1 family on one date | | | |
| Mercor | Series C Preferred, 2026Q2 | $763.00 | 1 | | None: at most 1 family on one date | | | |
| OpenAI | Series C Preferred, 2026Q3 | $687.69 | 5 | 8.1 % | Series C Preferred, 2026-08-31 | $687.69 | 3 | 6.7 % |
| Perplexity | Series E-1 Preferred, 2026Q3 | $69.54 | 1 | | None: at most 1 family on one date | | | |
| Plaid | Common, 2026Q3 | $287.43 | 2 | 5.7 % | None: at most 2 families on one date | | | |
| Ramp | Common, 2026Q2 | $120.00 | 3 | 0.0 % | Common, 2026-06-30 | $120.00 | 3 | 0.0 % |
| Revolut | Common, 2026Q2 | $1,707.48 | 2 | 36.3 % | None: at most 2 families on one date | | | |
| SpaceX | Common, 2026Q2 | $526.59 | 4 | 0.0 % | Common, 2026-04-30 | $526.59 | 4 | 0.0 % |
| Stripe | Common, 2026Q3 | $63.00 | 3 | 0.7 % | Common, 2026-07-31 | $63.00 | 3 | 0.7 % |
| xAI | Series C Preferred, 2026Q1 | $75.46 | 3 | 0.0 % | Series C Preferred, 2025-12-31 | $75.46 | 3 | 11.5 % |

Anysphere, Rippling and Scale AI had no headline under either version (no
live mark). Every name's 0.2.0 headline is recorded with this correction
(`affected.headlines`).
