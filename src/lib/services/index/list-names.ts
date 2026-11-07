/**
 * The daily page's rows (`GET /api/ref/names`, `/`): every watchlisted
 * issuer with its headline: the label and as-of date with the latest
 * consensus, its dispersion and family count; or, without one, why; the
 * latest filing date behind its marks, and its SPV and print
 * counts. Computed as the name page computes them (get-name-index.ts), from
 * the same rows under the same versions.
 */
import type { Kysely } from "kysely";

import type { Database } from "../../db/schema.js";
import type { FilerFamilies } from "../../engine/index/families.js";
import { loadFilerFamilies } from "./data-files.js";
import { getNameIndex, type NameIndex, type NoHeadline } from "./get-name-index.js";
import type { NameCoverage, NoMarks } from "./name-coverage.js";
import { type RefEnvelope, refEnvelope } from "./ref-envelope.js";

export interface NameRow {
  readonly slug: string;
  readonly name: string;
  readonly listed_on: string | null;
  /** The final prospectus the listing date is read from. */
  readonly listing_url: string | null;
  /** The headline label and as-of date (METHODOLOGY.md, "Headline label"); null without a headline. */
  readonly security_label: string | null;
  readonly as_of: string | null;
  readonly consensus_usd: number | null;
  readonly n_families: number | null;
  /** Null without a headline, or with a zero median. */
  readonly dispersion_pct: number | null;
  readonly dispersion_high_family: string | null;
  readonly dispersion_low_family: string | null;
  /** The newest filing date among the documents behind the issuer's live marks. */
  readonly latest_filed_on: string | null;
  readonly latest_as_of: string | null;
  readonly live_marks: number;
  readonly labels: number;
  readonly last_print: {
    readonly round_name: string;
    readonly announced_on: string;
    readonly post_money_usd: string | null;
    readonly price_per_share_usd: string | null;
    readonly source_url: string | null;
  } | null;
  readonly spv_vehicles: number;
  /** What full-text search found naming it; null when it was not searched. */
  readonly coverage: NameCoverage | null;
  /** Why it has no live mark; null when it has one. */
  readonly no_marks: NoMarks | null;
  /** Why it has no headline, in one sentence; null when it has one. */
  readonly no_headline: NoHeadline | null;
}

export interface NamesList extends RefEnvelope {
  readonly families_version: string;
  readonly names: readonly NameRow[];
}

export async function listNames(
  db: Kysely<Database>,
  options: { readonly families?: FilerFamilies; readonly now?: () => Date } = {},
): Promise<NamesList> {
  const now = (options.now ?? (() => new Date()))();
  const families = options.families ?? loadFilerFamilies();
  const slugs = await db
    .selectFrom("issuers")
    .select("slug")
    .where("watchlisted", "=", true)
    .orderBy("slug")
    .execute();
  // Every name at once: the pool queues the reads, and each name's arithmetic
  // runs while another's rows are in flight.
  const indexes = await Promise.all(
    slugs.map(({ slug }) => getNameIndex(db, slug, { families, now: () => now })),
  );
  const names = indexes.filter((index) => index !== null).map(nameRow);
  return { ...refEnvelope(now), families_version: families.version, names };
}

function nameRow(index: NameIndex): NameRow {
  const headline = index.headline;
  const point =
    headline === null
      ? undefined
      : index.labels
          .find((label) => label.security_label === headline.security_label)
          ?.consensus.find((entry) => entry.as_of === headline.as_of);
  return {
    slug: index.issuer.slug,
    name: index.issuer.name,
    listed_on: index.issuer.listed_on,
    listing_url: index.issuer.listing_url,
    security_label: headline?.security_label ?? null,
    as_of: headline?.as_of ?? null,
    consensus_usd: headline?.consensus_usd ?? null,
    n_families: headline?.n_families ?? null,
    dispersion_pct: headline?.dispersion_pct ?? null,
    dispersion_high_family: point?.dispersion?.high.family_slug ?? null,
    dispersion_low_family: point?.dispersion?.low.family_slug ?? null,
    latest_filed_on: index.marks_summary.latest_filed_on,
    latest_as_of: index.marks_summary.latest_as_of,
    live_marks: index.marks_summary.live,
    labels: index.labels.length,
    last_print:
      index.last_print === null
        ? null
        : {
            round_name: index.last_print.round_name,
            announced_on: index.last_print.announced_on,
            post_money_usd: index.last_print.post_money_usd,
            price_per_share_usd: index.last_print.price_per_share_usd,
            source_url: index.last_print.source_url,
          },
    spv_vehicles: index.spv.vehicles.length,
    coverage: index.coverage,
    no_marks: index.no_marks,
    no_headline: index.no_headline,
  };
}
