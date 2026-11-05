/**
 * Consensus and dispersion per label per calendar quarter. Funds' quarters
 * end in different months, so a family's mark enters the calendar quarter
 * its `as_of` falls in, and within a quarter each family contributes its
 * latest mark. Consensus is the median of family marks, never a mean.
 */
import { assertNonNegative } from "../assert.js";
import type { FamilyMarkPoint } from "./families.js";
import {
  assertIsoDate,
  assertNonEmptyString,
  calendarQuarter,
  compareText,
  median,
  quarterBounds,
} from "./mark.js";
import { METHODOLOGY } from "./methodology.js";
import { isComparableLabel } from "./series.js";

export interface DispersionFamily {
  readonly familySlug: string;
  readonly familyName: string;
  readonly markPerShareUsd: number;
  readonly asOf: string;
}

export interface Dispersion {
  /** (max − min) / median of the family marks, in percent. */
  readonly pct: number;
  readonly high: DispersionFamily;
  readonly low: DispersionFamily;
}

export interface ConsensusPoint {
  readonly securityLabel: string;
  /** `2026Q3`. */
  readonly quarter: string;
  readonly quarterStart: string;
  readonly quarterEnd: string;
  /** Median of the family marks. */
  readonly consensusUsd: number;
  readonly nFamilies: number;
  /** Null below `min_families_for_dispersion` families, or when the median is zero. */
  readonly dispersion: Dispersion | null;
  /** Each family's latest mark in the quarter, sorted by family slug. */
  readonly families: readonly FamilyMarkPoint[];
}

function validatePoint(mark: FamilyMarkPoint): void {
  assertNonEmptyString(mark.familySlug, "familySlug");
  assertNonEmptyString(mark.familyName, "familyName");
  assertNonEmptyString(mark.securityLabel, "securityLabel");
  assertIsoDate(mark.asOf, "asOf");
  assertNonNegative(mark.markPerShareUsd, "markPerShareUsd");
}

/** Throws on a second mark for the same family, label and date: which one counts would be a guess. */
export function validateFamilyMarkPoints(marks: readonly FamilyMarkPoint[]): void {
  const seen = new Set<string>();
  for (const mark of marks) {
    validatePoint(mark);
    const key = JSON.stringify([mark.familySlug, mark.securityLabel, mark.asOf]);
    if (seen.has(key)) {
      throw new RangeError(
        `${mark.familySlug} has two marks on ${mark.securityLabel} as of ${mark.asOf}`,
      );
    }
    seen.add(key);
  }
}

/**
 * (max − min) / median in percent; null for fewer than
 * `min_families_for_dispersion` values or a zero median.
 */
export function dispersionPct(values: readonly number[]): number | null {
  for (const value of values) assertNonNegative(value, "value");
  if (values.length < METHODOLOGY.min_families_for_dispersion) return null;
  const center = median(values);
  if (center <= 0) return null;
  return ((Math.max(...values) - Math.min(...values)) / center) * 100;
}

/** Each family's latest mark per label per calendar quarter. */
export function latestInQuarter(marks: readonly FamilyMarkPoint[]): FamilyMarkPoint[] {
  validateFamilyMarkPoints(marks);
  const latest = new Map<string, FamilyMarkPoint>();
  for (const mark of marks) {
    if (!isComparableLabel(mark.securityLabel)) continue;
    const key = JSON.stringify([mark.securityLabel, calendarQuarter(mark.asOf), mark.familySlug]);
    const current = latest.get(key);
    if (current === undefined || mark.asOf > current.asOf) latest.set(key, mark);
  }
  return [...latest.values()].sort(
    (left, right) =>
      compareText(left.securityLabel, right.securityLabel) ||
      compareText(left.asOf, right.asOf) ||
      compareText(left.familySlug, right.familySlug),
  );
}

function toDispersionFamily(mark: FamilyMarkPoint): DispersionFamily {
  return {
    familySlug: mark.familySlug,
    familyName: mark.familyName,
    markPerShareUsd: mark.markPerShareUsd,
    asOf: mark.asOf,
  };
}

function consensusPoint(
  securityLabel: string,
  quarter: string,
  members: readonly FamilyMarkPoint[],
): ConsensusPoint {
  const families = [...members].sort((left, right) =>
    compareText(left.familySlug, right.familySlug),
  );
  const values = families.map((mark) => mark.markPerShareUsd);
  const pct = dispersionPct(values);
  // Ordered by mark, then slug: the low family is first, the high family last, never the same one.
  const byMark = [...families].sort(
    (left, right) =>
      left.markPerShareUsd - right.markPerShareUsd ||
      compareText(left.familySlug, right.familySlug),
  );
  const { start, end } = quarterBounds(quarter);
  return {
    securityLabel,
    quarter,
    quarterStart: start,
    quarterEnd: end,
    consensusUsd: median(values),
    nFamilies: families.length,
    dispersion:
      pct === null
        ? null
        : {
            pct,
            high: toDispersionFamily(byMark[byMark.length - 1]!),
            low: toDispersionFamily(byMark[0]!),
          },
    families: Object.freeze(families),
  };
}

/**
 * The consensus series: per label per calendar quarter, the median of each
 * family's latest mark in that quarter, `n_families`, and dispersion with
 * the high and low families named. Labels that do not enter per-share series
 * are skipped. Sorted by label, then quarter.
 */
export function consensusSeries(marks: readonly FamilyMarkPoint[]): ConsensusPoint[] {
  const buckets = new Map<string, { label: string; quarter: string; members: FamilyMarkPoint[] }>();
  for (const mark of latestInQuarter(marks)) {
    const quarter = calendarQuarter(mark.asOf);
    const key = JSON.stringify([mark.securityLabel, quarter]);
    const bucket = buckets.get(key) ?? { label: mark.securityLabel, quarter, members: [] };
    bucket.members.push(mark);
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .map((bucket) => consensusPoint(bucket.label, bucket.quarter, bucket.members))
    .sort(
      (left, right) =>
        compareText(left.securityLabel, right.securityLabel) ||
        compareText(left.quarter, right.quarter),
    );
}
