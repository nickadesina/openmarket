/**
 * EDGAR full-text search (https://efts.sec.gov/LATEST/search-index): the
 * response of one page, typed, and the arithmetic of walking a query.
 *
 * A hit is one file inside a filing (`_id` is `accession:file name`), so one
 * filing can hit several times: an N-PORT's `primary_doc.xml` and its
 * NPORT-EX schedule, say. A page holds at most 100 hits; a query reports at
 * most 10,000 (`relation: "gte"` at the ceiling), so a query at the ceiling
 * is narrowed by halving its date range until each half is under it.
 */
import { z } from "zod";

export const EFTS_PAGE_SIZE = 100;
export const EFTS_HIT_CEILING = 10_000;

const hitSchema = z.object({
  _id: z.string(),
  _source: z.object({
    ciks: z.array(z.string()).default([]),
    display_names: z.array(z.string()).default([]),
    adsh: z.string().optional(),
    form: z.string().default(""),
    root_forms: z.array(z.string()).default([]),
    file_type: z.string().nullish(),
    file_date: z.string().nullish(),
    period_ending: z.string().nullish(),
  }),
});

const pageSchema = z.object({
  hits: z.object({
    total: z.object({ value: z.number().int().nonnegative(), relation: z.string().default("eq") }),
    hits: z.array(hitSchema),
  }),
});

export interface EftsHit {
  readonly accession: string;
  readonly fileName: string;
  readonly form: string;
  readonly fileType: string;
  /** Without leading zeros, as archive paths take them. */
  readonly ciks: readonly string[];
  /** The entity names, `(CIK …)` removed. */
  readonly entityNames: readonly string[];
  readonly filedOn: string | null;
  readonly periodEnding: string | null;
}

export interface EftsPage {
  readonly total: number;
  /** The total is a lower bound: the query hit the 10,000 ceiling. */
  readonly atCeiling: boolean;
  readonly hits: readonly EftsHit[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDateOrNull(value: string | null | undefined): string | null {
  return value !== null && value !== undefined && ISO_DATE.test(value) ? value : null;
}

function entityName(displayName: string): string {
  return displayName
    .replace(/\s*\(CIK \d+\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseEftsPage(body: unknown): EftsPage {
  const page = pageSchema.parse(body);
  const { value, relation } = page.hits.total;
  return {
    total: value,
    atCeiling: relation === "gte" || value >= EFTS_HIT_CEILING,
    hits: page.hits.hits.map(({ _id, _source }) => {
      const separator = _id.indexOf(":");
      return {
        accession: _source.adsh ?? (separator < 0 ? _id : _id.slice(0, separator)),
        fileName: separator < 0 ? "" : _id.slice(separator + 1),
        form: _source.form,
        fileType: _source.file_type ?? "",
        ciks: _source.ciks.map((cik) => cik.replace(/^0+/, "")),
        entityNames: _source.display_names.map(entityName),
        filedOn: isoDateOrNull(_source.file_date),
        periodEnding: isoDateOrNull(_source.period_ending),
      };
    }),
  };
}

export interface EftsQuery {
  /** Searched as an exact phrase. */
  readonly phrase: string;
  readonly forms: readonly string[];
  readonly startDate: string;
  readonly endDate: string;
}

/** The search URL's query string for one page of `query`, from hit `from`. */
export function eftsQueryString(query: EftsQuery, from: number): string {
  const params = new URLSearchParams({
    q: `"${query.phrase}"`,
    forms: query.forms.join(","),
    dateRange: "custom",
    startdt: query.startDate,
    enddt: query.endDate,
  });
  if (from > 0) params.set("from", String(from));
  return params.toString();
}

/** The page offsets that read `total` hits (never past the ceiling). */
export function pageOffsets(total: number): number[] {
  const offsets: number[] = [];
  for (let from = 0; from < Math.min(total, EFTS_HIT_CEILING); from += EFTS_PAGE_SIZE) {
    offsets.push(from);
  }
  return offsets;
}

const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS;
}

function dateOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The two halves of an inclusive date range, or null for a single day (a
 * day at the ceiling cannot be narrowed further by date).
 */
export function splitDateRange(
  startDate: string,
  endDate: string,
): readonly [readonly [string, string], readonly [string, string]] | null {
  const start = dayNumber(startDate);
  const end = dayNumber(endDate);
  if (!(end > start)) return null;
  const middle = Math.floor((start + end) / 2);
  return [
    [dateOf(start), dateOf(middle)],
    [dateOf(middle + 1), dateOf(end)],
  ];
}

export interface EftsFiling {
  readonly accession: string;
  readonly form: string;
  readonly cik: string;
  readonly filerName: string;
  readonly filedOn: string | null;
  readonly periodEnding: string | null;
  /** The files that hit, in file-name order. */
  readonly fileNames: readonly string[];
}

/** Hits grouped by filing, in accession order. */
export function filingsFromHits(hits: readonly EftsHit[]): EftsFiling[] {
  const byAccession = new Map<string, { first: EftsHit; files: Set<string> }>();
  for (const hit of hits) {
    const entry = byAccession.get(hit.accession);
    if (entry === undefined) byAccession.set(hit.accession, { first: hit, files: new Set() });
    if (hit.fileName.length > 0) byAccession.get(hit.accession)!.files.add(hit.fileName);
  }
  return [...byAccession.values()]
    .map(({ first, files }) => ({
      accession: first.accession,
      form: first.form,
      cik: first.ciks[0] ?? "",
      filerName: first.entityNames[0] ?? "",
      filedOn: first.filedOn,
      periodEnding: first.periodEnding,
      fileNames: [...files].sort(),
    }))
    .sort((a, b) => a.accession.localeCompare(b.accession));
}
