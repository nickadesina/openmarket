/**
 * The CSV downloads (`/data/filer-marks.csv`, `/data/certificate-terms.csv`,
 * `/data/spv-matches.csv`), generated from the tables on each request and
 * published under CC BY 4.0 (public/data/LICENSE). Every row carries the
 * accession and URL of the document it came from. Rows are read in batches
 * so the response streams; nothing is held whole in memory.
 *
 * Live rows by default; `include=superseded` adds the rows a later filing or
 * a correction replaced, with `status` and `superseded_by` saying so.
 * `issuer=<slug>` limits filer-marks.csv and spv-matches.csv to one name (the
 * file each name page links); an unknown slug is `404 NAME_NOT_FOUND`.
 */
import type { Kysely } from "kysely";

import type { Database } from "../../db/schema.js";
import { type FilerFamilies, resolveFamily } from "../../engine/index/families.js";
import type { CsvValue } from "../../tradeables/csv.js";
import { afterPosition, cursorTime, type KeysetPosition } from "../ref-common.js";
import { PUBLISHED_FILER_FAMILIES } from "./published-families.js";
import { refEnvelope } from "./ref-envelope.js";
import { nameNotFound } from "./ref-name.js";

export type CsvRow = readonly CsvValue[];

export interface CsvTable {
  readonly filename: string;
  readonly columns: readonly string[];
  readonly batches: AsyncIterable<readonly CsvRow[]>;
  /** The versions the rows were produced under, sent as response headers. */
  readonly versions: Readonly<Record<string, string>>;
}

export interface CsvOptions {
  readonly now: Date;
  readonly includeSuperseded: boolean;
  readonly families?: FilerFamilies;
  /** Only this issuer's rows (validated by the route). */
  readonly issuerSlug?: string | undefined;
  /** Rows per database read. */
  readonly batchSize?: number;
}

/** Fails with NAME_NOT_FOUND before the first row when the issuer filter names no issuer. */
async function requireIssuerSlug(db: Kysely<Database>, slug: string | undefined): Promise<void> {
  if (slug === undefined) return;
  const found = await db
    .selectFrom("issuers")
    .select("id")
    .where("slug", "=", slug)
    .executeTakeFirst();
  if (found === undefined) throw nameNotFound(slug);
}

function csvFilename(base: string, slug: string | undefined): string {
  return slug === undefined ? `${base}.csv` : `${base}-${slug}.csv`;
}

const DEFAULT_BATCH = 5000;

function versionHeaders(now: Date, familiesVersion?: string): Record<string, string> {
  const envelope = refEnvelope(now);
  return {
    methodology_version: envelope.methodology_version,
    ce_version: envelope.ce_version,
    rulebook_version: envelope.rulebook_version,
    as_of: envelope.as_of,
    ...(familiesVersion === undefined ? {} : { families_version: familiesVersion }),
  };
}

export const FILER_MARKS_COLUMNS = [
  "mark_id",
  "status",
  "superseded_by",
  "correction_id",
  "issuer_slug",
  "issuer_name",
  "security_label",
  "security_kind",
  "holding_name",
  "holding_title",
  "asset_category",
  "balance",
  "units",
  "value_usd",
  "mark_per_share_usd",
  "fair_value_level",
  "is_restricted",
  "as_of",
  "recorded_at",
  "family_slug",
  "family_name",
  "source_class",
  "source_rank",
  "form_type",
  "accession",
  "document_url",
  "filer_cik",
  "filer_name",
  "fund_series_id",
  "fund_series_name",
  "filed_on",
  "period_end",
  "parser_version",
] as const;

async function* filerMarkBatches(
  db: Kysely<Database>,
  options: CsvOptions,
): AsyncGenerator<readonly CsvRow[]> {
  const families = options.families ?? PUBLISHED_FILER_FAMILIES;
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const familyOf = new Map<string, ReturnType<typeof resolveFamily>>();
  let position: KeysetPosition | null = null;
  await requireIssuerSlug(db, options.issuerSlug);
  for (;;) {
    let select = db
      .selectFrom("filer_marks")
      .innerJoin("source_documents", "source_documents.id", "filer_marks.document_id")
      .innerJoin("issuers", "issuers.id", "filer_marks.issuer_id")
      .select([
        "filer_marks.id",
        "filer_marks.superseded_by",
        "filer_marks.correction_id",
        "issuers.slug",
        "issuers.name",
        "filer_marks.security_label",
        "filer_marks.security_kind",
        "filer_marks.holding_name",
        "filer_marks.holding_title",
        "filer_marks.asset_category",
        "filer_marks.balance",
        "filer_marks.units",
        "filer_marks.value_usd",
        "filer_marks.mark_per_share_usd",
        "filer_marks.fair_value_level",
        "filer_marks.is_restricted",
        "filer_marks.as_of",
        cursorTime("filer_marks.created_at").as("recorded_at"),
        "source_documents.source_class",
        "source_documents.source_rank",
        "source_documents.form_type",
        "source_documents.accession",
        "source_documents.document_url",
        "source_documents.filer_cik",
        "source_documents.filer_name",
        "source_documents.fund_series_id",
        "source_documents.fund_series_name",
        "source_documents.filed_on",
        "source_documents.period_end",
        "source_documents.parser_version",
      ]);
    if (!options.includeSuperseded) select = select.where("filer_marks.superseded_by", "is", null);
    if (options.issuerSlug !== undefined)
      select = select.where("issuers.slug", "=", options.issuerSlug);
    if (position !== null) {
      select = select.where(
        afterPosition("filer_marks.created_at", "filer_marks.id", position, "uuid"),
      );
    }
    const rows = await select
      .orderBy("filer_marks.created_at")
      .orderBy("filer_marks.id")
      .limit(batchSize)
      .execute();
    if (rows.length === 0) return;
    yield rows.map((row) => {
      let family: ReturnType<typeof resolveFamily> | null = null;
      if (row.filer_cik !== null) {
        family =
          familyOf.get(row.filer_cik) ?? resolveFamily(families, row.filer_cik, row.filer_name);
        familyOf.set(row.filer_cik, family);
      }
      return [
        row.id,
        row.superseded_by === null ? "live" : "superseded",
        row.superseded_by,
        row.correction_id,
        row.slug,
        row.name,
        row.security_label,
        row.security_kind,
        row.holding_name,
        row.holding_title,
        row.asset_category,
        row.balance,
        row.units,
        row.value_usd,
        row.mark_per_share_usd,
        row.fair_value_level,
        row.is_restricted,
        row.as_of,
        row.recorded_at,
        family?.slug ?? null,
        family?.name ?? null,
        row.source_class,
        row.source_rank,
        row.form_type,
        row.accession,
        row.document_url,
        row.filer_cik,
        row.filer_name,
        row.fund_series_id,
        row.fund_series_name,
        row.filed_on,
        row.period_end,
        row.parser_version,
      ];
    });
    if (rows.length < batchSize) return;
    const last = rows.at(-1)!;
    position = { at: last.recorded_at, key: last.id };
  }
}

export function filerMarksCsv(db: Kysely<Database>, options: CsvOptions): CsvTable {
  const families = options.families ?? PUBLISHED_FILER_FAMILIES;
  return {
    filename: csvFilename("filer-marks", options.issuerSlug),
    columns: FILER_MARKS_COLUMNS,
    batches: filerMarkBatches(db, { ...options, families }),
    versions: versionHeaders(options.now, families.version),
  };
}

export const CERTIFICATE_TERMS_COLUMNS = [
  "certificate_id",
  "status",
  "superseded_by",
  "correction_id",
  "issuer_slug",
  "issuer_name",
  "filed_on",
  "kind",
  "entered_by",
  "newest_series_label",
  "common_shares_authorized",
  "unmodelled_terms",
  "series_label",
  "original_issue_price_usd",
  "liquidation_multiple",
  "participating",
  "participation_cap_multiple",
  "seniority",
  "shares_authorized",
  "conversion_price_usd",
  "ratchet",
  "transcription_sha256",
  "source_class",
  "accession",
  "document_url",
  "content_sha256",
] as const;

/** One row per series of each certificate; the certificate's own fields repeat on each. */
async function* certificateBatches(
  db: Kysely<Database>,
  options: CsvOptions,
): AsyncGenerator<readonly CsvRow[]> {
  let select = db
    .selectFrom("certificates")
    .innerJoin("issuers", "issuers.id", "certificates.issuer_id")
    .innerJoin("source_documents", "source_documents.id", "certificates.document_id")
    .innerJoin("certificate_series", "certificate_series.certificate_id", "certificates.id")
    .select([
      "certificates.id",
      "certificates.superseded_by",
      "certificates.correction_id",
      "issuers.slug",
      "issuers.name",
      "certificates.filed_on",
      "certificates.kind",
      "certificates.entered_by",
      "certificates.newest_series_label",
      "certificates.common_shares_authorized",
      "certificates.unmodelled_terms",
      "certificate_series.series_label",
      "certificate_series.original_issue_price_usd",
      "certificate_series.liquidation_multiple",
      "certificate_series.participating",
      "certificate_series.participation_cap_multiple",
      "certificate_series.seniority",
      "certificate_series.shares_authorized",
      "certificate_series.conversion_price_usd",
      "certificate_series.ratchet",
      "certificates.transcription_sha256",
      "source_documents.source_class",
      "source_documents.accession",
      "source_documents.document_url",
      "source_documents.content_sha256",
    ]);
  if (!options.includeSuperseded) select = select.where("certificates.superseded_by", "is", null);
  // A certificate is a handful of series and the table a handful of certificates: one read.
  const rows = await select
    .orderBy("issuers.slug")
    .orderBy("certificates.filed_on")
    .orderBy("certificates.created_at")
    .orderBy("certificate_series.seniority")
    .orderBy("certificate_series.series_label")
    .execute();
  if (rows.length === 0) return;
  yield rows.map((row) => [
    row.id,
    row.superseded_by === null ? "live" : "superseded",
    row.superseded_by,
    row.correction_id,
    row.slug,
    row.name,
    row.filed_on,
    row.kind,
    row.entered_by,
    row.newest_series_label,
    row.common_shares_authorized,
    row.unmodelled_terms.join("; "),
    row.series_label,
    row.original_issue_price_usd,
    row.liquidation_multiple,
    row.participating,
    row.participation_cap_multiple,
    row.seniority,
    row.shares_authorized,
    row.conversion_price_usd,
    row.ratchet,
    row.transcription_sha256,
    row.source_class,
    row.accession,
    row.document_url,
    row.content_sha256,
  ]);
}

export function certificateTermsCsv(db: Kysely<Database>, options: CsvOptions): CsvTable {
  return {
    filename: "certificate-terms.csv",
    columns: CERTIFICATE_TERMS_COLUMNS,
    batches: certificateBatches(db, options),
    versions: versionHeaders(options.now),
  };
}

export const SPV_MATCHES_COLUMNS = [
  "vehicle_cik",
  "vehicle_name",
  "issuer_slug",
  "match_method",
  "match_note",
  "jurisdiction",
  "total_offering_usd",
  "total_sold_usd",
  "min_investment_usd",
  "sales_commission_usd",
  "finders_fee_usd",
  "first_sale_on",
  "source_class",
  "form_type",
  "accession",
  "document_url",
  "filer_name",
  "filed_on",
] as const;

/** One row per Form D: each vehicle's filings, matched to a name or `unmatched`. */
async function* spvBatches(
  db: Kysely<Database>,
  issuerSlug: string | undefined,
): AsyncGenerator<readonly CsvRow[]> {
  await requireIssuerSlug(db, issuerSlug);
  let select = db
    .selectFrom("spv_vehicles")
    .innerJoin("source_documents", "source_documents.id", "spv_vehicles.document_id")
    .leftJoin("issuers", "issuers.id", "spv_vehicles.issuer_id")
    .select([
      "spv_vehicles.vehicle_cik",
      "spv_vehicles.vehicle_name",
      "issuers.slug",
      "spv_vehicles.match_method",
      "spv_vehicles.match_note",
      "spv_vehicles.jurisdiction",
      "spv_vehicles.total_offering_usd",
      "spv_vehicles.total_sold_usd",
      "spv_vehicles.min_investment_usd",
      "spv_vehicles.sales_commission_usd",
      "spv_vehicles.finders_fee_usd",
      "spv_vehicles.first_sale_on",
      "source_documents.source_class",
      "source_documents.form_type",
      "source_documents.accession",
      "source_documents.document_url",
      "source_documents.filer_name",
      "source_documents.filed_on",
    ]);
  if (issuerSlug !== undefined) select = select.where("issuers.slug", "=", issuerSlug);
  const rows = await select
    .orderBy("issuers.slug", (order) => order.asc().nullsLast())
    .orderBy("spv_vehicles.vehicle_cik")
    .orderBy("source_documents.filed_on")
    .orderBy("source_documents.accession")
    .execute();
  if (rows.length === 0) return;
  yield rows.map((row) => [
    row.vehicle_cik,
    row.vehicle_name,
    row.slug,
    row.match_method,
    row.match_note,
    row.jurisdiction,
    row.total_offering_usd,
    row.total_sold_usd,
    row.min_investment_usd,
    row.sales_commission_usd,
    row.finders_fee_usd,
    row.first_sale_on,
    row.source_class,
    row.form_type,
    row.accession,
    row.document_url,
    row.filer_name,
    row.filed_on,
  ]);
}

export function spvMatchesCsv(db: Kysely<Database>, options: CsvOptions): CsvTable {
  return {
    filename: csvFilename("spv-matches", options.issuerSlug),
    columns: SPV_MATCHES_COLUMNS,
    batches: spvBatches(db, options.issuerSlug),
    versions: versionHeaders(options.now),
  };
}
