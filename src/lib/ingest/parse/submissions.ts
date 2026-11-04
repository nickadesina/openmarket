/**
 * EDGAR's submissions index for one filer
 * (https://data.sec.gov/submissions/CIK##########.json): its name and its
 * recent filings, parallel arrays newest first.
 */
import { z } from "zod";

const submissionsSchema = z.object({
  name: z.string(),
  filings: z.object({
    recent: z.object({
      accessionNumber: z.array(z.string()),
      form: z.array(z.string()),
      filingDate: z.array(z.string()),
      primaryDocument: z.array(z.string()),
    }),
  }),
});

export interface SubmissionFiling {
  readonly accession: string;
  readonly form: string;
  readonly filedOn: string;
  /** The raw document, without the `xslForm…/` rendering prefix EDGAR lists. */
  readonly primaryDocument: string;
}

export interface Submissions {
  readonly name: string;
  readonly filings: readonly SubmissionFiling[];
}

export function parseSubmissions(body: unknown): Submissions {
  const parsed = submissionsSchema.parse(body);
  const recent = parsed.filings.recent;
  return {
    name: parsed.name,
    filings: recent.accessionNumber.map((accession, index) => ({
      accession,
      form: recent.form[index] ?? "",
      filedOn: recent.filingDate[index] ?? "",
      primaryDocument: (recent.primaryDocument[index] ?? "").replace(/^xsl[^/]*\//, ""),
    })),
  };
}

/** The newest filing of `form` (amendments excluded), or null. */
export function latestFiling(submissions: Submissions, form: string): SubmissionFiling | null {
  return (
    submissions.filings
      .filter((filing) => filing.form === form)
      .sort((a, b) => b.filedOn.localeCompare(a.filedOn))[0] ?? null
  );
}

export function submissionsUrl(cik: string): string {
  return `https://data.sec.gov/submissions/CIK${cik.replace(/^0+/, "").padStart(10, "0")}.json`;
}
