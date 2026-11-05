import type { RulebookPayload } from "../services/get-rulebook.js";
import type { RefCorrectionsPayload } from "../services/index/ref-corrections.js";
import type { RefEnvelope } from "../services/index/ref-envelope.js";
import type { RefMarksPayload } from "../services/index/ref-marks.js";
import type { RefMethodologyPayload } from "../services/index/ref-methodology.js";
import type { RefNamePayload } from "../services/index/ref-name.js";
import type { RefNamesPayload } from "../services/index/ref-names.js";
import type { RefRevisionsPayload } from "../services/index/ref-revisions.js";
import type { RefSpvPayload } from "../services/index/ref-spv.js";

/**
 * The /ref docs page's content that is not prose: each route's query and
 * top-level fields, checked against the payload types so a field added to a
 * payload fails the typecheck until it is documented here. The example
 * payloads are generated from a database (`npm run export:ref-examples`,
 * docs/tradeables/ref-examples.json), never written by hand.
 */

/** Where the datasets' licence is served (public/data/LICENSE), linked from every CSV. */
export const DATA_LICENSE_PATH = "/data/LICENSE";

/** The attribution line the licence asks for (public/data/LICENSE). */
export const ATTRIBUTION = "OpenMarket marks index, openmarket.systems, CC BY 4.0";

/** One line per field, keyed by the payload type's own keys. */
type FieldDocs<T> = { readonly [K in keyof T]-?: string };

export const ENVELOPE_FIELDS = {
  methodology_version:
    "The methodology the figures were computed under (/methodology). A changed rule or constant is a new version.",
  ce_version: "The common-equivalent conversion's own version.",
  rulebook_version: "The settlement rulebook in force (/rulebook): source classes and their ranks.",
  as_of:
    "When the payload was computed, UTC. A quarter's figures can change as late filings arrive.",
  lag_note: "The N-PORT lag, in one sentence, on every payload.",
} as const satisfies FieldDocs<RefEnvelope>;

export interface RouteDoc {
  readonly id: string;
  readonly path: string;
  readonly query: readonly (readonly [string, string])[];
  readonly summary: string;
  readonly fields: Readonly<Record<string, string>>;
  /** The key of its example in docs/tradeables/ref-examples.json, when it has one. */
  readonly example?: string;
}

const FAMILIES_VERSION =
  "The version of data/index/filer-families.json the families were taken from.";
const ISSUER_SHORT = "The name: slug and display name.";
const SLUG_404 = "An unknown slug is 404 NAME_NOT_FOUND.";
const PAGE_QUERY: readonly (readonly [string, string])[] = [
  ["limit", "Rows per page, 1 to 1000; default 200."],
  ["cursor", "The previous page's next_cursor."],
];

export const REF_ROUTES: readonly RouteDoc[] = [
  {
    id: "names",
    path: "/api/ref/names",
    query: [],
    summary:
      "Every watchlist name with its headline label's latest consensus, dispersion, family count and latest filing date.",
    fields: {
      ...ENVELOPE_FIELDS,
      families_version: FAMILIES_VERSION,
      names:
        "One row per watchlist name, by slug: slug, name, listed_on, security_label and quarter of the headline, consensus_usd, n_families, dispersion_pct (null below two families) with the high and low family, latest_filed_on, latest_as_of, live_marks, labels, last_print and spv_vehicles. A name with no per-share series has null headline fields and its live_marks count.",
    } satisfies FieldDocs<RefNamesPayload>,
    example: "names",
  },
  {
    id: "name",
    path: "/api/ref/{slug}",
    query: [],
    summary: `One name: per label the quarterly consensus and dispersion, each family's marks with the filings behind them, revisions, mark versus print; the prints; the structure table and its common-equivalent result; the SPV panel. ${SLUG_404}`,
    fields: {
      ...ENVELOPE_FIELDS,
      families_version: FAMILIES_VERSION,
      issuer:
        "slug, name, legal_name, watchlisted, incorporation_state with the filing it was read from, listed_on and listing_url (the final prospectus) once listed.",
      marks_summary:
        "Counts of the live marks: live, in_series, and those kept out of per-share series (no_per_share, not_comparable_label, after_listing); latest_filed_on and latest_as_of.",
      headline:
        "The label and quarter the daily page leads with: security_label, quarter, consensus_usd, n_families, dispersion_pct. Null without a per-share series.",
      labels:
        "Per security label: consensus[] (quarter, consensus_usd, n_families, dispersion with high and low family, the families used, mark_vs_print), family_marks[] (each family's mark by as-of date with n_funds, intra_family_split, mark_vs_print and documents[] carrying accession and document_url), revisions[].",
      last_print: "The latest priced round or IPO on or before today; null without one.",
      prints:
        "Every print: priced rounds and IPOs, and Form D offerings as evidence of size and date, each with its source.",
      structure:
        "The live certificate of incorporation's series table, the round it prices, and common_equivalent and structure_gap (or unsupported with the reason). Null until a certificate is transcribed.",
      spv: "vehicles[] matched from Form D (with the latest filing's terms) and quotes[] from public pages with their premiums.",
    } satisfies FieldDocs<RefNamePayload>,
    example: "name",
  },
  {
    id: "marks",
    path: "/api/ref/{slug}/marks",
    query: [
      ...PAGE_QUERY,
      [
        "include",
        "superseded: add the rows a later filing or a correction replaced. Default: live rows only.",
      ],
      ["label", "Only rows on this security label, exactly (Series F-1 Preferred)."],
    ],
    summary: `Every filer mark on the name as filed, in the order recorded, each with the document it came from. ${SLUG_404}`,
    fields: {
      ...ENVELOPE_FIELDS,
      families_version: FAMILIES_VERSION,
      issuer: "slug, name and listed_on.",
      include: "live, or superseded when superseded rows are included.",
      security_label: "The label filter, or null.",
      marks:
        "One row each: mark_id, status (live or superseded), superseded_by, correction_id, series_status (in_series, or the rule that keeps a live row out), the label and kind, the holding as filed (name, title, asset category, balance, units, value_usd, fair-value level, restricted), mark_per_share_usd, as_of, recorded_at, the filer's family, and document (source class and rank, accession, document_url, form, filer, fund series, filed_on, period_end, content hash, parser version).",
      next_cursor: "Pass as cursor for the next page; null on the last page.",
    } satisfies FieldDocs<RefMarksPayload>,
    example: "marks",
  },
  {
    id: "revisions",
    path: "/api/ref/{slug}/revisions",
    query: [],
    summary: `Every family revision on the name across labels, oldest first, with the rule's constants. ${SLUG_404}`,
    fields: {
      ...ENVELOPE_FIELDS,
      families_version: FAMILIES_VERSION,
      issuer: ISSUER_SHORT,
      rule: "revision_threshold_ln and leader_window_days, as the methodology sets them.",
      revisions:
        "security_label, family, from and to as-of dates and marks, ln, direction, role (leader or follower), the leader's family and date, and lag_days.",
    } satisfies FieldDocs<RefRevisionsPayload>,
    example: "revisions",
  },
  {
    id: "spv",
    path: "/api/ref/{slug}/spv",
    query: [],
    summary: `The name's SPV panel: vehicles matched from Form D, and unit quotes from public pages with their premium over consensus. ${SLUG_404}`,
    fields: {
      ...ENVELOPE_FIELDS,
      families_version: FAMILIES_VERSION,
      issuer: ISSUER_SHORT,
      headline: "The label and quarter premiums are computed against, as in /api/ref/{slug}.",
      vehicles:
        "vehicle_name, vehicle_cik, match_method and match_note, latest_filing (accession, document_url, offering and sold amounts, minimum, fees, first sale, jurisdiction, related persons) and n_filings.",
      quotes:
        "platform, captured_at, the captured page (document_url, content hash), the quoted price and fees as the page states them, and premium (or none with the reason).",
    } satisfies FieldDocs<RefSpvPayload>,
    example: "spv",
  },
  {
    id: "methodology",
    path: "/api/ref/methodology",
    query: [["include", "families: add every filer family with its CIKs and evidence."]],
    summary:
      "The methodology's constants as the engine exports them, and the inputs its rules read that exist as data. In prose at /methodology.",
    fields: {
      ...ENVELOPE_FIELDS,
      families_version: FAMILIES_VERSION,
      methodology:
        "Every constant: methodology_version, ce_version, ce_basis, per_share_units, revision_threshold_ln, leader_window_days, intra_family_split_tolerance, min_families_for_dispersion.",
      security_labels:
        "Which labels enter per-share series (Common, and labels matching per_share_series_pattern), the labels that do not, and the security kinds.",
      listings:
        "Names whose final prospectus is on EDGAR, with its date and URL: marks as of that date or later enter no series.",
      families:
        "The families file: version, note, n_families, n_ciks; list[] with include=families.",
    } satisfies FieldDocs<RefMethodologyPayload>,
    example: "methodology",
  },
  {
    id: "corrections",
    path: "/api/ref/corrections",
    query: PAGE_QUERY,
    summary:
      "Every published correction, newest first. A correction writes new rows and supersedes the old; nothing is edited in place.",
    fields: {
      ...ENVELOPE_FIELDS,
      corrections:
        "correction_id, published_at, methodology_version, kind (row, methodology or parser), summary, diff_md, affected, and rows_written per table.",
      next_cursor: "Pass as cursor for the next page; null on the last page.",
    } satisfies FieldDocs<RefCorrectionsPayload>,
    example: "corrections",
  },
  {
    id: "rulebook",
    path: "/api/ref/rulebook",
    query: [],
    summary:
      "The settlement rulebook as data, with the rules not yet served. In prose at /rulebook.",
    fields: {
      ...ENVELOPE_FIELDS,
      rulebook:
        "The rules: print, announcement, source ranks, revision, the source classes ranked within each purpose, and the rules every contract on the index shares.",
      not_built: "Rules that are the contracts' intent but not served by the code yet.",
    } satisfies FieldDocs<RulebookPayload>,
  },
];

export interface DatasetDoc {
  readonly path: string;
  readonly summary: string;
  readonly query: readonly (readonly [string, string])[];
}

/** The CSV downloads (src/app/data/*.csv/route.ts), CC BY 4.0. */
export const DATASETS: readonly DatasetDoc[] = [
  {
    path: "/data/filer-marks.csv",
    summary:
      "Every filer mark, one row per holding as filed: the label, balance, value and per-share mark, the filer's family, and the document's accession and URL.",
    query: [["include", "superseded: add replaced rows, with status and superseded_by."]],
  },
  {
    path: "/data/certificate-terms.csv",
    summary:
      "One row per series of each transcribed certificate of incorporation: original issue price, preference, participation, seniority, shares authorized, with the certificate's accession and URL.",
    query: [["include", "superseded: add corrected transcriptions."]],
  },
  {
    path: "/data/spv-matches.csv",
    summary:
      "One row per vehicle Form D: the vehicle, the name it is matched to (or unmatched) and how, the offering's terms, accession and URL.",
    query: [],
  },
];
