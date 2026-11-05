/**
 * Filer families. Funds under one adviser share a valuation committee and
 * mark identically, so the comparison is between families, not funds.
 * `data/index/filer-families.json` maps registrant CIKs to a family; a
 * registrant it does not list is its own family.
 */
import { assertNonNegative } from "../assert.js";
import { assertIsoDate, assertNonEmptyString, compareText, type IsoDate, median } from "./mark.js";
import { METHODOLOGY } from "./methodology.js";
import { isComparableLabel } from "./series.js";

export interface FilerFamily {
  readonly slug: string;
  readonly name: string;
  /** Registrant CIKs, as digits; leading zeros are ignored. */
  readonly ciks: readonly string[];
  /** Why these registrants are one family: a sentence, or the URLs that show it. */
  readonly evidence: string | readonly string[];
}

/** The shape of `data/index/filer-families.json`. */
export interface FilerFamilies {
  readonly version: string;
  /** How the file was drafted and edited; not read by the arithmetic. */
  readonly note?: string;
  readonly families: readonly FilerFamily[];
}

export interface FamilyRef {
  readonly slug: string;
  readonly name: string;
  /** False when the registrant is not in the families file and stands as its own family. */
  readonly mapped: boolean;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CIK = /^\d{1,10}$/;

/** A CIK as digits without leading zeros (`0000044201` → `44201`). */
export function normalizeCik(cik: string): string {
  if (typeof cik !== "string" || !CIK.test(cik.trim())) {
    throw new RangeError("a CIK must be one to ten digits");
  }
  const digits = cik.trim().replace(/^0+(?=\d)/, "");
  if (digits === "0") throw new RangeError("a CIK must not be zero");
  return digits;
}

function readEvidence(value: unknown, slug: string): string | readonly string[] {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.trim() !== "")
  ) {
    return Object.freeze([...(value as string[])]);
  }
  throw new RangeError(`family ${slug} needs evidence: a sentence or a list of URLs`);
}

function readFamily(value: unknown, seenCiks: Map<string, string>): FilerFamily {
  if (typeof value !== "object" || value === null)
    throw new TypeError("a family must be an object");
  const record = value as Record<string, unknown>;
  const slug = record.slug;
  if (typeof slug !== "string" || !SLUG.test(slug)) {
    throw new RangeError("a family slug must be lowercase words joined by dashes");
  }
  if (slug.startsWith("cik-")) throw new RangeError("family slugs starting cik- are reserved");
  if (typeof record.name !== "string" || record.name.trim() === "") {
    throw new RangeError(`family ${slug} needs a name`);
  }
  if (!Array.isArray(record.ciks) || record.ciks.length === 0) {
    throw new RangeError(`family ${slug} needs at least one CIK`);
  }
  const ciks = record.ciks.map((cik: unknown) => {
    if (typeof cik !== "string")
      throw new RangeError(`family ${slug} has a CIK that is not a string`);
    const normalized = normalizeCik(cik);
    const owner = seenCiks.get(normalized);
    if (owner !== undefined) {
      throw new RangeError(`CIK ${normalized} is in both ${owner} and ${slug}`);
    }
    seenCiks.set(normalized, slug);
    return normalized;
  });
  return Object.freeze({
    slug,
    name: record.name,
    ciks: Object.freeze(ciks),
    evidence: readEvidence(record.evidence, slug),
  });
}

/**
 * Validates parsed `filer-families.json` and returns a frozen copy: unique
 * slugs, each CIK in at most one family, evidence for every family.
 */
export function parseFilerFamilies(input: unknown): FilerFamilies {
  if (typeof input !== "object" || input === null)
    throw new TypeError("families must be an object");
  const record = input as Record<string, unknown>;
  if (typeof record.version !== "string" || record.version.trim() === "") {
    throw new RangeError("families need a version");
  }
  if (!Array.isArray(record.families)) throw new TypeError("families.families must be an array");
  const seenCiks = new Map<string, string>();
  const seenSlugs = new Set<string>();
  const families = record.families.map((value: unknown) => {
    const family = readFamily(value, seenCiks);
    if (seenSlugs.has(family.slug)) throw new RangeError(`family ${family.slug} is listed twice`);
    seenSlugs.add(family.slug);
    return family;
  });
  if (record.note !== undefined && typeof record.note !== "string") {
    throw new TypeError("families.note must be a string");
  }
  return Object.freeze({
    version: record.version,
    ...(record.note === undefined ? {} : { note: record.note }),
    families: Object.freeze(families),
  });
}

/**
 * The family a registrant belongs to. A registrant the file does not list is
 * its own family, `cik-<cik>`, named after the registrant.
 */
/** Each families object's CIK → family, built once: a name page resolves thousands of marks. */
const FAMILY_BY_CIK = new WeakMap<FilerFamilies, ReadonlyMap<string, FilerFamily>>();

function familyByCik(families: FilerFamilies): ReadonlyMap<string, FilerFamily> {
  let index = FAMILY_BY_CIK.get(families);
  if (index === undefined) {
    const built = new Map<string, FilerFamily>();
    // The first family listing a CIK wins, as the scan this replaces did.
    for (const family of families.families) {
      for (const member of family.ciks) {
        const normalized = normalizeCik(member);
        if (!built.has(normalized)) built.set(normalized, family);
      }
    }
    index = built;
    FAMILY_BY_CIK.set(families, index);
  }
  return index;
}

export function resolveFamily(
  families: FilerFamilies,
  cik: string,
  registrantName: string,
): FamilyRef {
  const normalized = normalizeCik(cik);
  assertNonEmptyString(registrantName, "registrantName");
  const family = familyByCik(families).get(normalized);
  if (family !== undefined) return { slug: family.slug, name: family.name, mapped: true };
  return { slug: `cik-${normalized}`, name: registrantName, mapped: false };
}

/** One fund's mark, as `filer_marks` joined to its `source_documents` row gives it. */
export interface FundMarkInput {
  /** `filer_marks.id`. */
  readonly id: string;
  /** `source_documents.filer_cik`: the registrant. */
  readonly filerCik: string;
  /** `source_documents.filer_name`. */
  readonly filerName: string;
  /** `source_documents.fund_series_id`; null when the registrant files as one fund. */
  readonly fundSeriesId: string | null;
  /** `filer_marks.security_label`. */
  readonly securityLabel: string;
  /** `filer_marks.as_of`. */
  readonly asOf: IsoDate;
  /** `filer_marks.mark_per_share_usd`; null rows count toward value, not toward per-share series. */
  readonly markPerShareUsd: number | null;
}

/** A family's mark on one label as of one date: what consensus, revisions and the pages read. */
export interface FamilyMarkPoint {
  readonly familySlug: string;
  readonly familyName: string;
  readonly securityLabel: string;
  readonly asOf: IsoDate;
  readonly markPerShareUsd: number;
}

export interface FamilyMark extends FamilyMarkPoint {
  readonly familyMapped: boolean;
  /** Distinct funds (fund series, or the registrant when it has none) behind the mark. */
  readonly nFunds: number;
  readonly minFundMarkUsd: number;
  readonly maxFundMarkUsd: number;
  /** The funds differ by more than `intra_family_split_tolerance` of the family mark. */
  readonly intraFamilySplit: boolean;
  /** The `filer_marks` rows behind the mark, sorted. */
  readonly markIds: readonly string[];
}

function validateFundMark(mark: FundMarkInput): void {
  assertNonEmptyString(mark.id, "id");
  normalizeCik(mark.filerCik);
  assertNonEmptyString(mark.filerName, "filerName");
  if (mark.fundSeriesId !== null) assertNonEmptyString(mark.fundSeriesId, "fundSeriesId");
  assertNonEmptyString(mark.securityLabel, "securityLabel");
  assertIsoDate(mark.asOf, "asOf");
  if (mark.markPerShareUsd !== null) assertNonNegative(mark.markPerShareUsd, "markPerShareUsd");
}

/** (max − min) / median exceeds the tolerance; a zero median splits on any difference. */
function isSplit(min: number, max: number, center: number): boolean {
  if (max === min) return false;
  if (center <= 0) return true;
  return (max - min) / center > METHODOLOGY.intra_family_split_tolerance;
}

interface Group {
  readonly family: FamilyRef;
  readonly securityLabel: string;
  readonly asOf: IsoDate;
  readonly byFund: Map<string, number[]>;
  readonly ids: string[];
}

function groupMarks(marks: readonly FundMarkInput[], families: FilerFamilies): Map<string, Group> {
  const groups = new Map<string, Group>();
  const ordered = [...marks].sort((left, right) => compareText(left.id, right.id));
  for (const mark of ordered) {
    if (mark.markPerShareUsd === null || !isComparableLabel(mark.securityLabel)) continue;
    const family = resolveFamily(families, mark.filerCik, mark.filerName);
    const key = JSON.stringify([family.slug, mark.securityLabel, mark.asOf]);
    let group = groups.get(key);
    if (group === undefined) {
      // Rows are in id order, so an unmapped registrant is named by its earliest row.
      group = {
        family,
        securityLabel: mark.securityLabel,
        asOf: mark.asOf,
        byFund: new Map(),
        ids: [],
      };
      groups.set(key, group);
    }
    const fund = mark.fundSeriesId ?? `cik:${normalizeCik(mark.filerCik)}`;
    const fundMarks = group.byFund.get(fund) ?? [];
    fundMarks.push(mark.markPerShareUsd);
    group.byFund.set(fund, fundMarks);
    group.ids.push(mark.id);
  }
  return groups;
}

/**
 * One mark per family, label and date: the median of the family's funds'
 * marks (a fund with several rows on the label that day contributes their
 * median), flagged `intraFamilySplit` when the funds differ by more than
 * `intra_family_split_tolerance`. Rows without a per-share mark, and rows on
 * a label that does not enter per-share series (`isComparableLabel`), are
 * left out. Sorted by label, date, family.
 */
export function familyMarks(
  marks: readonly FundMarkInput[],
  families: FilerFamilies,
): FamilyMark[] {
  const ids = new Set<string>();
  for (const mark of marks) {
    validateFundMark(mark);
    if (ids.has(mark.id)) throw new RangeError(`mark ${mark.id} appears twice`);
    ids.add(mark.id);
  }

  const result: FamilyMark[] = [];
  for (const group of groupMarks(marks, families).values()) {
    const fundMarks = [...group.byFund.values()].map((values) => median(values));
    const center = median(fundMarks);
    const min = Math.min(...fundMarks);
    const max = Math.max(...fundMarks);
    result.push({
      familySlug: group.family.slug,
      familyName: group.family.name,
      familyMapped: group.family.mapped,
      securityLabel: group.securityLabel,
      asOf: group.asOf,
      markPerShareUsd: center,
      nFunds: fundMarks.length,
      minFundMarkUsd: min,
      maxFundMarkUsd: max,
      intraFamilySplit: isSplit(min, max, center),
      markIds: Object.freeze([...group.ids].sort(compareText)),
    });
  }
  return result.sort(
    (left, right) =>
      compareText(left.securityLabel, right.securityLabel) ||
      compareText(left.asOf, right.asOf) ||
      compareText(left.familySlug, right.familySlug),
  );
}
