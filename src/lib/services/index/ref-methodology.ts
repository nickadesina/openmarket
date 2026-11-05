/**
 * `GET /api/ref/methodology`: the methodology's constants as the engine
 * exports them (`METHODOLOGY`, METHODOLOGY.md "Constants"), and the inputs
 * its rules read that exist as data: which security labels enter per-share
 * series, the listing dates the listed-names rule reads (from the issuers
 * table, synced from data/index/watchlist.json), and the filer-families file
 * the routes compute with. The rules themselves are prose, at /methodology.
 * `include=families` adds every family with its CIKs and evidence.
 */
import type { Kysely } from "kysely";

import type { Database } from "../../db/schema.js";
import type { FilerFamilies, FilerFamily } from "../../engine/index/families.js";
import { METHODOLOGY, type Methodology } from "../../engine/index/methodology.js";
import {
  COMMON,
  NOT_COMPARABLE_LABELS,
  SECURITY_KINDS,
  SERIES_LABEL_PATTERN,
} from "../../engine/index/series.js";
import { PUBLISHED_FILER_FAMILIES } from "./published-families.js";
import { type RefEnvelope, refEnvelope } from "./ref-envelope.js";

export interface RefMethodologyPayload extends RefEnvelope {
  readonly families_version: string;
  readonly methodology: Methodology;
  readonly security_labels: {
    /** Labels that enter per-share series: `Common`, and any label matching the pattern. */
    readonly per_share_common: string;
    readonly per_share_series_pattern: string;
    /** Labels published with the filer's marks that enter no per-share series. */
    readonly not_per_share: readonly string[];
    readonly security_kinds: readonly string[];
  };
  /** Names whose final IPO prospectus is on EDGAR: marks as of this date or later enter no series. */
  readonly listings: readonly {
    readonly slug: string;
    readonly name: string;
    readonly listed_on: string;
    readonly listing_url: string | null;
  }[];
  readonly families: {
    readonly version: string;
    readonly note: string | null;
    readonly n_families: number;
    readonly n_ciks: number;
    /** Every family; only with `include=families`. */
    readonly list?: readonly FilerFamily[];
  };
}

export async function getRefMethodology(
  db: Kysely<Database>,
  query: { readonly includeFamilies: boolean },
  options: { readonly now: Date; readonly families?: FilerFamilies },
): Promise<RefMethodologyPayload> {
  const families = options.families ?? PUBLISHED_FILER_FAMILIES;
  const listings = await db
    .selectFrom("issuers")
    .select(["slug", "name", "listed_on", "listing_url"])
    .where("listed_on", "is not", null)
    .orderBy("listed_on")
    .orderBy("slug")
    .execute();
  return {
    ...refEnvelope(options.now),
    families_version: families.version,
    methodology: METHODOLOGY,
    security_labels: {
      per_share_common: COMMON,
      per_share_series_pattern: SERIES_LABEL_PATTERN.source,
      not_per_share: NOT_COMPARABLE_LABELS,
      security_kinds: SECURITY_KINDS,
    },
    listings: listings.map((row) => ({
      slug: row.slug,
      name: row.name,
      listed_on: row.listed_on!,
      listing_url: row.listing_url,
    })),
    families: {
      version: families.version,
      note: families.note ?? null,
      n_families: families.families.length,
      n_ciks: families.families.reduce((sum, family) => sum + family.ciks.length, 0),
      ...(query.includeFamilies ? { list: families.families } : {}),
    },
  };
}
