/**
 * `data/index/watchlist.json`, validated: the names the index follows
 * (`names`, watchlisted) and the ones the search only counts (`candidates`).
 * `search_phrases` are the exact phrases full-text search looks for;
 * `match_pattern` is the regular expression (case-insensitive) a holding's
 * name or title must match to be that issuer's.
 *
 * Optional per name: `listing`, the issuer's final IPO prospectus on EDGAR
 * (marks as of its date or later are on listed stock; METHODOLOGY.md,
 * "Listed names"), and `form_d`, the phrases Form D full-text search looks
 * for and the pattern an SPV's own name must match to be matched to the
 * issuer (default: `search_phrases` and `match_pattern`). Vehicles name the
 * company the short way (`HII xAI-01`, `Cursor SPV1`), so they get their own.
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACCESSION = /^\d{10}-\d{2}-\d{6}$/;

const listingSchema = z
  .object({
    listed_on: z.string().regex(ISO_DATE),
    form: z.string().trim().min(1),
    accession: z.string().regex(ACCESSION),
    url: z.string().regex(/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//),
  })
  .strict();

const formDSchema = z
  .object({
    search_phrases: z.array(z.string().trim().min(2)).min(1),
    vehicle_pattern: z
      .string()
      .min(1)
      .refine(compiles, "form_d.vehicle_pattern must be a valid regex"),
  })
  .strict();

const entrySchema = z
  .object({
    slug: z.string().regex(SLUG),
    name: z.string().trim().min(1),
    legal_name: z.string().trim().min(1).nullable().default(null),
    search_phrases: z.array(z.string().trim().min(2)).min(1),
    match_pattern: z.string().min(1).refine(compiles, "match_pattern must be a valid regex"),
    listing: listingSchema.optional(),
    form_d: formDSchema.optional(),
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

export interface Listing {
  /** The final prospectus's filing date. */
  readonly listedOn: string;
  readonly form: string;
  readonly accession: string;
  readonly url: string;
}

export interface WatchlistIssuer {
  readonly slug: string;
  readonly name: string;
  readonly legalName: string | null;
  readonly searchPhrases: readonly string[];
  readonly matchPattern: string;
  readonly watchlisted: boolean;
  /** Absent while the issuer is private. */
  readonly listing?: Listing | null;
  /** Form D search phrases and vehicle-name pattern; absent means `searchPhrases` and `matchPattern`. */
  readonly formD?: { readonly searchPhrases: readonly string[]; readonly vehiclePattern: string };
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
    listing:
      entry.listing === undefined
        ? null
        : {
            listedOn: entry.listing.listed_on,
            form: entry.listing.form,
            accession: entry.listing.accession,
            url: entry.listing.url,
          },
    ...(entry.form_d === undefined
      ? {}
      : {
          formD: {
            searchPhrases: entry.form_d.search_phrases,
            vehiclePattern: entry.form_d.vehicle_pattern,
          },
        }),
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
