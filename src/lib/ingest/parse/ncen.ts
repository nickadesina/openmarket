/**
 * An N-CEN annual report (`primary_doc.xml`): the registrant's name, and for
 * each fund (`managementInvestmentQuestion`) its series and the investment
 * advisers and sub-advisers it names, with their SEC file numbers. Filer
 * families are built from this: funds under one adviser share a valuation
 * committee (docs/prompts/v2/README.md, "Filer family").
 */
import { blocks, tagText } from "./xml.js";

export interface NcenAdviser {
  readonly name: string;
  /** The adviser's SEC file number (`801-7884`), when it has one. */
  readonly fileNumber: string | null;
}

export interface NcenFund {
  readonly name: string;
  readonly seriesId: string | null;
  readonly advisers: readonly NcenAdviser[];
  readonly subAdvisers: readonly NcenAdviser[];
}

export interface NcenReport {
  readonly registrantName: string;
  readonly funds: readonly NcenFund[];
}

function advisers(block: string, list: string, item: string, prefix: string): NcenAdviser[] {
  return blocks(blocks(block, list)[0] ?? "", item)
    .map((adviser) => ({
      name: tagText(adviser, `${prefix}Name`).replace(/\s+/g, " "),
      fileNumber: tagText(adviser, `${prefix}FileNo`) || null,
    }))
    .filter((adviser) => adviser.name.length > 0);
}

export function parseNcen(xml: string): NcenReport {
  const registrantName = tagText(xml, "registrantFullName");
  if (registrantName.length === 0) throw new Error("not an N-CEN form: no registrantFullName");
  return {
    registrantName,
    funds: blocks(xml, "managementInvestmentQuestion").map((fund) => ({
      name: tagText(fund, "mgmtInvFundName"),
      seriesId: tagText(fund, "mgmtInvSeriesId") || null,
      advisers: advisers(fund, "investmentAdvisers", "investmentAdviser", "investmentAdviser"),
      subAdvisers: advisers(fund, "subAdvisers", "subAdviser", "subAdviser"),
    })),
  };
}

/** Every investment adviser the registrant's funds name, once each (by file number, else name). */
export function registrantAdvisers(report: NcenReport): NcenAdviser[] {
  const keyed = new Map<string, NcenAdviser>();
  for (const fund of report.funds) {
    for (const adviser of fund.advisers) {
      keyed.set(adviser.fileNumber ?? adviser.name.toUpperCase(), adviser);
    }
  }
  return [...keyed.values()].sort((a, b) => a.name.localeCompare(b.name));
}
