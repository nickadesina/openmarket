/**
 * Ingest's interim security classifier: a holding's title and name, and the
 * filer's N-PORT asset category, to a canonical label and kind, so marks on
 * different securities are never pooled (docs/prompts/v2/README.md,
 * "Security label").
 *
 * Interim: P3's `classifySecurity` in src/lib/engine/index/series.ts is the
 * methodology's classifier; when the parts merge this file is reconciled
 * with it (same signature) and ingest calls that one. Labels:
 * `Series F-1 Preferred`, `Preferred` (no series stated), `Class A Common`,
 * `Common`, `Convertible Note`, `Debt`, `Derivative`, `SAFE`, `Warrant`,
 * `SPV interest`, `Unclassified`.
 *
 * The words of the title and name decide first; the asset category (`EP`
 * equity-preferred, `EC` equity-common, `DBT` debt) decides only when they
 * say nothing. Titles are as filers write them: "ANTHROPIC PBC SER H-1 CVT
 * PFD PP", "OPENAI GROUP PBC A-3 PC PP", "Anduril Industries, Inc., Class B",
 * "Studio Type One Soul II LLC (OpenAI)".
 */

export const SECURITY_LABEL_VERSION = "ingest-label-0.1.0";

export type SecurityKind =
  | "preferred"
  | "common"
  | "convertible_note"
  | "safe"
  | "spv_interest"
  | "warrant"
  | "other"
  | "unknown";

export interface SecurityLabel {
  readonly label: string;
  readonly kind: SecurityKind;
}

/** A series name: `G-1`, `F`, `AA`, `C2`, `SEED`, `A-PRIME`. */
const SERIES_NAME = String.raw`(SEED(?:-?\d{1,2})?|[A-Z]{1,2}(?:-?\d{1,2})?(?:-PRIME)?)`;
const SERIES = new RegExp(String.raw`\b(?:SERIES|SER|SR)\s+${SERIES_NAME}(?![\w-])`);
const CLASS = new RegExp(String.raw`\b(?:CLASS|CL)\s+${SERIES_NAME}(?![\w-])`);
/** Fidelity's short form: the series right before `PC` (participating convertible) or `CVT PFD`. */
const SERIES_BEFORE_TERMS = new RegExp(
  String.raw`\b${SERIES_NAME}\s+(?:PC|CVT|CV|PFD|PREFERRED)(?![\w-])`,
);

const PREFERRED = /\b(?:PREFERRED|PREF|PFD|PRF)\b|\bPC PP\b/;
const COMMON = /\b(?:COMMON|COM|COMMMON|ORDINARY|ORD)\b/;
const CONVERTIBLE = /\b(?:CONVERTIBLE|CONV|CVT|CV)\b/;
const DEBT =
  /\b(?:NOTES?|BONDS?|DEBENTURES?|LOAN|TERM LOAN)\b|\d+(?:\.\d+)?%? \d{1,2}\/\d{1,2}\/\d{2,4}\b/;
const SAFE = /\bSIMPLE AGREEMENTS? FOR FUTURE EQUITY\b|\bSAFES?\b(?! SUPERINTELLIGENCE)/;
const DERIVATIVE = /\b(?:SWAPS?|CFD|CDS|FUTURES?|OPTIONS?|FORWARDS?)\b/;
/** N-PORT's derivative categories: commodity, credit, equity, FX, interest rate, other. */
const DERIVATIVE_CATEGORIES = new Set(["DCO", "DCR", "DE", "DFE", "DIR", "DO"]);
const WARRANT = /\b(?:WARRANTS?|WTS?|WRNTS?)\b/;
const SPV_WORDS = /\b(?:SPV|SPECIAL PURPOSE|CO-?INVEST\w*|FEEDER|ECONOMIC EXPOSURE|EXPOSURE TO)\b/;
/** A vehicle: a fund or partnership LLC/LP, or an LLC/LP naming its holding in parentheses. */
const SPV_VEHICLE =
  /\b(?:FUND|PARTNERS|INVESTORS|OPPORTUNITY|VENTURES?)\b[^()]*\b(?:LLC|LP|L P)\b|\b(?:LLC|LP|L P) \(/;

function normalize(text: string): string {
  return (
    text
      .toUpperCase()
      // Dots go (Inc., L.P.) except inside a number (a 5.35% coupon).
      .replace(/(?<!\d)\.|\.(?!\d)/g, "")
      .replace(/[,;]/g, " ")
      .replace(/\s*-\s*/g, "-")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function seriesLabel(raw: string): string {
  if (raw.startsWith("SEED")) return `Seed${raw.slice(4)}`;
  return raw.replace("-PRIME", "-Prime");
}

function preferred(text: string): SecurityLabel {
  const series =
    SERIES.exec(text)?.[1] ?? CLASS.exec(text)?.[1] ?? SERIES_BEFORE_TERMS.exec(text)?.[1];
  return {
    label: series === undefined ? "Preferred" : `Series ${seriesLabel(series)} Preferred`,
    kind: "preferred",
  };
}

function common(text: string): SecurityLabel {
  const shareClass = CLASS.exec(text)?.[1];
  return {
    label: shareClass === undefined ? "Common" : `Class ${shareClass} Common`,
    kind: "common",
  };
}

/**
 * The label and kind of one holding. Instrument words outrank a series name,
 * which a SAFE, a note or an SPV may also carry ("Economic Exposure to
 * Figure AI, Inc. Series B Preferred Stock" is an SPV interest).
 */
export function classifySecurity(
  title: string,
  name: string,
  assetCategory?: string | null,
): SecurityLabel {
  const text = normalize(`${title} ${name}`);
  const category = (assetCategory ?? "").toUpperCase().split(":")[0]!.trim();

  if (SAFE.test(text)) return { label: "SAFE", kind: "safe" };
  if (DERIVATIVE_CATEGORIES.has(category) || DERIVATIVE.test(text)) {
    return { label: "Derivative", kind: "other" };
  }
  if (WARRANT.test(text)) return { label: "Warrant", kind: "warrant" };
  if (SPV_WORDS.test(text) || SPV_VEHICLE.test(text)) {
    return { label: "SPV interest", kind: "spv_interest" };
  }
  if (category === "DBT" || category === "LON" || DEBT.test(text)) {
    return CONVERTIBLE.test(text)
      ? { label: "Convertible Note", kind: "convertible_note" }
      : { label: "Debt", kind: "other" };
  }
  if (PREFERRED.test(text) || SERIES.test(text)) return preferred(text);
  if (COMMON.test(text) || CLASS.test(text)) return common(text);
  if (category === "EP") return preferred(text);
  if (category === "EC") return common(text);
  return { label: "Unclassified", kind: "unknown" };
}
