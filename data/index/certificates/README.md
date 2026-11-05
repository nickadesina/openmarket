# Certificates of incorporation

One JSON file per Delaware certificate of incorporation (restated, or an
amendment), at `data/index/certificates/<issuer slug>/<filed_on>.json`. The
certificate is bought as a certified copy from the Delaware Division of
Corporations and read by Nick, or by a model and reviewed by Nick. The PDF
is not committed; its SHA-256 is. The schema is
`src/lib/ingest/parse/certificate.ts` (zod); this page explains it.

No file is committed here unless it transcribes a certificate that has been
bought and read. The parser's test fixture
(`tests/fixtures/certificates/example-co/2026-01-15.json`) is an invented
issuer shaped like the schema, nothing more.

## Fields

| Field | What it holds |
| --- | --- |
| `schema_version` | `0.1.0`. |
| `issuer` | The watchlist slug (`data/index/watchlist.json`); the folder name. |
| `legal_name` | The corporation's name as the certificate gives it. |
| `filed_on` | The filing date the Division stamps on the certificate; the file name. |
| `file_number` | The Division's file number for the corporation. |
| `kind` | `restated` (an amended and restated certificate) or `amendment` (a certificate of amendment). |
| `purchase.registry`, `purchase.url` | Where the certified copy was ordered. |
| `purchase.bought_on` | When it was bought. |
| `purchase.document_sha256` | SHA-256 of the PDF as received (`shasum -a 256 file.pdf`). |
| `entered_by`, `reviewed_by` | Who read it, and who reviewed the reading (null when the reader is Nick). |
| `newest_series` | The series this filing creates. Its original issue price is the round's certificate price: the price mark versus print and the contracts in `CONTRACTS.md` settle on. |
| `common_shares_authorized` | Common shares authorized. |
| `series[]` | One entry per preferred series, below. |
| `unmodelled_terms` | Terms the certificate carries that the common-equivalent conversion (`CE_VERSION` 0.1.0) does not model: `cumulative dividends`, `redemption`, `pay-to-play`, … Any entry makes the structure gap `unsupported`, and the name is published per series only. |
| `notes` | Anything the reader wants on record; null for none. |

Each series:

| Field | What it holds |
| --- | --- |
| `label` | The methodology's label: `Series F-1 Preferred` (METHODOLOGY.md, "Security labels"), so the series meets the marks filed on it. |
| `original_issue_price_usd` | Original issue price per share. |
| `liquidation_multiple` | The preference as a multiple of original issue price (`1` for 1×). |
| `participating` | Whether the series participates with common after its preference. |
| `participation_cap_multiple` | For a participating series, total proceeds capped at this multiple of original issue price; null for no cap. |
| `seniority` | 1 is the most senior; equal numbers rank pari passu. |
| `shares_authorized` | Shares of the series authorized (the conversion's basis, `authorized`). |
| `conversion_price_usd` | Null when it equals the original issue price. |
| `ratchet` | `{ "text": "…" }` quoting an anti-dilution ratchet (including one conditioned on an IPO price); null for none. Broad-based weighted average anti-dilution is not a ratchet. |

Amounts are decimal strings (`"4.00"`), as the certificate states them.

## Import

`npm run index:certificates` validates every file (`-- --check` stops
there) and imports it: a `source_documents` row of class `delaware_coi`
(rank 1 for a round's price and terms), a `certificates` row and one
`certificate_series` row per series. A rerun changes nothing. A changed
file for a certificate already imported is a correction: a new
`certificates` row with its series, the old one superseded, and a
`corrections` row of kind `row`. Nothing is edited in place.

Then each certificate is linked to the round it prices: the issuer's priced
round (or IPO) in `prints` announced nearest the certificate's filing date,
from 60 days before it to 120 days after it, gets the newest series' label
and original issue price and the certificate as its price source. Two
rounds equally near link neither (`CERTIFICATE_PRINT_MATCH` in
`src/lib/services/index/import-certificates.ts`). `npm run index:prints`
runs the same link after importing the round-history prints.
