/**
 * Week 1 of the index (docs/prompts/v2/p2-edgar-ingest.md, step 4): for
 * every watchlist issuer and candidate, the NPORT-P, N-CSR and N-CSRS
 * filings whose text has one of its search phrases (EDGAR full-text search;
 * each form's amendments come with it), one row per issuer and filing.
 * `npm run index:search` writes them to data/index/filings-by-name.csv and
 * the counts to data/index/filer-counts.md.
 */
import { searchFullText } from "../../ingest/fetch/efts.js";
import { filingDocumentUrl, type SecClient } from "../../ingest/fetch/sec.js";
import { type EftsHit, filingsFromHits } from "../../ingest/parse/efts.js";
import type { WatchlistIssuer } from "../../ingest/parse/watchlist.js";

/** The form families the search covers; EDGAR returns each one's `/A` with it. */
export const SEARCH_FORMS = ["NPORT-P", "N-CSR", "N-CSRS"] as const;
export type SearchForm = (typeof SEARCH_FORMS)[number];

export interface IssuerFiling {
  readonly issuerSlug: string;
  readonly watchlisted: boolean;
  readonly formFamily: SearchForm;
  /** The form as filed (`NPORT-P/A` for an amendment). */
  readonly form: string;
  readonly filerName: string;
  readonly cik: string;
  readonly filedOn: string | null;
  readonly periodEnding: string | null;
  readonly accession: string;
  /** The document read: an N-PORT's primary_doc.xml when it hit, else the first file that hit. */
  readonly url: string;
  readonly fileNames: readonly string[];
}

export interface IssuerSearch {
  readonly issuer: WatchlistIssuer;
  readonly filings: readonly IssuerFiling[];
  /** Days at the 10,000-hit ceiling even alone; filings past it are missing. */
  readonly truncatedDays: readonly string[];
}

export interface SearchOptions {
  readonly startDate: string;
  readonly endDate: string;
  readonly forms?: readonly SearchForm[];
  readonly onProgress?: (message: string) => void;
}

function documentFor(fileNames: readonly string[]): string {
  return fileNames.includes("primary_doc.xml") ? "primary_doc.xml" : (fileNames[0] ?? "");
}

/** One issuer's filings for one form family, every phrase's hits merged. */
export async function searchIssuerForm(
  client: SecClient,
  issuer: WatchlistIssuer,
  formFamily: SearchForm,
  options: SearchOptions,
): Promise<{ filings: IssuerFiling[]; truncatedDays: string[] }> {
  const hits: EftsHit[] = [];
  const truncatedDays: string[] = [];
  for (const phrase of issuer.searchPhrases) {
    const result = await searchFullText(client, {
      phrase,
      forms: [formFamily],
      startDate: options.startDate,
      endDate: options.endDate,
    });
    hits.push(...result.hits);
    truncatedDays.push(...result.truncatedDays);
  }
  const filings = filingsFromHits(hits)
    .filter((filing) => filing.cik.length > 0)
    .map((filing) => ({
      issuerSlug: issuer.slug,
      watchlisted: issuer.watchlisted,
      formFamily,
      form: filing.form,
      filerName: filing.filerName,
      cik: filing.cik,
      filedOn: filing.filedOn,
      periodEnding: filing.periodEnding,
      accession: filing.accession,
      url: filingDocumentUrl(filing.cik, filing.accession, documentFor(filing.fileNames)),
      fileNames: filing.fileNames,
    }));
  return { filings, truncatedDays };
}

export async function searchIssuers(
  client: SecClient,
  issuers: readonly WatchlistIssuer[],
  options: SearchOptions,
): Promise<IssuerSearch[]> {
  const results: IssuerSearch[] = [];
  for (const issuer of issuers) {
    const filings: IssuerFiling[] = [];
    const truncatedDays: string[] = [];
    for (const form of options.forms ?? SEARCH_FORMS) {
      const found = await searchIssuerForm(client, issuer, form, options);
      filings.push(...found.filings);
      truncatedDays.push(...found.truncatedDays);
      options.onProgress?.(`${issuer.slug} ${form}: ${found.filings.length} filings`);
    }
    results.push({ issuer, filings: sortFilings(filings), truncatedDays });
  }
  return results;
}

export function sortFilings(filings: readonly IssuerFiling[]): IssuerFiling[] {
  return [...filings].sort(
    (a, b) =>
      a.issuerSlug.localeCompare(b.issuerSlug) ||
      SEARCH_FORMS.indexOf(a.formFamily) - SEARCH_FORMS.indexOf(b.formFamily) ||
      (a.filedOn ?? "").localeCompare(b.filedOn ?? "") ||
      a.accession.localeCompare(b.accession),
  );
}

export const FILINGS_CSV_COLUMNS = [
  "issuer",
  "form",
  "filer",
  "cik",
  "family",
  "filed",
  "period",
  "accession",
  "url",
] as const;

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** data/index/filings-by-name.csv: fixed columns, fixed order, no run-dependent field. */
export function filingsCsv(
  searches: readonly IssuerSearch[],
  familyOf: (cik: string) => string,
): string {
  const rows = sortFilings(searches.flatMap((search) => search.filings)).map((filing) => [
    filing.issuerSlug,
    filing.form,
    filing.filerName,
    filing.cik,
    familyOf(filing.cik),
    filing.filedOn ?? "",
    filing.periodEnding ?? "",
    filing.accession,
    filing.url,
  ]);
  return `${[[...FILINGS_CSV_COLUMNS], ...rows].map((row) => row.map(csvField).join(",")).join("\n")}\n`;
}

export interface IssuerCounts {
  readonly slug: string;
  readonly name: string;
  readonly watchlisted: boolean;
  readonly byForm: Readonly<Record<SearchForm, number>>;
  readonly filings: number;
  readonly registrants: number;
  readonly families: number;
  /** Distinct families with an NPORT-P filing: the index's comparison set. */
  readonly nportFamilies: number;
  readonly latestFiled: string | null;
  readonly truncatedDays: readonly string[];
}

export function issuerCounts(
  searches: readonly IssuerSearch[],
  familyOf: (cik: string) => string,
): IssuerCounts[] {
  return searches.map(({ issuer, filings, truncatedDays }) => {
    const byForm = Object.fromEntries(
      SEARCH_FORMS.map((form) => [form, filings.filter((f) => f.formFamily === form).length]),
    ) as Record<SearchForm, number>;
    const nport = filings.filter((filing) => filing.formFamily === "NPORT-P");
    return {
      slug: issuer.slug,
      name: issuer.name,
      watchlisted: issuer.watchlisted,
      byForm,
      filings: filings.length,
      registrants: new Set(filings.map((filing) => filing.cik)).size,
      families: new Set(filings.map((filing) => familyOf(filing.cik))).size,
      nportFamilies: new Set(nport.map((filing) => familyOf(filing.cik))).size,
      latestFiled: filings.reduce<string | null>(
        (latest, filing) =>
          filing.filedOn !== null && (latest === null || filing.filedOn > latest)
            ? filing.filedOn
            : latest,
        null,
      ),
      truncatedDays,
    };
  });
}

/**
 * Densest first: most families filing N-PORT (where a name appears as a
 * holding; N-CSR text also names companies in commentary), then most
 * families, registrants and filings, then slug.
 */
export function byDensity(counts: readonly IssuerCounts[]): IssuerCounts[] {
  return [...counts].sort(
    (a, b) =>
      b.nportFamilies - a.nportFamilies ||
      b.families - a.families ||
      b.registrants - a.registrants ||
      b.filings - a.filings ||
      a.slug.localeCompare(b.slug),
  );
}

export function filerCountsMarkdown(
  counts: readonly IssuerCounts[],
  context: { fetchedAt: string; startDate: string; endDate: string; familiesVersion: string },
): string {
  const ordered = byDensity(counts);
  const densest = ordered.filter((row) => row.watchlisted).slice(0, 5);
  const row = (count: IssuerCounts) =>
    `| ${count.name} | \`${count.slug}\` | ${count.watchlisted ? "yes" : "candidate"} | ${count.byForm["NPORT-P"]} | ${count.byForm["N-CSR"]} | ${count.byForm["N-CSRS"]} | ${count.filings} | ${count.registrants} | ${count.families} | ${count.nportFamilies} | ${count.latestFiled ?? "—"} |`;
  const truncated = counts.filter((count) => count.truncatedDays.length > 0);
  return `# Filers per name

Fetched ${context.fetchedAt} by \`npm run index:search\` (EDGAR full-text search), filings dated ${context.startDate} to ${context.endDate}; families from \`data/index/filer-families.json\` version ${context.familiesVersion}. The rows behind every count are in \`filings-by-name.csv\`.

A filing counts when its text has one of the name's \`search_phrases\` as an exact phrase (\`data/index/watchlist.json\`); amendments (\`/A\`) count with their form. A phrase in a fund's text is not yet a holding: \`npm run index:ingest -- --source=nport\` reads each N-PORT's holdings against the name's \`match_pattern\`. Registrants are distinct filer CIKs; families group registrants under one adviser, and a CIK in no family is its own.

## The densest five (watchlist, by families filing N-PORT)

N-PORT lists a fund's holdings; N-CSR text also names companies in shareholder letters and commentary, so the N-PORT family count is the comparison set the index can use.

${densest.map((count, index) => `${index + 1}. ${count.name}: ${count.nportFamilies} families file N-PORT naming it; ${count.families} families, ${count.registrants} registrants and ${count.filings} filings across the three forms.`).join("\n")}

## Every name, densest first

| Name | Slug | Watchlist | NPORT-P | N-CSR | N-CSRS | Filings | Registrants | Families | N-PORT families | Latest filed |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${ordered.map(row).join("\n")}
${
  truncated.length === 0
    ? "\nNo query reached EDGAR's 10,000-hit ceiling after narrowing by date.\n"
    : `\nStill at EDGAR's 10,000-hit ceiling on a single day (filings past the ceiling are missing): ${truncated.map((count) => `${count.slug} (${count.truncatedDays.join(", ")})`).join("; ")}.\n`
}`;
}
