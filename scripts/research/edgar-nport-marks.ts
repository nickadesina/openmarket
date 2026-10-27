/**
 * Mutual-fund marks on private companies from SEC N-PORT filings: every
 * NPORT-P whose text names Anthropic, OpenAI, Anduril or Modal Labs, each
 * matching holding's reported value and shares, one row per fund, quarter and
 * holding (docs/prompts/tradeables, "Research scripts"). The mark-dispersion
 * figure the case study promises is read from this; nothing here is published
 * until Nick reads it.
 *
 *   SEC_USER_AGENT="OpenMarket Research you@example.com" \
 *     npx tsx scripts/research/edgar-nport-marks.ts [--since=2024-01-01]
 *
 * SEC's fair-access rules: every request declares who is asking in its
 * User-Agent (a name and a contact email; the script refuses to run without
 * SEC_USER_AGENT) and stays under ten requests a second (one every 150 ms
 * here, with backoff on 429 and 5xx).
 *
 * Writes docs/research/fund-marks.csv and docs/research/fund-marks.README.md.
 * Idempotent: each run rewrites both, rows in a fixed order, and records when
 * it fetched.
 *
 * Sources:
 * - EDGAR full-text search, https://efts.sec.gov/LATEST/search-index (forms
 *   NPORT-P, the company's name as a phrase), for the filings.
 * - Each filing's primary_doc.xml under https://www.sec.gov/Archives/edgar/data,
 *   the N-PORT form itself: genInfo for the registrant, series and report
 *   period; invstOrSec for each holding (name, title, balance, units, valUSD,
 *   pctVal, fairValLevel).
 */
import { getJson, politeFetcher, writeCsv, writeText } from "./lib.js";

const EFTS = "https://efts.sec.gov/LATEST/search-index";
const ARCHIVES = "https://www.sec.gov/Archives/edgar/data";
const CSV = "docs/research/fund-marks.csv";
const README = "docs/research/fund-marks.README.md";
const PAGE_SIZE = 100;

/** The full-text phrase, and how a holding's name or title must match it. */
const COMPANIES: readonly (readonly [string, string, RegExp])[] = [
  ["Anthropic", "Anthropic", /\bAnthropic\b/i],
  ["OpenAI", "OpenAI", /\bOpen ?AI\b/i],
  ["Anduril", "Anduril", /\bAnduril\b/i],
  ["Modal", "Modal Labs", /\bModal Labs\b/i],
];

const COLUMNS = [
  "company",
  "registrant",
  "series",
  "series_id",
  "cik",
  "accession",
  "filed",
  "period_end",
  "holding_name",
  "holding_title",
  "asset_category",
  "balance",
  "units",
  "value_usd",
  "pct_of_net_assets",
  "fair_value_level",
  "restricted",
  "value_per_unit_usd",
  "filing_url",
] as const;

interface SearchHit {
  readonly _id: string;
  readonly _source: {
    readonly ciks?: readonly string[];
    readonly adsh?: string;
    readonly file_date?: string;
    readonly period_ending?: string;
    readonly form?: string;
  };
}

interface SearchBody {
  readonly hits?: {
    readonly total?: { readonly value?: number };
    readonly hits?: readonly SearchHit[];
  };
}

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

/** The text of the first <tag>…</tag> inside `xml`, entities decoded; empty when absent. */
export function tagText(xml: string, tag: string): string {
  const match = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`).exec(xml);
  if (match === null) return "";
  return match[1]!
    .trim()
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

/** Every <invstOrSec> block of an N-PORT primary document. */
export function holdings(xml: string): string[] {
  return [...xml.matchAll(/<(?:\w+:)?invstOrSec\b[^>]*>([\s\S]*?)<\/(?:\w+:)?invstOrSec>/g)].map(
    (match) => match[1]!,
  );
}

/** An attribute's value on the first element named `tag`; empty when absent. */
function attribute(xml: string, tag: string, name: string): string {
  const element = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*)>`).exec(xml)?.[1] ?? "";
  return new RegExp(`\\b${name}="([^"]*)"`).exec(element)?.[1] ?? "";
}

export interface NportHolding {
  readonly holding_name: string;
  readonly holding_title: string;
  readonly asset_category: string;
  readonly balance: string;
  readonly units: string;
  readonly value_usd: string;
  readonly pct_of_net_assets: string;
  readonly fair_value_level: string;
  readonly restricted: string;
  readonly value_per_unit_usd: string;
}

/** The holdings in an N-PORT document whose name or title matches `pattern`. */
export function matchingHoldings(xml: string, pattern: RegExp): NportHolding[] {
  return holdings(xml)
    .filter(
      (block) => pattern.test(tagText(block, "name")) || pattern.test(tagText(block, "title")),
    )
    .map((block) => {
      const balance = tagText(block, "balance");
      const value = tagText(block, "valUSD");
      const perUnit = Number(value) / Number(balance);
      return {
        holding_name: tagText(block, "name"),
        holding_title: tagText(block, "title"),
        asset_category:
          tagText(block, "assetCat") || attribute(block, "assetConditional", "assetCat"),
        balance,
        units: tagText(block, "units"),
        value_usd: value,
        pct_of_net_assets: tagText(block, "pctVal"),
        fair_value_level: tagText(block, "fairValLevel"),
        restricted: tagText(block, "isRestrictedSec"),
        value_per_unit_usd: Number.isFinite(perUnit) && Number(balance) > 0 ? String(perUnit) : "",
      };
    });
}

type Get = (url: string) => Promise<Response>;

/** Every NPORT-P filed in the window whose text has the phrase, by accession number. */
async function searchFilings(
  get: Get,
  phrase: string,
  since: string,
  until: string,
): Promise<Map<string, SearchHit>> {
  const filings = new Map<string, SearchHit>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const url = `${EFTS}?q=${encodeURIComponent(`"${phrase}"`)}&forms=NPORT-P&dateRange=custom&startdt=${since}&enddt=${until}&from=${from}`;
    const hits = (await getJson<SearchBody>(get, url)).hits?.hits ?? [];
    for (const hit of hits) {
      const accession = hit._source.adsh ?? hit._id.split(":")[0]!;
      if (!filings.has(accession)) filings.set(accession, hit);
    }
    if (hits.length < PAGE_SIZE) return filings;
  }
}

/** The matching holdings of each filing, one row per fund, period and holding. */
async function filingRows(
  get: Get,
  company: string,
  pattern: RegExp,
  filings: ReadonlyMap<string, SearchHit>,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (const [accession, hit] of filings) {
    const cik = String(Number(hit._source.ciks?.[0] ?? ""));
    const url = `${ARCHIVES}/${cik}/${accession.replaceAll("-", "")}/primary_doc.xml`;
    const response = await get(url);
    if (!response.ok) {
      console.warn(`skipped ${accession}: ${response.status} from ${url}`);
      continue;
    }
    const xml = await response.text();
    for (const holding of matchingHoldings(xml, pattern)) {
      rows.push({
        company,
        registrant: tagText(xml, "regName"),
        series: tagText(xml, "seriesName"),
        series_id: tagText(xml, "seriesId"),
        cik,
        accession,
        filed: hit._source.file_date ?? "",
        period_end: tagText(xml, "repPdDate") || (hit._source.period_ending ?? ""),
        ...holding,
        filing_url: url,
      });
    }
  }
  return rows;
}

async function main(): Promise<void> {
  const userAgent = process.env.SEC_USER_AGENT?.trim() ?? "";
  if (!/\S+@\S+\.\S+/.test(userAgent)) {
    throw new Error(
      'set SEC_USER_AGENT to a name and contact email, e.g. "OpenMarket Research you@example.com"',
    );
  }
  const since = argument("since") ?? "2024-01-01";
  const until = new Date().toISOString().slice(0, 10);
  const get = politeFetcher({
    minGapMs: 150,
    headers: { "User-Agent": userAgent, "Accept-Encoding": "gzip, deflate" },
  });
  const fetchedAt = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  const counts: string[] = [];

  for (const [company, phrase, pattern] of COMPANIES) {
    const filings = await searchFilings(get, phrase, since, until);
    const found = await filingRows(get, company, pattern, filings);
    rows.push(...found);
    counts.push(
      `- ${company}: ${filings.size} NPORT-P filings name "${phrase}"; ${found.length} matching holdings.`,
    );
    console.log(`${company}: ${filings.size} filings, ${found.length} holdings`);
  }

  rows.sort(
    (a, b) =>
      String(a.company).localeCompare(String(b.company)) ||
      String(a.period_end).localeCompare(String(b.period_end)) ||
      String(a.registrant).localeCompare(String(b.registrant)) ||
      String(a.series).localeCompare(String(b.series)) ||
      String(a.holding_title).localeCompare(String(b.holding_title)),
  );
  writeCsv(CSV, COLUMNS, rows);
  writeText(
    README,
    `# Fund marks on private companies, from N-PORT

Fetched ${fetchedAt} by \`scripts/research/edgar-nport-marks.ts\`, filings ${since} to ${until}. Private research input; not published.

What it pulled: NPORT-P filings whose text names Anthropic, OpenAI, Anduril or "Modal Labs", found with EDGAR full-text search (${EFTS}), and in each filing's primary_doc.xml every holding whose name or title matches the company. One row per fund (series), report period and holding.

- \`value_usd\` and \`balance\` are as the fund reported them (valUSD, balance, units). \`value_per_unit_usd\` is their ratio, the fund's mark per share or unit when units are shares; compare marks only where units agree.
- \`period_end\` is the report period (repPdDate). N-PORT is filed monthly but only the quarter's last month is public, so there is one public mark per fund per quarter.
- A holding can be preferred stock of one series, a SAFE, a note or an SPV interest; \`holding_title\` and \`asset_category\` say which.
- Full-text search returns at most 10,000 hits per query; a company near that limit needs a narrower date range.

Counts this run:
${counts.join("\n")}
- ${rows.length} rows in all.
`,
  );
  console.log(`wrote ${CSV} (${rows.length} rows) and ${README}`);
}

if (process.argv[1]?.endsWith("edgar-nport-marks.ts")) {
  try {
    await main();
  } catch (error: unknown) {
    console.error("N-PORT pull failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
