/**
 * Consensus and dispersion per label per as-of date (METHODOLOGY.md,
 * "Comparison date"). A family's mark is compared only with other families'
 * marks as of the same date: funds' fiscal quarters end in different months,
 * and a July mark beside an August one measures reporting timing, not
 * disagreement. Nothing is carried forward: a family with no mark on a date
 * is absent from that date. Consensus is the median of family marks, never a
 * mean, published from `min_families_for_consensus` families; dispersion
 * from `min_families_for_dispersion`.
 */
import { assertNonNegative } from "../assert.js";
import type { FamilyMarkPoint } from "./families.js";
import { assertIsoDate, assertNonEmptyString, compareText, type IsoDate, median } from "./mark.js";
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
  /** The as-of date every family mark of the point shares. */
  readonly asOf: IsoDate;
  readonly nFamilies: number;
  /** Median of the family marks; null below `min_families_for_consensus` families. */
  readonly consensusUsd: number | null;
  /** Null below `min_families_for_dispersion` families, or when the median is zero. */
  readonly dispersion: Dispersion | null;
  /** Each family's mark as of the date, sorted by family slug. */
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

/** The median of the family marks, or null below `min_families_for_consensus` values. */
export function consensusUsd(values: readonly number[]): number | null {
  for (const value of values) assertNonNegative(value, "value");
  if (values.length < METHODOLOGY.min_families_for_consensus) return null;
  return median(values);
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
  asOf: IsoDate,
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
  return {
    securityLabel,
    asOf,
    nFamilies: families.length,
    consensusUsd: consensusUsd(values),
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
 * The consensus series: one point per label per as-of date on which any
 * family marked the label, with every family's mark as of that date,
 * `n_families`, the median of the family marks from
 * `min_families_for_consensus` families, and dispersion with the high and
 * low families named from `min_families_for_dispersion`. Labels that do not
 * enter per-share series are skipped. Sorted by label, then date.
 */
export function consensusSeries(marks: readonly FamilyMarkPoint[]): ConsensusPoint[] {
  validateFamilyMarkPoints(marks);
  const buckets = new Map<string, { label: string; asOf: IsoDate; members: FamilyMarkPoint[] }>();
  for (const mark of marks) {
    if (!isComparableLabel(mark.securityLabel)) continue;
    const key = JSON.stringify([mark.securityLabel, mark.asOf]);
    const bucket = buckets.get(key) ?? { label: mark.securityLabel, asOf: mark.asOf, members: [] };
    bucket.members.push(mark);
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .map((bucket) => consensusPoint(bucket.label, bucket.asOf, bucket.members))
    .sort(
      (left, right) =>
        compareText(left.securityLabel, right.securityLabel) || compareText(left.asOf, right.asOf),
    );
}
