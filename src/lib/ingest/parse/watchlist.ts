/**
 * `data/index/watchlist.json`, validated: the names the index follows
 * (`names`, watchlisted) and the ones the search only counts (`candidates`).
 * `search_phrases` are the exact phrases full-text search looks for;
 * `match_pattern` is the regular expression (case-insensitive) a holding's
 * name or title must match to be that issuer's.
 */
import { z } from "zod";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function compiles(source: string): boolean {
  try {
    new RegExp(source, "i");
    return true;
  } catch {
    return false;
  }
}

const entrySchema = z
  .object({
    slug: z.string().regex(SLUG),
    name: z.string().trim().min(1),
    legal_name: z.string().trim().min(1).nullable().default(null),
    search_phrases: z.array(z.string().trim().min(2)).min(1),
    match_pattern: z.string().min(1).refine(compiles, "match_pattern must be a valid regex"),
    note: z.string().optional(),
  })
  .strict();

const watchlistSchema = z
  .object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    note: z.string().optional(),
    names: z.array(entrySchema).min(1),
    candidates: z.array(entrySchema).default([]),
  })
  .strict()
  .superRefine((watchlist, context) => {
    const seen = new Set<string>();
    for (const entry of [...watchlist.names, ...watchlist.candidates]) {
      if (seen.has(entry.slug)) {
        context.addIssue({ code: "custom", message: `duplicate slug ${entry.slug}` });
      }
      seen.add(entry.slug);
    }
  });

export type WatchlistFile = z.infer<typeof watchlistSchema>;

export interface WatchlistIssuer {
  readonly slug: string;
  readonly name: string;
  readonly legalName: string | null;
  readonly searchPhrases: readonly string[];
  readonly matchPattern: string;
  readonly watchlisted: boolean;
}

export interface Watchlist {
  readonly version: string;
  readonly issuers: readonly WatchlistIssuer[];
}

export function parseWatchlist(text: string): Watchlist {
  const file = watchlistSchema.parse(JSON.parse(text));
  const issuer = (watchlisted: boolean) => (entry: WatchlistFile["names"][number]) => ({
    slug: entry.slug,
    name: entry.name,
    legalName: entry.legal_name,
    searchPhrases: entry.search_phrases,
    matchPattern: entry.match_pattern,
    watchlisted,
  });
  return {
    version: file.version,
    issuers: [...file.names.map(issuer(true)), ...file.candidates.map(issuer(false))],
  };
}

/** An issuer's holding pattern, compiled as the index applies it (case-insensitive). */
export function issuerPattern(matchPattern: string): RegExp {
  return new RegExp(matchPattern, "i");
}

/** Whether a holding is the issuer's: its name or its title matches the pattern. */
export function holdingMatches(
  pattern: RegExp,
  holding: { readonly name: string; readonly title: string },
): boolean {
  return pattern.test(holding.name) || pattern.test(holding.title);
}
