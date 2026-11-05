# Filers per name

Fetched 2026-11-04T23:40:03.716Z by `npm run index:search` (EDGAR full-text search), filings dated 2019-01-01 to 2026-11-04; families from `data/index/filer-families.json` version 0.1.0. The rows behind every count are in `filings-by-name.csv`.

A filing counts when its text has one of the name's `search_phrases` as an exact phrase (`data/index/watchlist.json`); amendments (`/A`) count with their form. A phrase in a fund's text is not yet a holding: `npm run index:ingest -- --source=nport` reads each N-PORT's holdings against the name's `match_pattern`. Registrants are distinct filer CIKs; families group registrants under one adviser, and a CIK in no family is its own.

## The densest five (watchlist, by families filing N-PORT)

N-PORT lists a fund's holdings; N-CSR text also names companies in shareholder letters and commentary, so the N-PORT family count is the comparison set the index can use.

1. SpaceX: 202 families file N-PORT naming it; 223 families, 610 registrants and 4856 filings across the three forms.
2. Databricks: 40 families file N-PORT naming it; 41 families, 130 registrants and 7380 filings across the three forms.
3. Plaid: 29 families file N-PORT naming it; 29 families, 43 registrants and 1201 filings across the three forms.
4. xAI: 27 families file N-PORT naming it; 32 families, 88 registrants and 754 filings across the three forms.
5. Anthropic: 21 families file N-PORT naming it; 43 families, 135 registrants and 956 filings across the three forms.

## Every name, densest first

| Name | Slug | Watchlist | NPORT-P | N-CSR | N-CSRS | Filings | Registrants | Families | N-PORT families | Latest filed |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| SpaceX | `spacex` | yes | 4104 | 322 | 430 | 4856 | 610 | 223 | 202 | 2026-11-04 |
| Databricks | `databricks` | yes | 6414 | 487 | 479 | 7380 | 130 | 41 | 40 | 2026-11-03 |
| Plaid | `plaid` | yes | 1093 | 57 | 51 | 1201 | 43 | 29 | 29 | 2026-10-30 |
| xAI | `xai` | yes | 630 | 68 | 56 | 754 | 88 | 32 | 27 | 2026-09-16 |
| Anthropic | `anthropic` | yes | 717 | 121 | 118 | 956 | 135 | 43 | 21 | 2026-10-30 |
| Stripe | `stripe` | yes | 4212 | 207 | 196 | 4615 | 53 | 24 | 20 | 2026-10-28 |
| Epic Games | `epic-games` | yes | 3012 | 235 | 225 | 3472 | 50 | 25 | 18 | 2026-10-30 |
| OpenAI | `openai` | yes | 524 | 204 | 143 | 871 | 182 | 81 | 16 | 2026-10-30 |
| Canva | `canva` | yes | 2832 | 261 | 270 | 3363 | 74 | 23 | 16 | 2026-10-29 |
| Anduril | `anduril` | yes | 486 | 86 | 88 | 660 | 67 | 14 | 12 | 2026-10-30 |
| Revolut | `revolut` | yes | 180 | 65 | 31 | 276 | 33 | 11 | 7 | 2026-10-26 |
| ByteDance | `bytedance` | yes | 2338 | 326 | 309 | 2973 | 75 | 19 | 6 | 2026-10-27 |
| Ramp | `ramp` | yes | 22 | 9 | 7 | 38 | 7 | 7 | 5 | 2026-10-05 |
| Figure AI | `figure-ai` | yes | 82 | 5 | 8 | 95 | 8 | 4 | 4 | 2026-10-30 |
| Perplexity | `perplexity` | yes | 37 | 3 | 3 | 43 | 7 | 3 | 3 | 2026-10-07 |
| Instinct | `instinct` | candidate | 183 | 114 | 116 | 413 | 32 | 13 | 2 | 2026-11-03 |
| Neuralink | `neuralink` | candidate | 28 | 3 | 3 | 34 | 2 | 2 | 2 | 2026-10-07 |
| Mercor | `mercor` | yes | 3 | 1 | 1 | 5 | 2 | 2 | 2 | 2026-08-31 |
| Rippling | `rippling` | yes | 1 | 55 | 9 | 65 | 41 | 26 | 1 | 2026-08-31 |
| Harvey | `harvey` | yes | 6 | 2 | 2 | 10 | 2 | 1 | 1 | 2026-08-27 |
| Shein | `shein` | candidate | 2 | 0 | 1 | 3 | 1 | 1 | 1 | 2026-10-26 |
| Scale AI | `scale-ai` | yes | 0 | 9 | 2 | 11 | 11 | 11 | 0 | 2026-11-04 |
| Anysphere (Cursor) | `anysphere` | yes | 0 | 0 | 1 | 1 | 1 | 1 | 0 | 2026-09-04 |
| Cognition | `cognition` | candidate | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — |
| Modal | `modal` | candidate | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — |
| Safe Superintelligence | `safe-superintelligence` | candidate | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — |
| Thinking Machines Lab | `thinking-machines` | candidate | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — |

No query reached EDGAR's 10,000-hit ceiling after narrowing by date.
