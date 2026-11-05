/**
 * Walks one EDGAR full-text search query to its last hit: pages of 100, and
 * a query at the 10,000-hit ceiling narrowed by halving its date range.
 */
import {
  EFTS_HIT_CEILING,
  type EftsHit,
  type EftsQuery,
  eftsQueryString,
  pageOffsets,
  parseEftsPage,
  splitDateRange,
} from "../parse/efts.js";
import { EFTS_SEARCH_URL, type SecClient } from "./sec.js";

export interface FullTextSearchResult {
  readonly hits: readonly EftsHit[];
  /** Single days still at the ceiling after narrowing; their hits past 10,000 are missing. */
  readonly truncatedDays: readonly string[];
  readonly requests: number;
}

export async function searchFullText(
  client: SecClient,
  query: EftsQuery,
): Promise<FullTextSearchResult> {
  const hits: EftsHit[] = [];
  const truncatedDays: string[] = [];
  let requests = 0;

  async function walk(startDate: string, endDate: string): Promise<void> {
    const ranged = { ...query, startDate, endDate };
    const first = parseEftsPage(
      await client.json(`${EFTS_SEARCH_URL}?${eftsQueryString(ranged, 0)}`),
    );
    requests += 1;
    if (first.atCeiling) {
      const halves = splitDateRange(startDate, endDate);
      if (halves !== null) {
        for (const [start, end] of halves) await walk(start, end);
        return;
      }
      truncatedDays.push(startDate);
    }
    hits.push(...first.hits);
    for (const from of pageOffsets(first.atCeiling ? EFTS_HIT_CEILING : first.total).slice(1)) {
      const page = parseEftsPage(
        await client.json(`${EFTS_SEARCH_URL}?${eftsQueryString(ranged, from)}`),
      );
      requests += 1;
      hits.push(...page.hits);
      if (page.hits.length === 0) break;
    }
  }

  await walk(query.startDate, query.endDate);
  return { hits, truncatedDays, requests };
}
