/**
 * The daily page's rows (`GET /api/ref/names`, `/`): every watchlisted
 * issuer with its headline label's latest consensus, dispersion, family
 * count, the latest filing date behind its marks, and its SPV and print
 * counts. Computed as the name page computes them (get-name-index.ts), from
 * the same rows under the same versions.
 */
import type { Kysely } from "kysely";

import type { Database } from "../../db/schema.js";
import type { FilerFamilies } from "../../engine/index/families.js";
import { loadFilerFamilies } from "./data-files.js";
import { getNameIndex, type NameIndex } from "./get-name-index.js";
import type { NameCoverage, NoMarks } from "./name-coverage.js";
import { type RefEnvelope, refEnvelope } from "./ref-envelope.js";

export interface NameRow {
  readonly slug: string;
  readonly name: string;
  readonly listed_on: string | null;
  /** The headline label and quarter (METHODOLOGY.md, "Headline label"); null without a per-share series. */
  readonly security_label: string | null;
  readonly quarter: string | null;
  readonly consensus_usd: number | null;
  readonly n_families: number | null;
  /** Null below two families. */
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
  } | null;
  readonly spv_vehicles: number;
  /** What full-text search found naming it; null when it was not searched. */
  readonly coverage: NameCoverage | null;
  /** Why it has no live mark; null when it has one. */
  readonly no_marks: NoMarks | null;
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
          ?.consensus.find((entry) => entry.quarter === headline.quarter);
  return {
    slug: index.issuer.slug,
    name: index.issuer.name,
    listed_on: index.issuer.listed_on,
    security_label: headline?.security_label ?? null,
    quarter: headline?.quarter ?? null,
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
          },
    spv_vehicles: index.spv.vehicles.length,
    coverage: index.coverage,
    no_marks: index.no_marks,
  };
}
