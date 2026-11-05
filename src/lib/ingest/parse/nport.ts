/**
 * An N-PORT-P form (`primary_doc.xml`, schema http://www.sec.gov/edgar/nport):
 * `genInfo` for the registrant, its CIK, the series and the report date;
 * `invstOrSec` for each holding (name, title, balance, units, valUSD, pctVal,
 * assetCat, fairValLevel, isRestrictedSec). Promoted from the research
 * script `scripts/research/edgar-nport-marks.ts`, removed when ingest
 * landed.
 *
 * Numbers stay decimal strings, exactly as filed: the database stores them
 * as `numeric`, and a per-share mark needs more digits than a float keeps.
 */
import { attribute, blocks, tagText } from "./xml.js";

export const NPORT_PARSER_VERSION = "nport-0.1.0";

export interface NportHolding {
  /** Position among the document's `invstOrSec` elements, from 0. */
  readonly index: number;
  readonly name: string;
  readonly title: string;
  readonly lei: string | null;
  readonly cusip: string | null;
  /** `assetCat`, or the `assetCat` attribute of `assetConditional` (with its description). */
  readonly assetCategory: string | null;
  readonly balance: string | null;
  /** `NS` shares, `PA` principal amount, `NC` contracts, `OU` other units. */
  readonly units: string | null;
  readonly valueUsd: string | null;
  readonly pctOfNetAssets: string | null;
  readonly fairValueLevel: string | null;
  readonly isRestricted: boolean | null;
}

export interface NportDocument {
  readonly submissionType: string | null;
  readonly registrantName: string;
  readonly registrantCik: string | null;
  readonly seriesName: string | null;
  readonly seriesId: string | null;
  /** `repPdDate`: the date the holdings are as of. */
  readonly reportDate: string;
  /** `repPdEnd`: the fiscal period's end. */
  readonly fiscalPeriodEnd: string | null;
  readonly holdings: readonly NportHolding[];
}

const DECIMAL = /^-?\d+(?:\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function decimalOrNull(text: string): string | null {
  const value = text.replaceAll(",", "");
  return DECIMAL.test(value) ? value : null;
}

function textOrNull(text: string): string | null {
  return text.length === 0 || /^N\/?A$/i.test(text) ? null : text;
}

function yesNo(text: string): boolean | null {
  if (text === "Y") return true;
  if (text === "N") return false;
  return null;
}

function assetCategory(block: string): string | null {
  const direct = tagText(block, "assetCat");
  if (direct.length > 0) return direct;
  const conditional = attribute(block, "assetConditional", "assetCat");
  if (conditional.length === 0) return null;
  const description = attribute(block, "assetConditional", "description");
  return description.length === 0 ? conditional : `${conditional}: ${description}`;
}

export function parseNportHolding(block: string, index: number): NportHolding {
  return {
    index,
    name: tagText(block, "name"),
    title: tagText(block, "title"),
    lei: textOrNull(tagText(block, "lei")),
    cusip: textOrNull(tagText(block, "cusip")),
    assetCategory: assetCategory(block),
    balance: decimalOrNull(tagText(block, "balance")),
    units: textOrNull(tagText(block, "units")),
    valueUsd: decimalOrNull(tagText(block, "valUSD")),
    pctOfNetAssets: decimalOrNull(tagText(block, "pctVal")),
    fairValueLevel: textOrNull(tagText(block, "fairValLevel")),
    isRestricted: yesNo(tagText(block, "isRestrictedSec")),
  };
}

/** Throws on a document that is not an N-PORT form (no `genInfo` or report date). */
export function parseNport(xml: string): NportDocument {
  const genInfo = blocks(xml, "genInfo")[0];
  if (genInfo === undefined) throw new Error("not an N-PORT form: no genInfo");
  const reportDate = tagText(genInfo, "repPdDate");
  if (!ISO_DATE.test(reportDate)) throw new Error(`N-PORT repPdDate is not a date: ${reportDate}`);
  const fiscalPeriodEnd = tagText(genInfo, "repPdEnd");
  const cik = tagText(genInfo, "regCik").replace(/^0+/, "");
  return {
    submissionType: textOrNull(tagText(xml, "submissionType")),
    registrantName: tagText(genInfo, "regName"),
    registrantCik: /^\d+$/.test(cik) ? cik : null,
    seriesName: textOrNull(tagText(genInfo, "seriesName")),
    seriesId: textOrNull(tagText(genInfo, "seriesId")),
    reportDate,
    fiscalPeriodEnd: ISO_DATE.test(fiscalPeriodEnd) ? fiscalPeriodEnd : null,
    holdings: blocks(xml, "invstOrSec").map(parseNportHolding),
  };
}

/** The holdings whose name or title matches `pattern`. */
export function matchingHoldings(
  document: NportDocument,
  pattern: RegExp,
): readonly NportHolding[] {
  return document.holdings.filter(
    (holding) => pattern.test(holding.name) || pattern.test(holding.title),
  );
}
