/**
 * Everything one name page needs (`GET /api/ref/[slug]`, `/n/[slug]`),
 * computed with the engine (src/lib/engine/index/) from the tables: per
 * label the consensus and dispersion on each as-of date, each family's marks with the
 * documents behind them, revisions and mark versus print; the prints; the
 * live certificate's structure table and its common-equivalent result; and
 * the SPV vehicles and quotes with premiums. Nothing is stored; everything
 * is recomputed from the rows under the versions the payload names.
 *
 * Which marks enter the per-share series: live rows (not superseded) with a
 * per-share mark, on a label that enters per-share series, and private
 * (as of before the issuer's listing date, `isPrivateMark`). Every live row
 * is still counted in `marks_summary`, and is served by the marks route.
 */
import type { Kysely } from "kysely";

import type { Database } from "../../db/schema.js";
import { type ConsensusPoint, consensusSeries } from "../../engine/index/consensus.js";
import {
  type FamilyMark,
  type FilerFamilies,
  type FundMarkInput,
  familyMarks,
} from "../../engine/index/families.js";
import { headlinePoint, isPrivateMark } from "../../engine/index/listing.js";
import { METHODOLOGY } from "../../engine/index/methodology.js";
import {
  type MarkVersusPrint,
  markVersusPrint,
  type PrintInput,
} from "../../engine/index/print.js";
import { type Revision, revisions } from "../../engine/index/revisions.js";
import { isComparableLabel } from "../../engine/index/series.js";
import { type SpvPremium, spvPremium } from "../../engine/index/spv.js";
import {
  type CertificateInput,
  type CommonEquivalent,
  commonEquivalent,
  type StructureGap,
  structureGap,
  type Unsupported,
} from "../../engine/index/waterfall.js";
import { loadFilerFamilies } from "./data-files.js";
import { PRINT_EVENT_TYPES } from "./import-certificates.js";
import { type NameCoverage, type NoMarks, nameCoverage, noMarksReason } from "./name-coverage.js";
import { type RefEnvelope, refEnvelope } from "./ref-envelope.js";

export interface DocumentRef {
  readonly source_class: string;
  readonly accession: string | null;
  readonly document_url: string;
  readonly filer_name: string;
  readonly filed_on: string | null;
}

export interface MarkDocument extends DocumentRef {
  readonly mark_id: string;
  readonly filer_cik: string | null;
  readonly fund_series_id: string | null;
  readonly fund_series_name: string | null;
  readonly holding_title: string;
  readonly balance: string | null;
  readonly value_usd: string;
  readonly mark_per_share_usd: string | null;
}

export interface FamilyMarkPayload {
  readonly family_slug: string;
  readonly family_name: string;
  /** False when the registrant is not in filer-families.json and stands as its own family. */
  readonly family_mapped: boolean;
  readonly as_of: string;
  readonly mark_per_share_usd: number;
  readonly n_funds: number;
  readonly min_fund_mark_usd: number;
  readonly max_fund_mark_usd: number;
  readonly intra_family_split: boolean;
  readonly documents: readonly MarkDocument[];
  readonly mark_vs_print: MarkVsPrintPayload;
}

export type MarkVsPrintPayload =
  | {
      readonly status: "ok";
      readonly ln: number;
      readonly round_name: string;
      readonly announced_on: string;
      readonly series_label: string | null;
      readonly price_per_share_usd: number;
      readonly match: "newest_series" | "same_label";
    }
  | { readonly status: "none"; readonly reason: string };

export interface DispersionFamilyPayload {
  readonly family_slug: string;
  readonly family_name: string;
  readonly mark_per_share_usd: number;
  readonly as_of: string;
}

/** One label on one as-of date: every family's mark as of that date, and their consensus. */
export interface ConsensusPayload {
  /** The as-of date every family mark of the point shares (METHODOLOGY.md, "Comparison date"). */
  readonly as_of: string;
  readonly n_families: number;
  /** Median of the family marks; null below `min_families_for_consensus` families. */
  readonly consensus_usd: number | null;
  /** Null below `min_families_for_dispersion` families, or with a zero median. */
  readonly dispersion: {
    readonly pct: number;
    readonly high: DispersionFamilyPayload;
    readonly low: DispersionFamilyPayload;
  } | null;
  /** Every family's mark as of the date. */
  readonly families: readonly DispersionFamilyPayload[];
  /** The consensus against the last print as of the date; `no_consensus` without a consensus. */
  readonly mark_vs_print: MarkVsPrintPayload;
}

export interface RevisionPayload {
  readonly family_slug: string;
  readonly family_name: string;
  readonly from_as_of: string;
  readonly to_as_of: string;
  readonly from_mark_usd: number;
  readonly to_mark_usd: number;
  readonly ln: number | null;
  readonly direction: "up" | "down";
  readonly role: "leader" | "follower";
  readonly leader_family_slug: string | null;
  readonly leader_as_of: string | null;
  readonly lag_days: number | null;
}

export interface LabelPayload {
  readonly security_label: string;
  readonly consensus: readonly ConsensusPayload[];
  readonly family_marks: readonly FamilyMarkPayload[];
  readonly revisions: readonly RevisionPayload[];
}

export interface PrintPayload {
  readonly round_name: string;
  readonly event_type: string;
  readonly announced_on: string;
  readonly post_money_usd: string | null;
  readonly amount_raised_usd: string | null;
  readonly series_label: string | null;
  readonly price_per_share_usd: string | null;
  readonly source_url: string | null;
  readonly origin: string;
  /** The certificate that prices it; null until one is imported. */
  readonly price_source: DocumentRef | null;
}

export interface CertificateSeriesPayload {
  readonly series_label: string;
  readonly original_issue_price_usd: string;
  readonly liquidation_multiple: string;
  readonly participating: boolean;
  readonly participation_cap_multiple: string | null;
  readonly seniority: number;
  readonly shares_authorized: string;
  readonly conversion_price_usd: string | null;
  readonly ratchet: unknown;
}

export interface StructurePayload {
  readonly certificate: {
    readonly filed_on: string;
    readonly kind: string;
    readonly entered_by: string;
    readonly newest_series_label: string;
    readonly common_shares_authorized: string | null;
    readonly unmodelled_terms: readonly string[];
    readonly document: DocumentRef & { readonly content_sha256: string };
    readonly series: readonly CertificateSeriesPayload[];
  };
  /** The round the certificate prices, whose headline the conversion is evaluated at; null when none is linked. */
  readonly round: { readonly round_name: string; readonly post_money_usd: string | null } | null;
  readonly common_equivalent:
    | (Omit<CommonEquivalent, "waterfall"> & { readonly waterfall: CommonEquivalent["waterfall"] })
    | Unsupported
    | { readonly status: "no_headline"; readonly reason: string };
  readonly structure_gap:
    | StructureGap
    | Unsupported
    | { readonly status: "no_headline"; readonly reason: string };
}

export interface SpvVehiclePayload {
  readonly vehicle_name: string;
  readonly vehicle_cik: string;
  readonly match_method: string;
  readonly match_note: string | null;
  /** The vehicle's latest Form D. */
  readonly latest_filing: DocumentRef & {
    readonly total_offering_usd: string | null;
    readonly total_sold_usd: string | null;
    readonly min_investment_usd: string | null;
    readonly sales_commission_usd: string | null;
    readonly finders_fee_usd: string | null;
    readonly first_sale_on: string | null;
    readonly jurisdiction: string | null;
    readonly related_persons: unknown;
  };
  readonly n_filings: number;
}

export interface SpvQuotePayload {
  readonly platform: string;
  readonly captured_at: string;
  readonly document: DocumentRef & { readonly content_sha256: string };
  readonly vehicle_cik: string | null;
  readonly quoted_price_per_share_usd: string | null;
  readonly quoted_valuation_usd: string | null;
  readonly upfront_fee_pct: string | null;
  readonly mgmt_fee_pct: string | null;
  readonly carry_pct: string | null;
  readonly layers: number;
  /** Against the headline label's latest consensus on or before the capture. */
  readonly premium:
    | (Extract<SpvPremium, { status: "ok" }> & {
        readonly security_label: string;
        readonly consensus_as_of: string;
      })
    | { readonly status: "none"; readonly reason: string };
}

export interface MarksSummary {
  /** Live rows (not superseded) for the issuer. */
  readonly live: number;
  /** Rows that entered the per-share series. */
  readonly in_series: number;
  readonly no_per_share: number;
  readonly not_comparable_label: number;
  readonly after_listing: number;
  readonly latest_filed_on: string | null;
  readonly latest_as_of: string | null;
}

/** A live mark that entered no per-share series, as filed, with the date it is as of. */
export interface OutOfSeriesMark extends MarkDocument {
  readonly as_of: string;
}

/** How many marks of one label stayed out of the per-share series, why, and the latest as filed. */
export interface OutOfSeriesGroup {
  readonly status: Exclude<SeriesStatus, "in_series">;
  readonly security_label: string;
  /** Why these marks enter no series, in one sentence (METHODOLOGY.md). */
  readonly reason: string;
  readonly n_marks: number;
  readonly n_filers: number;
  readonly latest_as_of: string;
  /** The newest marks by as-of date (then filing date), at most OUT_OF_SERIES_RECENT. */
  readonly recent: readonly OutOfSeriesMark[];
}

export interface NameIndex extends RefEnvelope {
  readonly families_version: string;
  readonly issuer: {
    readonly slug: string;
    readonly name: string;
    readonly legal_name: string | null;
    readonly watchlisted: boolean;
    readonly incorporation_state: string | null;
    readonly incorporation_source: DocumentRef | null;
    readonly listed_on: string | null;
    readonly listing_url: string | null;
  };
  readonly marks_summary: MarksSummary;
  /** What full-text search found naming it (data/index/filing-counts.json); null when it was not searched. */
  readonly coverage: NameCoverage | null;
  /** Why it has no live mark; null when it has one. */
  readonly no_marks: NoMarks | null;
  /** Live marks published as filed that enter no per-share series, by reason and label. */
  readonly out_of_series: readonly OutOfSeriesGroup[];
  /** The label and as-of date the daily page leads with (METHODOLOGY.md, "Headline label"). */
  readonly headline: {
    readonly security_label: string;
    readonly as_of: string;
    readonly consensus_usd: number;
    readonly n_families: number;
    readonly dispersion_pct: number | null;
  } | null;
  /** Why there is no headline, in one sentence from the rows; null when there is one. */
  readonly no_headline: NoHeadline | null;
  readonly labels: readonly LabelPayload[];
  /** The latest priced round (or IPO) on or before today; null without one. */
  readonly last_print: PrintPayload | null;
  /** Every print: priced rounds and IPOs, and Form D offerings as evidence of size and date. */
  readonly prints: readonly PrintPayload[];
  readonly structure: StructurePayload | null;
  readonly spv: {
    readonly vehicles: readonly SpvVehiclePayload[];
    readonly quotes: readonly SpvQuotePayload[];
  };
}

export interface NoHeadline {
  /**
   * `no_marks`: no live mark; `no_per_share_series`: no live mark enters a
   * per-share series; `too_few_families`: no as-of date has
   * `min_families_for_consensus` families on one label.
   */
  readonly code: "no_marks" | "no_per_share_series" | "too_few_families";
  readonly reason: string;
}

export interface NameIndexOptions {
  readonly families?: FilerFamilies;
  readonly now?: () => Date;
}

function documentRef(row: {
  source_class: string;
  accession: string | null;
  document_url: string;
  filer_name: string;
  filed_on: string | null;
}): DocumentRef {
  return {
    source_class: row.source_class,
    accession: row.accession,
    document_url: row.document_url,
    filer_name: row.filer_name,
    filed_on: row.filed_on,
  };
}

function markVsPrintPayload(result: MarkVersusPrint): MarkVsPrintPayload {
  if (result.status === "none") return { status: "none", reason: result.reason };
  return {
    status: "ok",
    ln: result.ln,
    round_name: result.roundName,
    announced_on: result.announcedOn,
    series_label: result.seriesLabel,
    price_per_share_usd: result.pricePerShareUsd,
    match: result.match,
  };
}

interface MarkRow {
  readonly id: string;
  readonly security_label: string;
  readonly as_of: string;
  readonly mark_per_share_usd: string | null;
  readonly holding_title: string;
  readonly balance: string | null;
  readonly value_usd: string;
  readonly source_class: string;
  readonly accession: string | null;
  readonly document_url: string;
  readonly filer_cik: string | null;
  readonly filer_name: string;
  readonly fund_series_id: string | null;
  readonly fund_series_name: string | null;
  readonly filed_on: string | null;
}

async function liveMarks(db: Kysely<Database>, issuerId: string): Promise<MarkRow[]> {
  return db
    .selectFrom("filer_marks")
    .innerJoin("source_documents", "source_documents.id", "filer_marks.document_id")
    .select([
      "filer_marks.id",
      "filer_marks.security_label",
      "filer_marks.as_of",
      "filer_marks.mark_per_share_usd",
      "filer_marks.holding_title",
      "filer_marks.balance",
      "filer_marks.value_usd",
      "source_documents.source_class",
      "source_documents.accession",
      "source_documents.document_url",
      "source_documents.filer_cik",
      "source_documents.filer_name",
      "source_documents.fund_series_id",
      "source_documents.fund_series_name",
      "source_documents.filed_on",
    ])
    .where("filer_marks.issuer_id", "=", issuerId)
    .where("filer_marks.superseded_by", "is", null)
    .orderBy("filer_marks.id")
    .execute();
}

/** Whether a live mark enters the per-share series, or which rule keeps it out (in this order). */
export type SeriesStatus = "in_series" | "no_per_share" | "not_comparable_label" | "after_listing";

export function seriesStatus(
  row: {
    readonly mark_per_share_usd: string | null;
    readonly filer_cik: string | null;
    readonly security_label: string;
    readonly as_of: string;
  },
  listedOn: string | null,
): SeriesStatus {
  if (row.mark_per_share_usd === null || row.filer_cik === null) return "no_per_share";
  if (!isComparableLabel(row.security_label)) return "not_comparable_label";
  if (!isPrivateMark(row.as_of, listedOn)) return "after_listing";
  return "in_series";
}

/** Splits live marks into the series' inputs and the counts of what stayed out. */
export function seriesInputs(
  rows: readonly MarkRow[],
  listedOn: string | null,
): { inputs: FundMarkInput[]; summary: MarksSummary } {
  const inputs: FundMarkInput[] = [];
  let noPerShare = 0;
  let notComparable = 0;
  let afterListing = 0;
  let latestFiled: string | null = null;
  let latestAsOf: string | null = null;
  for (const row of rows) {
    if (row.filed_on !== null && (latestFiled === null || row.filed_on > latestFiled)) {
      latestFiled = row.filed_on;
    }
    if (latestAsOf === null || row.as_of > latestAsOf) latestAsOf = row.as_of;
    const status = seriesStatus(row, listedOn);
    if (status === "no_per_share") noPerShare += 1;
    else if (status === "not_comparable_label") notComparable += 1;
    else if (status === "after_listing") afterListing += 1;
    else {
      inputs.push({
        id: row.id,
        filerCik: row.filer_cik!,
        filerName: row.filer_name,
        fundSeriesId: row.fund_series_id,
        securityLabel: row.security_label,
        asOf: row.as_of,
        markPerShareUsd: Number(row.mark_per_share_usd),
      });
    }
  }
  return {
    inputs,
    summary: {
      live: rows.length,
      in_series: inputs.length,
      no_per_share: noPerShare,
      not_comparable_label: notComparable,
      after_listing: afterListing,
      latest_filed_on: latestFiled,
      latest_as_of: latestAsOf,
    },
  };
}

/** The newest marks each out-of-series group lists in full; the marks route serves the rest. */
export const OUT_OF_SERIES_RECENT = 12;

const UNCLASSIFIED = "Unclassified";

/** Why a mark stays out of the series, as METHODOLOGY.md states the rule. */
export function outOfSeriesReason(
  status: Exclude<SeriesStatus, "in_series">,
  securityLabel: string,
  listedOn: string | null,
): string {
  if (status === "no_per_share")
    return "No per-share mark: the balance is not counted in shares (N-PORT units other than NS) or is not above zero, so the row counts toward value only (METHODOLOGY.md, The unit).";
  if (status === "after_listing")
    return `As of on or after ${listedOn}, the date of the final IPO prospectus: a listed-stock mark, set from the market rather than by a valuation committee (METHODOLOGY.md, Listed names).`;
  if (securityLabel === UNCLASSIFIED)
    return "The classifier names no security for it: the title names no series or class (often the issuer's name alone), or one the holding's name contradicts, or it is a right, swap, loan, debt or derivative. Which security it is is not known, so it is compared with nothing (METHODOLOGY.md, Security labels).";
  return `One ${securityLabel} label covers instruments with different terms (vehicle, strike, cap, principal), so a per-share figure on one is not compared with another's (METHODOLOGY.md, Security labels).`;
}

/** Live marks outside the series, grouped by reason and label, largest group first. */
export function outOfSeriesGroups(
  rows: readonly MarkRow[],
  listedOn: string | null,
): OutOfSeriesGroup[] {
  const groups = new Map<string, { status: Exclude<SeriesStatus, "in_series">; rows: MarkRow[] }>();
  for (const row of rows) {
    const status = seriesStatus(row, listedOn);
    if (status === "in_series") continue;
    const key = `${status}\u0000${row.security_label}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { status, rows: [row] });
    else group.rows.push(row);
  }
  return [...groups.values()]
    .map(({ status, rows: members }) => {
      const sorted = [...members].sort(
        (a, b) =>
          b.as_of.localeCompare(a.as_of) ||
          (b.filed_on ?? "").localeCompare(a.filed_on ?? "") ||
          a.filer_name.localeCompare(b.filer_name) ||
          a.id.localeCompare(b.id),
      );
      const securityLabel = sorted[0]!.security_label;
      return {
        status,
        security_label: securityLabel,
        reason: outOfSeriesReason(status, securityLabel, listedOn),
        n_marks: members.length,
        n_filers: new Set(members.map((row) => row.filer_cik ?? row.filer_name)).size,
        latest_as_of: sorted[0]!.as_of,
        recent: sorted
          .slice(0, OUT_OF_SERIES_RECENT)
          .map((row) => ({ ...markDocument(row), as_of: row.as_of })),
      };
    })
    .sort(
      (a, b) =>
        b.n_marks - a.n_marks ||
        a.status.localeCompare(b.status) ||
        a.security_label.localeCompare(b.security_label),
    );
}

function dispersionFamily(point: {
  familySlug: string;
  familyName: string;
  markPerShareUsd: number;
  asOf: string;
}): DispersionFamilyPayload {
  return {
    family_slug: point.familySlug,
    family_name: point.familyName,
    mark_per_share_usd: point.markPerShareUsd,
    as_of: point.asOf,
  };
}

function consensusPayload(point: ConsensusPoint, prints: readonly PrintInput[]): ConsensusPayload {
  return {
    as_of: point.asOf,
    n_families: point.nFamilies,
    consensus_usd: point.consensusUsd,
    dispersion:
      point.dispersion === null
        ? null
        : {
            pct: point.dispersion.pct,
            high: dispersionFamily(point.dispersion.high),
            low: dispersionFamily(point.dispersion.low),
          },
    families: point.families.map(dispersionFamily),
    mark_vs_print:
      point.consensusUsd === null
        ? { status: "none", reason: "no_consensus" }
        : markVsPrintPayload(
            markVersusPrint(
              {
                securityLabel: point.securityLabel,
                asOf: point.asOf,
                markPerShareUsd: point.consensusUsd,
              },
              prints,
            ),
          ),
  };
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** Why a name has no headline, from its rows (null when it has one). */
export function noHeadline(
  headline: ConsensusPoint | null,
  points: readonly ConsensusPoint[],
  summary: MarksSummary,
  noMarks: NoMarks | null,
): NoHeadline | null {
  if (headline !== null) return null;
  if (summary.live === 0) {
    return { code: "no_marks", reason: noMarks?.reason ?? "No live filer mark." };
  }
  if (points.length === 0) {
    return {
      code: "no_per_share_series",
      reason: `${plural(summary.live, "live mark")}, none of them in a per-share series: each is published as filed on the name page, with the rule that keeps it out.`,
    };
  }
  // The point with the most families, the latest on a tie, then the label's name.
  const most = [...points].sort(
    (a, b) =>
      b.nFamilies - a.nFamilies ||
      b.asOf.localeCompare(a.asOf) ||
      a.securityLabel.localeCompare(b.securityLabel),
  )[0]!;
  return {
    code: "too_few_families",
    reason: `No as-of date has ${METHODOLOGY.min_families_for_consensus} families on one security; the most is ${plural(most.nFamilies, "family", "families")} (${most.securityLabel}, ${most.asOf}).`,
  };
}

function revisionPayload(revision: Revision): RevisionPayload {
  return {
    family_slug: revision.familySlug,
    family_name: revision.familyName,
    from_as_of: revision.fromAsOf,
    to_as_of: revision.toAsOf,
    from_mark_usd: revision.fromMarkUsd,
    to_mark_usd: revision.toMarkUsd,
    ln: revision.ln,
    direction: revision.direction,
    role: revision.role,
    leader_family_slug: revision.leaderFamilySlug,
    leader_as_of: revision.leaderAsOf,
    lag_days: revision.lagDays,
  };
}

function markDocument(row: MarkRow): MarkDocument {
  return {
    ...documentRef(row),
    mark_id: row.id,
    filer_cik: row.filer_cik,
    fund_series_id: row.fund_series_id,
    fund_series_name: row.fund_series_name,
    holding_title: row.holding_title,
    balance: row.balance,
    value_usd: row.value_usd,
    mark_per_share_usd: row.mark_per_share_usd,
  };
}

function familyMarkPayload(
  mark: FamilyMark,
  byId: ReadonlyMap<string, MarkRow>,
  prints: readonly PrintInput[],
): FamilyMarkPayload {
  return {
    family_slug: mark.familySlug,
    family_name: mark.familyName,
    family_mapped: mark.familyMapped,
    as_of: mark.asOf,
    mark_per_share_usd: mark.markPerShareUsd,
    n_funds: mark.nFunds,
    min_fund_mark_usd: mark.minFundMarkUsd,
    max_fund_mark_usd: mark.maxFundMarkUsd,
    intra_family_split: mark.intraFamilySplit,
    documents: mark.markIds.map((id) => markDocument(byId.get(id)!)),
    mark_vs_print: markVsPrintPayload(markVersusPrint(mark, prints)),
  };
}

/** Per label: consensus, family marks and revisions, from the series' inputs. */
export function labelSeries(
  inputs: readonly FundMarkInput[],
  rows: readonly MarkRow[],
  families: FilerFamilies,
  prints: readonly PrintInput[],
): { labels: LabelPayload[]; points: ConsensusPoint[] } {
  const marks = familyMarks(inputs, families);
  const points = consensusSeries(marks);
  const moves = revisions(marks);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const labelNames = [...new Set(marks.map((mark) => mark.securityLabel))].sort();
  const labels = labelNames.map((label) => ({
    security_label: label,
    consensus: points
      .filter((point) => point.securityLabel === label)
      .map((point) => consensusPayload(point, prints)),
    family_marks: marks
      .filter((mark) => mark.securityLabel === label)
      .map((mark) => familyMarkPayload(mark, byId, prints)),
    revisions: moves.filter((move) => move.securityLabel === label).map(revisionPayload),
  }));
  return { labels, points };
}

async function loadPrints(db: Kysely<Database>, issuerId: string): Promise<PrintPayload[]> {
  const rows = await db
    .selectFrom("prints")
    .leftJoin("source_documents", "source_documents.id", "prints.price_source_id")
    .select([
      "prints.id",
      "prints.round_name",
      "prints.event_type",
      "prints.announced_on",
      "prints.post_money_usd",
      "prints.amount_raised_usd",
      "prints.series_label",
      "prints.price_per_share_usd",
      "prints.source_url",
      "prints.origin",
      "source_documents.source_class",
      "source_documents.accession",
      "source_documents.document_url",
      "source_documents.filer_name",
      "source_documents.filed_on",
    ])
    .where("prints.issuer_id", "=", issuerId)
    .orderBy("prints.announced_on")
    .orderBy("prints.round_name")
    .execute();
  return rows.map((row) => ({
    round_name: row.round_name,
    event_type: row.event_type,
    announced_on: row.announced_on,
    post_money_usd: row.post_money_usd,
    amount_raised_usd: row.amount_raised_usd,
    series_label: row.series_label,
    price_per_share_usd: row.price_per_share_usd,
    source_url: row.source_url,
    origin: row.origin,
    price_source:
      row.document_url === null
        ? null
        : documentRef({
            source_class: row.source_class!,
            accession: row.accession,
            document_url: row.document_url,
            filer_name: row.filer_name!,
            filed_on: row.filed_on,
          }),
  }));
}

function printInputs(prints: readonly PrintPayload[]): PrintInput[] {
  return prints
    .filter((print) => (PRINT_EVENT_TYPES as readonly string[]).includes(print.event_type))
    .map((print) => ({
      id: `${print.round_name}`,
      roundName: print.round_name,
      announcedOn: print.announced_on,
      seriesLabel: print.series_label,
      pricePerShareUsd:
        print.price_per_share_usd === null ? null : Number(print.price_per_share_usd),
    }));
}

async function loadStructure(
  db: Kysely<Database>,
  issuerId: string,
): Promise<StructurePayload | null> {
  const certificate = await db
    .selectFrom("certificates")
    .innerJoin("source_documents", "source_documents.id", "certificates.document_id")
    .select([
      "certificates.id",
      "certificates.document_id",
      "certificates.filed_on",
      "certificates.kind",
      "certificates.entered_by",
      "certificates.newest_series_label",
      "certificates.common_shares_authorized",
      "certificates.unmodelled_terms",
      "source_documents.source_class",
      "source_documents.accession",
      "source_documents.document_url",
      "source_documents.filer_name",
      "source_documents.filed_on as document_filed_on",
      "source_documents.content_sha256",
    ])
    .where("certificates.issuer_id", "=", issuerId)
    .where("certificates.superseded_by", "is", null)
    .orderBy("certificates.filed_on", "desc")
    .executeTakeFirst();
  if (certificate === undefined) return null;
  const series = await db
    .selectFrom("certificate_series")
    .selectAll()
    .where("certificate_id", "=", certificate.id)
    .orderBy("seniority")
    .orderBy("series_label")
    .execute();
  const round = await db
    .selectFrom("prints")
    .select(["round_name", "post_money_usd", "price_per_share_usd"])
    .where("issuer_id", "=", issuerId)
    .where("price_source_id", "=", certificate.document_id)
    .orderBy("announced_on", "desc")
    .executeTakeFirst();
  const input: CertificateInput = {
    series: series.map((row) => ({
      seriesLabel: row.series_label,
      originalIssuePriceUsd: Number(row.original_issue_price_usd),
      liquidationMultiple: Number(row.liquidation_multiple),
      participating: row.participating,
      participationCapMultiple:
        row.participation_cap_multiple === null ? null : Number(row.participation_cap_multiple),
      seniority: row.seniority,
      sharesAuthorized: Number(row.shares_authorized),
      conversionPriceUsd:
        row.conversion_price_usd === null ? null : Number(row.conversion_price_usd),
      ratchet: row.ratchet,
    })),
    unmodelledTerms: certificate.unmodelled_terms,
  };
  const headline =
    round === undefined || round.post_money_usd === null || round.price_per_share_usd === null
      ? null
      : { post: Number(round.post_money_usd), pps: Number(round.price_per_share_usd) };
  const noHeadline = {
    status: "no_headline" as const,
    reason:
      round === undefined
        ? "no priced round is linked to this certificate"
        : "the linked round has no disclosed post-money",
  };
  return {
    certificate: {
      filed_on: certificate.filed_on,
      kind: certificate.kind,
      entered_by: certificate.entered_by,
      newest_series_label: certificate.newest_series_label,
      common_shares_authorized: certificate.common_shares_authorized,
      unmodelled_terms: certificate.unmodelled_terms,
      document: {
        ...documentRef({ ...certificate, filed_on: certificate.document_filed_on }),
        content_sha256: certificate.content_sha256,
      },
      series: series.map((row) => ({
        series_label: row.series_label,
        original_issue_price_usd: row.original_issue_price_usd,
        liquidation_multiple: row.liquidation_multiple,
        participating: row.participating,
        participation_cap_multiple: row.participation_cap_multiple,
        seniority: row.seniority,
        shares_authorized: row.shares_authorized,
        conversion_price_usd: row.conversion_price_usd,
        ratchet: row.ratchet,
      })),
    },
    round:
      round === undefined
        ? null
        : { round_name: round.round_name, post_money_usd: round.post_money_usd },
    common_equivalent:
      headline === null ? noHeadline : commonEquivalent(input, headline.post, headline.pps),
    structure_gap:
      headline === null ? noHeadline : structureGap(input, headline.post, headline.pps),
  };
}

async function loadVehicles(db: Kysely<Database>, issuerId: string): Promise<SpvVehiclePayload[]> {
  const rows = await db
    .selectFrom("spv_vehicles")
    .innerJoin("source_documents", "source_documents.id", "spv_vehicles.document_id")
    .selectAll("spv_vehicles")
    .select([
      "source_documents.source_class",
      "source_documents.accession",
      "source_documents.document_url",
      "source_documents.filer_name",
      "source_documents.filed_on",
    ])
    .where("spv_vehicles.issuer_id", "=", issuerId)
    .orderBy("source_documents.filed_on", "desc")
    .orderBy("source_documents.accession", "desc")
    .execute();
  const byCik = new Map<string, { latest: (typeof rows)[number]; count: number }>();
  for (const row of rows) {
    const entry = byCik.get(row.vehicle_cik);
    if (entry === undefined) byCik.set(row.vehicle_cik, { latest: row, count: 1 });
    else entry.count += 1;
  }
  return [...byCik.values()]
    .map(({ latest, count }) => ({
      vehicle_name: latest.vehicle_name,
      vehicle_cik: latest.vehicle_cik,
      match_method: latest.match_method,
      match_note: latest.match_note,
      latest_filing: {
        ...documentRef(latest),
        total_offering_usd: latest.total_offering_usd,
        total_sold_usd: latest.total_sold_usd,
        min_investment_usd: latest.min_investment_usd,
        sales_commission_usd: latest.sales_commission_usd,
        finders_fee_usd: latest.finders_fee_usd,
        first_sale_on: latest.first_sale_on,
        jurisdiction: latest.jurisdiction,
        related_persons: latest.related_persons,
      },
      n_filings: count,
    }))
    .sort(
      (a, b) =>
        (b.latest_filing.first_sale_on ?? "").localeCompare(a.latest_filing.first_sale_on ?? "") ||
        a.vehicle_cik.localeCompare(b.vehicle_cik),
    );
}

async function loadQuotes(
  db: Kysely<Database>,
  issuerId: string,
  points: readonly ConsensusPoint[],
): Promise<SpvQuotePayload[]> {
  const rows = await db
    .selectFrom("spv_quotes")
    .innerJoin("source_documents", "source_documents.id", "spv_quotes.document_id")
    .leftJoin("spv_vehicles", "spv_vehicles.id", "spv_quotes.spv_vehicle_id")
    .selectAll("spv_quotes")
    .select([
      "source_documents.source_class",
      "source_documents.accession",
      "source_documents.document_url",
      "source_documents.filer_name",
      "source_documents.filed_on",
      "source_documents.content_sha256",
      "spv_vehicles.vehicle_cik",
    ])
    .where("spv_quotes.issuer_id", "=", issuerId)
    .orderBy("spv_quotes.captured_at", "desc")
    .execute();
  return rows.map((row) => {
    const captured = row.captured_at.toISOString().slice(0, 10);
    const headline = headlinePoint(points.filter((point) => point.asOf <= captured));
    let premium: SpvQuotePayload["premium"];
    if (headline === null) premium = { status: "none", reason: "no_consensus_before_capture" };
    else {
      const result = spvPremium(
        {
          quotedPricePerShareUsd:
            row.quoted_price_per_share_usd === null ? null : Number(row.quoted_price_per_share_usd),
          upfrontFeePct: row.upfront_fee_pct === null ? null : Number(row.upfront_fee_pct),
          mgmtFeePct: row.mgmt_fee_pct === null ? null : Number(row.mgmt_fee_pct),
          carryPct: row.carry_pct === null ? null : Number(row.carry_pct),
          layers: row.layers,
        },
        headline.consensusUsd!,
      );
      premium =
        result.status === "none"
          ? { status: "none", reason: result.reason }
          : {
              ...result,
              security_label: headline.securityLabel,
              consensus_as_of: headline.asOf,
            };
    }
    return {
      platform: row.platform,
      captured_at: row.captured_at.toISOString(),
      document: { ...documentRef(row), content_sha256: row.content_sha256 },
      vehicle_cik: row.vehicle_cik,
      quoted_price_per_share_usd: row.quoted_price_per_share_usd,
      quoted_valuation_usd: row.quoted_valuation_usd,
      upfront_fee_pct: row.upfront_fee_pct,
      mgmt_fee_pct: row.mgmt_fee_pct,
      carry_pct: row.carry_pct,
      layers: row.layers,
      premium,
    };
  });
}

/** One name's index, or null when no issuer has the slug. */
export async function getNameIndex(
  db: Kysely<Database>,
  slug: string,
  options: NameIndexOptions = {},
): Promise<NameIndex | null> {
  const now = (options.now ?? (() => new Date()))();
  const families = options.families ?? loadFilerFamilies();
  const issuer = await db
    .selectFrom("issuers")
    .leftJoin("source_documents", "source_documents.id", "issuers.incorporation_source_id")
    .select([
      "issuers.id",
      "issuers.slug",
      "issuers.name",
      "issuers.legal_name",
      "issuers.watchlisted",
      "issuers.incorporation_state",
      "issuers.listed_on",
      "issuers.listing_url",
      "source_documents.source_class",
      "source_documents.accession",
      "source_documents.document_url",
      "source_documents.filer_name",
      "source_documents.filed_on",
    ])
    .where("issuers.slug", "=", slug)
    .executeTakeFirst();
  if (issuer === undefined) return null;

  // Independent reads; the pool queues them past its size.
  const [rows, prints, structure, vehicles] = await Promise.all([
    liveMarks(db, issuer.id),
    loadPrints(db, issuer.id),
    loadStructure(db, issuer.id),
    loadVehicles(db, issuer.id),
  ]);
  const { inputs, summary } = seriesInputs(rows, issuer.listed_on);
  const inputsForPrint = printInputs(prints);
  const { labels, points } = labelSeries(inputs, rows, families, inputsForPrint);
  const today = now.toISOString().slice(0, 10);
  const lastPrint =
    prints
      .filter(
        (print) =>
          (PRINT_EVENT_TYPES as readonly string[]).includes(print.event_type) &&
          print.announced_on <= today,
      )
      .at(-1) ?? null;
  const headline = headlinePoint(points);
  const noMarks = rows.length === 0 ? await noMarksReason(db, issuer.slug) : null;

  return {
    ...refEnvelope(now),
    families_version: families.version,
    issuer: {
      slug: issuer.slug,
      name: issuer.name,
      legal_name: issuer.legal_name,
      watchlisted: issuer.watchlisted,
      incorporation_state: issuer.incorporation_state,
      incorporation_source:
        issuer.document_url === null
          ? null
          : documentRef({
              source_class: issuer.source_class!,
              accession: issuer.accession,
              document_url: issuer.document_url,
              filer_name: issuer.filer_name!,
              filed_on: issuer.filed_on,
            }),
      listed_on: issuer.listed_on,
      listing_url: issuer.listing_url,
    },
    marks_summary: summary,
    coverage: nameCoverage(issuer.slug),
    no_marks: noMarks,
    out_of_series: outOfSeriesGroups(rows, issuer.listed_on),
    headline:
      headline === null
        ? null
        : {
            security_label: headline.securityLabel,
            as_of: headline.asOf,
            consensus_usd: headline.consensusUsd!,
            n_families: headline.nFamilies,
            dispersion_pct: headline.dispersion?.pct ?? null,
          },
    no_headline: noHeadline(headline, points, summary, noMarks),
    labels,
    last_print: lastPrint,
    prints,
    structure,
    spv: {
      vehicles,
      quotes: await loadQuotes(db, issuer.id, points),
    },
  };
}
