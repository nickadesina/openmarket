import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isVehicle, parseFormD } from "../../src/lib/ingest/parse/form-d.js";

/** Real Form D filings from EDGAR (tests/fixtures/index/README.md). */
const fixture = (name: string) => readFileSync(`tests/fixtures/index/${name}`, "utf8");

describe("Form D", () => {
  it("reads an SPV's offering", () => {
    const form = parseFormD(fixture("form-d-0002136346-26-000001.xml"));
    expect(form).toMatchObject({
      submissionType: "D",
      isAmendment: false,
      issuerCik: "2136346",
      issuerName: "Granada Anthropic SPV, a Series of Decile SPV, LLC",
      jurisdiction: "DELAWARE",
      entityType: "Limited Liability Company",
      yearOfIncorporation: "2026",
      industryGroup: "Pooled Investment Fund",
      investmentFundType: "Venture Capital Fund",
      securityTypes: ["PooledInvestmentFund"],
      firstSaleOn: "2026-05-07",
      totalOfferingUsd: "1099001",
      offeringIndefinite: false,
      totalSoldUsd: "1099001",
      totalRemainingUsd: "0",
      minInvestmentUsd: "0",
      salesCommissionUsd: "0",
      findersFeeUsd: "0",
      investorCount: 14,
      signedOn: "2026-05-26",
    });
    expect(form.relatedPersons).toEqual([
      {
        name: "Granada Funds, LLC",
        relationships: ["Executive Officer"],
        clarification: "Manager of the Fund",
      },
      {
        name: "Mohammed Kamal",
        relationships: ["Executive Officer", "Director"],
        clarification: "Managing Partner of the Manager of the Fund",
      },
    ]);
    expect(isVehicle(form)).toBe(true);
  });

  it("reads a company's own offering, which is not a vehicle", () => {
    const form = parseFormD(fixture("form-d-0001493152-24-009735.xml"));
    expect(form).toMatchObject({
      issuerCik: "2014185",
      issuerName: "Figure AI Inc.",
      jurisdiction: "DELAWARE",
      entityType: "Corporation",
      industryGroup: "Other Technology",
      investmentFundType: null,
      securityTypes: ["Equity"],
      firstSaleOn: "2024-02-27",
      totalOfferingUsd: "675000000",
      totalSoldUsd: "674981967",
    });
    expect(form.relatedPersons.map((person) => person.name)).toEqual([
      "Brett Adcock",
      "Dana Berlin",
    ]);
    expect(isVehicle(form)).toBe(false);
  });

  it("refuses a document that is not a Form D", () => {
    expect(() => parseFormD(fixture("nport-0000035402-26-006778.xml"))).toThrow(/not a Form D/);
  });

  it("names vehicles by their words when the industry group does not say", () => {
    for (const issuerName of [
      "Cursor SPV1 Emerging Global a Series of CGF2021 LLC",
      "Anthropic - Iron Pine GoldenArc Co-Invest, LLC",
      "Arden Anthropic Opportunities I LLC",
    ]) {
      expect(isVehicle({ issuerName, industryGroup: null })).toBe(true);
    }
    expect(isVehicle({ issuerName: "Stripe, Inc.", industryGroup: "Other Technology" })).toBe(
      false,
    );
  });
});
