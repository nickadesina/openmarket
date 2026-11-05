/**
 * Why a name has the filer marks it has: what EDGAR full-text search found
 * naming it (data/index/filing-counts.json, written by `npm run
 * index:search`), and, for a name with no live mark, the reason in one
 * sentence built from those counts and the documents ingest read. Nothing
 * here is typed by hand: each sentence states counts and accessions.
 *
 * The file is imported, not read from disk, so the bundler carries it into
 * the server bundles that need it (as published-families.ts does).
 */
import type { Kysely } from "kysely";

import file from "../../../../data/index/filing-counts.json";
import type { Database } from "../../db/schema.js";
import type { FilingCountsFile, FilingCountsIssuer } from "./search-filings.js";

export const FILING_COUNTS: FilingCountsFile = file;

export interface NameCoverage {
  /** The search the counts come from. */
  readonly searched: {
    readonly fetched_at: string;
    readonly start_date: string;
    readonly end_date: string;
  };
  readonly nport_filings: number;
  readonly ncsr_filings: number;
  readonly nport_families: number;
  readonly families: number;
  readonly latest_filed: string | null;
}

export type NoMarksCode =
  | "not_searched"
  | "named_in_no_fund_filing"
  | "named_in_ncsr_only"
  | "no_matching_holding"
  | "not_ingested";

export interface NoMarks {
  readonly code: NoMarksCode;
  readonly reason: string;
  /** The N-PORT filings the reason names, when the search listed them. */
  readonly filings: readonly {
    readonly accession: string;
    readonly filer_name: string;
    readonly filed_on: string | null;
    readonly url: string;
    readonly read: boolean;
  }[];
}

function countsFor(slug: string): FilingCountsIssuer | undefined {
  return FILING_COUNTS.issuers.find((issuer) => issuer.slug === slug);
}

export function nameCoverage(slug: string): NameCoverage | null {
  const counts = countsFor(slug);
  if (counts === undefined) return null;
  return {
    searched: {
      fetched_at: FILING_COUNTS.fetched_at,
      start_date: FILING_COUNTS.start_date,
      end_date: FILING_COUNTS.end_date,
    },
    nport_filings: counts.nport_filings,
    ncsr_filings: counts.ncsr_filings + counts.ncsrs_filings,
    nport_families: counts.nport_families,
    families: counts.families,
    latest_filed: counts.latest_filed,
  };
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * Why a name with no live filer mark has none: never searched; named in no
 * N-PORT, N-CSR or N-CSRS; named only in N-CSR text (not parsed,
 * data/index/sources-status.md); or named in N-PORT filings whose holdings
 * did not match its pattern (each listed filing read) or that are not yet
 * read.
 */
export async function noMarksReason(db: Kysely<Database>, slug: string): Promise<NoMarks> {
  const counts = countsFor(slug);
  const range = `EDGAR full-text search, filings dated ${FILING_COUNTS.start_date} to ${FILING_COUNTS.end_date}`;
  if (counts === undefined) {
    return {
      code: "not_searched",
      reason: "Not in the last full-text search of fund filings (data/index/filing-counts.json).",
      filings: [],
    };
  }
  const ncsr = counts.ncsr_filings + counts.ncsrs_filings;
  if (counts.nport_filings === 0 && ncsr === 0) {
    return {
      code: "named_in_no_fund_filing",
      reason: `No N-PORT, N-CSR or N-CSRS filing names it (${range}), so no registered fund's filing gives a mark on it.`,
      filings: [],
    };
  }
  if (counts.nport_filings === 0) {
    return {
      code: "named_in_ncsr_only",
      reason: `Named in ${plural(ncsr, "N-CSR or N-CSRS filing")} from ${plural(counts.families, "family", "families")} and in no N-PORT (${range}); N-CSR schedules are not parsed (data/index/sources-status.md).`,
      filings: [],
    };
  }
  const listed = counts.nport_listed ?? [];
  const read =
    listed.length === 0
      ? new Set<string>()
      : new Set(
          (
            await db
              .selectFrom("source_documents")
              .select("accession")
              .where(
                "accession",
                "in",
                listed.map((filing) => filing.accession),
              )
              .execute()
          ).map((row) => row.accession),
        );
  const filings = listed.map((filing) => ({
    accession: filing.accession,
    filer_name: filing.filer_name,
    filed_on: filing.filed_on,
    url: filing.url,
    read: read.has(filing.accession),
  }));
  if (counts.nport_listed !== null && filings.every((filing) => filing.read)) {
    return {
      code: "no_matching_holding",
      reason: `${plural(counts.nport_filings, "N-PORT filing")} ${counts.nport_filings === 1 ? "names" : "name"} it in its text (${range}); ${counts.nport_filings === 1 ? "it was" : "each was"} read, and no holding in ${counts.nport_filings === 1 ? "it" : "them"} matches the name's pattern (data/index/watchlist.json).`,
      filings,
    };
  }
  return {
    code: "not_ingested",
    reason: `${plural(counts.nport_filings, "N-PORT filing")} ${counts.nport_filings === 1 ? "names" : "name"} it (${range}); no holding from ${counts.nport_filings === 1 ? "it" : "them"} is in the index yet: not ingested.`,
    filings,
  };
}
