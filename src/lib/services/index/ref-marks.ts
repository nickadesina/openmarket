/**
 * `GET /api/ref/[slug]/marks`: every filer mark on a name, as filed, with
 * the document it came from, keyset-paginated in the order the rows were
 * recorded (`recorded_at`, then `mark_id`), so a client that keeps the last
 * cursor sees new rows on its next call.
 *
 * Live rows by default; `include=superseded` adds the rows a later filing or
 * a correction replaced, each with `superseded_by` naming its replacement.
 * A live row says whether it enters the per-share series and, if not, the
 * rule that keeps it out (`series_status`, as the name index applies it).
 */
import type { Kysely } from "kysely";

import type { Database } from "../../db/schema.js";
import { type FilerFamilies, resolveFamily } from "../../engine/index/families.js";
import { afterPosition, cursorAfter, cursorTime, decodeCursor, takePage } from "../ref-common.js";
import { type SeriesStatus, seriesStatus } from "./get-name-index.js";
import { PUBLISHED_FILER_FAMILIES } from "./published-families.js";
import { type RefEnvelope, refEnvelope } from "./ref-envelope.js";
import { requireIssuer } from "./ref-name.js";

export const MARKS_INCLUDE = ["live", "superseded"] as const;
export type MarksInclude = (typeof MARKS_INCLUDE)[number];

export interface RefMarksQuery {
  readonly limit: number;
  readonly cursor?: string | undefined;
  /** `superseded` adds superseded rows to the live ones. */
  readonly include: MarksInclude;
  /** Only rows on this security label. */
  readonly securityLabel?: string | undefined;
}

export interface RefMarkDocument {
  readonly source_class: string;
  readonly source_rank: number;
  readonly accession: string | null;
  readonly document_url: string;
  readonly form_type: string | null;
  readonly filer_cik: string | null;
  readonly filer_name: string;
  readonly fund_series_id: string | null;
  readonly fund_series_name: string | null;
  readonly filed_on: string | null;
  readonly period_end: string | null;
  readonly content_sha256: string;
  readonly parser_version: string;
}

export interface RefMark {
  readonly mark_id: string;
  readonly status: "live" | "superseded";
  /** The row that replaced this one; null while live. */
  readonly superseded_by: string | null;
  /** The correction that wrote this row; null for a row as filed. */
  readonly correction_id: string | null;
  /** For a live row, whether it enters the per-share series or which rule keeps it out; null when superseded. */
  readonly series_status: SeriesStatus | null;
  readonly security_label: string;
  readonly security_kind: string;
  readonly holding_name: string;
  readonly holding_title: string;
  readonly asset_category: string | null;
  readonly balance: string | null;
  readonly units: string | null;
  readonly value_usd: string;
  /** value_usd / balance for a share balance above zero; null otherwise. */
  readonly mark_per_share_usd: string | null;
  readonly fair_value_level: string | null;
  readonly is_restricted: boolean | null;
  readonly as_of: string;
  readonly recorded_at: string;
  /** The filer's family under `families_version`; null without a filer CIK. */
  readonly family: {
    readonly family_slug: string;
    readonly family_name: string;
    readonly family_mapped: boolean;
  } | null;
  readonly document: RefMarkDocument;
}

export interface RefMarksPayload extends RefEnvelope {
  readonly families_version: string;
  readonly issuer: {
    readonly slug: string;
    readonly name: string;
    readonly listed_on: string | null;
  };
  readonly include: MarksInclude;
  readonly security_label: string | null;
  readonly marks: readonly RefMark[];
  /** Pass as `cursor` for the next page; null on the last page. */
  readonly next_cursor: string | null;
}

export async function getRefMarks(
  db: Kysely<Database>,
  slug: string,
  query: RefMarksQuery,
  options: { readonly now: Date; readonly families?: FilerFamilies },
): Promise<RefMarksPayload> {
  const families = options.families ?? PUBLISHED_FILER_FAMILIES;
  const { marks: position } = decodeCursor(query.cursor, ["marks"]);
  const issuer = await requireIssuer(db, slug);
  const envelope = refEnvelope(options.now);
  const base = {
    ...envelope,
    families_version: families.version,
    issuer: { slug: issuer.slug, name: issuer.name, listed_on: issuer.listed_on },
    include: query.include,
    security_label: query.securityLabel ?? null,
  };
  if (position === "end") return { ...base, marks: [], next_cursor: null };

  let select = db
    .selectFrom("filer_marks")
    .innerJoin("source_documents", "source_documents.id", "filer_marks.document_id")
    .select([
      "filer_marks.id",
      "filer_marks.superseded_by",
      "filer_marks.correction_id",
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
      "source_documents.accession",
      "source_documents.document_url",
      "source_documents.form_type",
      "source_documents.filer_cik",
      "source_documents.filer_name",
      "source_documents.fund_series_id",
      "source_documents.fund_series_name",
      "source_documents.filed_on",
      "source_documents.period_end",
      "source_documents.content_sha256",
      "source_documents.parser_version",
    ])
    .where("filer_marks.issuer_id", "=", issuer.id);
  if (query.include === "live") select = select.where("filer_marks.superseded_by", "is", null);
  if (query.securityLabel !== undefined) {
    select = select.where("filer_marks.security_label", "=", query.securityLabel);
  }
  if (position !== null) {
    select = select.where(
      afterPosition("filer_marks.created_at", "filer_marks.id", position, "uuid"),
    );
  }
  const fetched = await select
    .orderBy("filer_marks.created_at")
    .orderBy("filer_marks.id")
    .limit(query.limit + 1)
    .execute();
  const page = takePage(fetched, query.limit, (row) => ({ at: row.recorded_at, key: row.id }));

  // One family lookup per registrant on the page, not per row.
  const familyOf = new Map<string, ReturnType<typeof resolveFamily>>();
  const marks = page.items.map((row): RefMark => {
    let family: ReturnType<typeof resolveFamily> | null = null;
    if (row.filer_cik !== null) {
      family =
        familyOf.get(row.filer_cik) ?? resolveFamily(families, row.filer_cik, row.filer_name);
      familyOf.set(row.filer_cik, family);
    }
    return {
      mark_id: row.id,
      status: row.superseded_by === null ? "live" : "superseded",
      superseded_by: row.superseded_by,
      correction_id: row.correction_id,
      series_status: row.superseded_by === null ? seriesStatus(row, issuer.listed_on) : null,
      security_label: row.security_label,
      security_kind: row.security_kind,
      holding_name: row.holding_name,
      holding_title: row.holding_title,
      asset_category: row.asset_category,
      balance: row.balance,
      units: row.units,
      value_usd: row.value_usd,
      mark_per_share_usd: row.mark_per_share_usd,
      fair_value_level: row.fair_value_level,
      is_restricted: row.is_restricted,
      as_of: row.as_of,
      recorded_at: row.recorded_at,
      family:
        family === null
          ? null
          : { family_slug: family.slug, family_name: family.name, family_mapped: family.mapped },
      document: {
        source_class: row.source_class,
        source_rank: row.source_rank,
        accession: row.accession,
        document_url: row.document_url,
        form_type: row.form_type,
        filer_cik: row.filer_cik,
        filer_name: row.filer_name,
        fund_series_id: row.fund_series_id,
        fund_series_name: row.fund_series_name,
        filed_on: row.filed_on,
        period_end: row.period_end,
        content_sha256: row.content_sha256,
        parser_version: row.parser_version,
      },
    };
  });
  return { ...base, marks, next_cursor: cursorAfter({ marks: page.next }) };
}
