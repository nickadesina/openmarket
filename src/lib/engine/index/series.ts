/**
 * Security labels: a holding's N-PORT title and name, read into one canonical
 * label per security (`Series F Preferred`, `Common`, `SAFE`…). The index
 * reports per label; marks on different labels are never pooled. The rules
 * are written against real titles (tests/fixtures/index/nport-holding-titles.json)
 * and decline to guess: a title that does not say what it is, or a title and
 * name that say different things, is `Unclassified`.
 */

export type SecurityKind =
  | "preferred"
  | "common"
  | "convertible_note"
  | "safe"
  | "spv_interest"
  | "warrant"
  | "other"
  | "unknown";

export const SECURITY_KINDS: readonly SecurityKind[] = Object.freeze([
  "preferred",
  "common",
  "convertible_note",
  "safe",
  "spv_interest",
  "warrant",
  "other",
  "unknown",
]);

export const UNCLASSIFIED = "Unclassified";
export const COMMON = "Common";
export const CONVERTIBLE_NOTE = "Convertible Note";
export const SAFE = "SAFE";
export const SPV_INTEREST = "SPV interest";
export const WARRANT = "Warrant";

export interface SecurityClass {
  /** `Series F Preferred`, `Series C-1 Preferred`, `Common`, `Convertible Note`, `SAFE`, `SPV interest`, `Warrant` or `Unclassified`. */
  readonly label: string;
  readonly kind: SecurityKind;
}

/** A preferred series's canonical label (`Series F-1 Preferred`), which enters per-share series. */
export const SERIES_LABEL_PATTERN = /^Series (?:Seed|[A-Z]{1,2}(?:-\d{1,2})?) Preferred$/;

/**
 * The labels whose marks are published but enter no per-share series. A
 * preferred series and common do enter. `Unclassified`, `SPV interest`, `Warrant`, `SAFE` and
 * `Convertible Note` do not: one of those labels covers instruments with
 * different terms (vehicle, strike, cap, principal), so a per-share figure on
 * one is not comparable with another's.
 */
export const NOT_COMPARABLE_LABELS: readonly string[] = Object.freeze([
  UNCLASSIFIED,
  SPV_INTEREST,
  WARRANT,
  SAFE,
  CONVERTIBLE_NOTE,
]);

/** Whether marks on this label enter per-share series: `Common` or a preferred series. */
export function isComparableLabel(label: string): boolean {
  return label === COMMON || SERIES_LABEL_PATTERN.test(label);
}

/** A two-letter word after SER/CL that is English, not a series code. */
const NOT_A_SERIES_CODE = new Set(["OF", "IN", "TO", "ON", "OR", "AN", "AT", "BY"]);

/** Series code: one or two letters, an optional number (`F-1`, `F 1`, `F1`), never a percent. */
const CODE = String.raw`([A-Z]{1,2})(?:[- ]?(\d{1,2})(?![\d%.]))?`;

const SPV_PATTERNS: readonly RegExp[] = [
  /\b(?:INVESTED IN|ECONOMIC EXPOSURE TO)\b/,
  /\bSPV\b/,
  /\bA SERIES OF\b/,
  // `MVP Opportunity Fund VI LLC (Epic Games)`: a vehicle named with its holding, not a custody note.
  /\b(?:LLC|LP|L\.P\.)\s*\((?!PHYSICAL|DRS|NOT LISTED|PIPE)[^)]+\)\s*$/,
  // `Anduril Investors LLC, Series G`, `… Series B QP Partners LLC`: a pooled vehicle's own name.
  /\b(?:FUND|PARTNERS|INVESTORS|OPPORTUNITY|CO-?INVEST\w*)\b[^()]*\b(?:LLC|LP|L\.P\.)(?=[\s,]|$)/,
];
const SAFE_PATTERNS: readonly RegExp[] = [
  /\bSAFE\b(?!\s+SUPERINTELLIGENCE)/,
  /\bSIMPLE AGREEMENT FOR FUTURE EQUITY\b/,
];
const NOTE_PATTERN =
  /\b(?:CONV(?:ERTIBLE)?|CVT|CV)\.?\s+(?:PROMISSORY\s+|PROM\s+)?(?:NOTES?|NTS?)\b/;
const WARRANT_PATTERN = /\b(?:WARRANTS?|WTS?)\b/;
const RIGHTS_PATTERN = /\b(?:RTS?|RIGHTS?)\b/;
const DEBT_OR_SWAP_PATTERN = /\b(?:SWAP|LOAN|1LN|TERM B)\b/;
const SERIES_PATTERN = new RegExp(
  String.raw`\b(?:SERIES|SER|SRS|SR)(?:\.\s*|\s+)(?:(SEED)\b|${CODE}\b)`,
);
const CLASS_PATTERN = new RegExp(String.raw`\b(?:CLASS|CL)\.?\s+${CODE}\b`);
const BARE_CODE_PC_PATTERN = new RegExp(String.raw`\b${CODE}\s+PC\b`);
const PREFERRED_PATTERN = /\b(?:PFD|PREF|PREFERRED)\b/;
const COMMON_PATTERN = /\b(?:COMMON|COMMO|COM|CS|ORD|ORDINARY)\b/;
const UNITS_PATTERN = /\bUNITS?\b/;

/** N-PORT asset categories that are debt or a derivative; never an equity mark. */
function isDebtOrDerivativeCategory(category: string): boolean {
  // DBT debt, LON loan, SN structured note, ABS-*, and the derivatives DCO, DCR, DE, DFE, DIR, DO.
  return /^(?:LON|SN|ABS|AMBS|D[A-Z]{1,2})(?:-|$)/.test(category);
}

function seriesLabel(letters: string, number: string | undefined): string {
  return `Series ${letters}${number === undefined ? "" : `-${number}`} Preferred`;
}

function matchSeries(text: string): string | null {
  const match = SERIES_PATTERN.exec(text);
  if (match === null) return null;
  if (match[1] === "SEED") return "Series Seed Preferred";
  const letters = match[2]!;
  if (NOT_A_SERIES_CODE.has(letters)) return null;
  return seriesLabel(letters, match[3]);
}

/** `CL F-1 PFD`: a class code on a title that says preferred. */
function matchPreferredClass(text: string): string | null {
  if (!PREFERRED_PATTERN.test(text)) return null;
  const match = CLASS_PATTERN.exec(text);
  if (match === null || NOT_A_SERIES_CODE.has(match[1]!)) return null;
  return seriesLabel(match[1]!, match[2]);
}

/** `PBC A-2 PC PP`: a bare series code before PC (convertible preferred). */
function matchBareCode(text: string): string | null {
  const match = BARE_CODE_PC_PATTERN.exec(text);
  if (match === null || NOT_A_SERIES_CODE.has(match[1]!)) return null;
  return seriesLabel(match[1]!, match[2]);
}

function labelled(label: string, kind: SecurityKind): SecurityClass {
  return { label, kind };
}

/** Instruments named by their form, whatever the issuer: checked before any series. */
function classifyInstrument(text: string): SecurityClass | null {
  if (SPV_PATTERNS.some((pattern) => pattern.test(text)))
    return labelled(SPV_INTEREST, "spv_interest");
  if (SAFE_PATTERNS.some((pattern) => pattern.test(text))) return labelled(SAFE, "safe");
  if (NOTE_PATTERN.test(text)) return labelled(CONVERTIBLE_NOTE, "convertible_note");
  if (WARRANT_PATTERN.test(text)) return labelled(WARRANT, "warrant");
  if (RIGHTS_PATTERN.test(text) || DEBT_OR_SWAP_PATTERN.test(text)) {
    return labelled(UNCLASSIFIED, "other");
  }
  return null;
}

/** One text (a title or a name), upper-cased, read on its own. */
function classifyText(text: string, category: string): SecurityClass {
  const instrument = classifyInstrument(text);
  if (instrument !== null) return instrument;
  if (isDebtOrDerivativeCategory(category)) return labelled(UNCLASSIFIED, "other");

  const series = matchSeries(text) ?? matchPreferredClass(text) ?? matchBareCode(text);
  if (series !== null) return labelled(series, "preferred");

  if (PREFERRED_PATTERN.test(text)) return labelled(UNCLASSIFIED, "preferred");
  if (COMMON_PATTERN.test(text)) return labelled(COMMON, "common");
  // Units of an LLC (`EV UNITS Class A`) are not shares; a class letter on them names no common.
  if (UNITS_PATTERN.test(text)) return labelled(UNCLASSIFIED, "other");
  if (CLASS_PATTERN.test(text)) {
    // A class code with no preferred marker is common, unless the filer filed it as preferred.
    return category === "EP" ? labelled(UNCLASSIFIED, "preferred") : labelled(COMMON, "common");
  }
  return labelled(UNCLASSIFIED, category === "EP" ? "preferred" : "unknown");
}

function normalize(text: string): string {
  return text.normalize("NFKC").toUpperCase().replace(/\s+/g, " ").trim();
}

function assertText(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
}

/**
 * The canonical label and kind of one N-PORT holding, from its `title`, its
 * `name` and, when present, its `assetCat`. The title is read first. The
 * name fills in only when the title names no label and its kind is unknown
 * or agrees; when title and name say different things, the holding is
 * `Unclassified`. The asset category never names a series: funds file
 * preferred stock as EC, so it only settles debt, derivatives and the kind
 * of a title that says nothing else.
 */
export function classifySecurity(
  title: string,
  name: string,
  assetCategory?: string | null,
): SecurityClass {
  assertText(title, "title");
  assertText(name, "name");
  if (assetCategory !== undefined && assetCategory !== null) {
    assertText(assetCategory, "assetCategory");
  }
  const category = normalize(assetCategory ?? "");
  const fromTitle = classifyText(normalize(title), category);
  const fromName = classifyText(normalize(name), category);

  if (fromTitle.label !== UNCLASSIFIED) {
    const nameDisagrees = fromName.label !== UNCLASSIFIED && fromName.label !== fromTitle.label;
    if (!nameDisagrees) return fromTitle;
    return labelled(UNCLASSIFIED, fromTitle.kind === fromName.kind ? fromTitle.kind : "unknown");
  }
  if (fromName.label === UNCLASSIFIED) {
    return labelled(UNCLASSIFIED, fromTitle.kind !== "unknown" ? fromTitle.kind : fromName.kind);
  }
  if (fromTitle.kind === "unknown" || fromTitle.kind === fromName.kind) return fromName;
  return labelled(UNCLASSIFIED, "unknown");
}
