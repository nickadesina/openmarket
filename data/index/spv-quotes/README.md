# SPV unit quotes

One JSON file per capture of a public page quoting units of an SPV on a
watchlist name, at `data/index/spv-quotes/<issuer slug>/<YYYY-MM-DD>-<platform>.json`.
The schema is `src/lib/ingest/parse/spv-quote.ts` (zod). `npm run
index:spv-quotes` validates every file (`-- --check` stops there) and
imports it: a `source_documents` row of class `spv_quote_page` (the page's
URL, its SHA-256 as content, the capture time as fetched) and an
`spv_quotes` row. A rerun changes nothing.

A capture is admitted only from a page served without a login and not
disallowed by robots.txt (decision 0003 §4). Never a platform the source
rule excludes (Forge, Caplight, Hiive, EquityZen) and never a vendor's
price indicator: a quote is a stated price for a unit of a named vehicle.
There is no scraper; a file records a page someone opened and saved. No
file is committed for a quote that was not captured from a real page. As
of 2026-11-05 no qualifying page has been found
(`data/index/sources-status.md`, "SPV unit quotes"), so this folder holds
no capture and the SPV panel runs on Form D alone.

| Field | What it holds |
| --- | --- |
| `schema_version` | `0.1.0`. |
| `issuer` | The watchlist slug; the folder name. |
| `platform` | Who publishes the page. |
| `url` | The page, https. |
| `captured_at` | When it was captured, ISO 8601 with a zone. |
| `page_sha256` | SHA-256 of the page's HTML as served (save it, `shasum -a 256`). |
| `robots_allowed`, `login_required` | `true` and `false`: checked at capture, or there is no file. |
| `vehicle_cik` | The vehicle's CIK when the page names one that files Form D; links the quote to `spv_vehicles`. Null otherwise. |
| `quoted_price_per_share_usd` | The price per underlying share the page states for a unit; null if it states only a valuation. |
| `quoted_valuation_usd` | The company valuation the page states the unit at; null if none. One of the two is required. |
| `upfront_fee_pct`, `mgmt_fee_pct`, `carry_pct` | Fees as percentages (`5` is 5 %), as stated; null when the page does not state one. |
| `layers` | Vehicles between the buyer and the share: 1 for a direct SPV. |
| `quoted_text` | The page's own words for the price, quoted. |
| `captured_by` | Who took the capture. |

The SPV premium (METHODOLOGY.md, "SPV premium") is computed from a quote
with a per-share price against the consensus on the label the vehicle
holds; fees are reported, not modelled.
