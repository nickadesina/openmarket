/**
 * SEC Form D (`primary_doc.xml`, schema X0708): notice of an exempt
 * offering, by a company or by a pooled vehicle (an SPV). Read here: the
 * primary issuer (name, CIK, jurisdiction, entity type, year of
 * incorporation), the related persons, the industry group and fund type,
 * the types of securities, the date of first sale, the offering and sold
 * amounts, the minimum investment, sales commissions and finders' fees, and
 * the signature date.
 *
 * Amounts stay decimal strings as filed. A total offering amount filed as
 * `Indefinite` is null with `offeringIndefinite` set; a first sale that is
 * `yetToOccur` is null.
 */
import { blocks, tagText } from "./xml.js";

export const FORM_D_PARSER_VERSION = "form-d-0.1.0";

export interface FormDRelatedPerson {
  readonly name: string;
  readonly relationships: readonly string[];
  readonly clarification: string | null;
}

export interface FormD {
  readonly submissionType: string;
  readonly isAmendment: boolean;
  readonly issuerCik: string;
  readonly issuerName: string;
  /** `jurisdictionOfInc`, as filed (`DELAWARE`). */
  readonly jurisdiction: string | null;
  readonly entityType: string | null;
  readonly yearOfIncorporation: string | null;
  /** Further issuers filing on the same form (a QP feeder beside its fund). */
  readonly coIssuers: readonly { readonly cik: string; readonly name: string }[];
  readonly relatedPersons: readonly FormDRelatedPerson[];
  /** `Pooled Investment Fund`, `Other Technology`, … */
  readonly industryGroup: string | null;
  /** For a pooled investment fund: `Venture Capital Fund`, `Private Equity Fund`, … */
  readonly investmentFundType: string | null;
  /** The `is…Type` flags set under `typesOfSecuritiesOffered`, e.g. `Equity`, `PooledInvestmentFund`. */
  readonly securityTypes: readonly string[];
  readonly firstSaleOn: string | null;
  readonly totalOfferingUsd: string | null;
  readonly offeringIndefinite: boolean;
  readonly totalSoldUsd: string | null;
  readonly totalRemainingUsd: string | null;
  readonly minInvestmentUsd: string | null;
  readonly salesCommissionUsd: string | null;
  readonly findersFeeUsd: string | null;
  readonly investorCount: number | null;
  readonly signedOn: string | null;
}

const DECIMAL = /^\d+(?:\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function decimalOrNull(text: string): string | null {
  const value = text.replaceAll(",", "").replace(/^\$/, "").trim();
  return DECIMAL.test(value) ? value : null;
}

function textOrNull(text: string): string | null {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length === 0 ? null : value;
}

function dateOrNull(text: string): string | null {
  return ISO_DATE.test(text) ? text : null;
}

function cikOf(text: string): string {
  const digits = text.trim().replace(/^0+/, "");
  if (!/^[1-9]\d*$/.test(digits)) throw new Error(`Form D issuer CIK is not a CIK: ${text}`);
  return digits;
}

function relatedPerson(block: string): FormDRelatedPerson {
  const first = tagText(block, "firstName");
  const last = tagText(block, "lastName");
  // Entities are filed with a placeholder first name: `-` and `Granada Funds, LLC`.
  const name = [first, last]
    .filter((part) => part.length > 0 && !/^[-.\s]*$|^N\/?A$/i.test(part))
    .join(" ");
  return {
    name: name.replace(/\s+/g, " ").trim(),
    relationships: blocks(block, "relationship").map((value) => value.trim()),
    clarification: textOrNull(tagText(block, "relationshipClarification")),
  };
}

function securityTypes(xml: string): string[] {
  const section = blocks(xml, "typesOfSecuritiesOffered")[0] ?? "";
  return [...section.matchAll(/<is(\w+)Type>\s*true\s*<\/is\1Type>/g)].map((match) => match[1]!);
}

function amount(xml: string, section: string): string | null {
  return decimalOrNull(tagText(blocks(xml, section)[0] ?? "", "dollarAmount"));
}

/** One Form D's `primary_doc.xml`. Throws when it is not a Form D or names no issuer. */
export function parseFormD(xml: string): FormD {
  const submissionType = tagText(xml, "submissionType");
  if (!/^D(?:\/A)?$/.test(submissionType)) {
    throw new Error(`not a Form D: submissionType ${submissionType || "missing"}`);
  }
  const primary = blocks(xml, "primaryIssuer")[0];
  if (primary === undefined) throw new Error("Form D has no primaryIssuer");
  const issuerName = tagText(primary, "entityName").replace(/\s+/g, " ").trim();
  if (issuerName.length === 0) throw new Error("Form D primary issuer has no name");
  const offering = blocks(xml, "offeringData")[0] ?? "";
  const sales = blocks(offering, "offeringSalesAmounts")[0] ?? "";
  const totalOffering = tagText(sales, "totalOfferingAmount");
  const firstSale = blocks(offering, "dateOfFirstSale")[0] ?? "";
  const investors = tagText(blocks(offering, "investors")[0] ?? "", "totalNumberAlreadyInvested");
  const issuerList = blocks(xml, "issuerList")[0] ?? "";

  return {
    submissionType,
    isAmendment: tagText(offering, "isAmendment") === "true" || submissionType === "D/A",
    issuerCik: cikOf(tagText(primary, "cik")),
    issuerName,
    jurisdiction: textOrNull(tagText(primary, "jurisdictionOfInc")),
    entityType: textOrNull(tagText(primary, "entityType")),
    yearOfIncorporation: textOrNull(tagText(blocks(primary, "yearOfInc")[0] ?? "", "value")),
    coIssuers: blocks(issuerList, "issuer").map((block) => ({
      cik: cikOf(tagText(block, "cik")),
      name: tagText(block, "entityName").replace(/\s+/g, " ").trim(),
    })),
    relatedPersons: blocks(xml, "relatedPersonInfo").map(relatedPerson),
    industryGroup: textOrNull(tagText(offering, "industryGroupType")),
    investmentFundType: textOrNull(tagText(offering, "investmentFundType")),
    securityTypes: securityTypes(offering),
    firstSaleOn: dateOrNull(tagText(firstSale, "value")),
    totalOfferingUsd: decimalOrNull(totalOffering),
    offeringIndefinite: /^indefinite$/i.test(totalOffering),
    totalSoldUsd: decimalOrNull(tagText(sales, "totalAmountSold")),
    totalRemainingUsd: decimalOrNull(tagText(sales, "totalRemaining")),
    minInvestmentUsd: decimalOrNull(tagText(offering, "minimumInvestmentAccepted")),
    salesCommissionUsd: amount(offering, "salesCommissions"),
    findersFeeUsd: amount(offering, "findersFees"),
    investorCount: /^\d+$/.test(investors) ? Number(investors) : null,
    signedOn: dateOrNull(tagText(blocks(offering, "signature")[0] ?? "", "signatureDate")),
  };
}

/** Words that name a pooled vehicle rather than an operating company. */
const VEHICLE_NAME =
  /\b(?:SPV|SERIES|FUND|FUNDS|HOLDINGS|OPPORTUNIT(?:Y|IES)|CO-?INVEST(?:MENT)?S?|SYNDICATE|FEEDER|VEHICLE|INVESTORS?|PARTNERS|VENTURES)\b/i;

/**
 * Whether the filer is a vehicle: a pooled investment fund, or a name that
 * says it is one (`SPV`, `Series`, `Fund`, `Holdings`, `Opportunity`,
 * `Co-Invest`, `a series of … LLC`…). The issuer's own Form D is neither.
 */
export function isVehicle(form: Pick<FormD, "industryGroup" | "issuerName">): boolean {
  if (form.industryGroup === "Pooled Investment Fund") return true;
  return VEHICLE_NAME.test(form.issuerName);
}
