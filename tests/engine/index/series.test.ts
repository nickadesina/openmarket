import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  classifySecurity,
  isComparableLabel,
  SECURITY_KINDS,
  type SecurityKind,
} from "../../../src/lib/engine/index/series.js";

/**
 * Real titles from N-PORT-P filings (tests/fixtures/index/nport-holding-titles.json,
 * fetched from EDGAR 2026-11-04; its readme says how it was trimmed). The
 * expected label and kind on each row are OpenMarket's reading, reviewed by
 * hand; every other field is the filing's.
 */
interface TitleRow {
  readonly accession: string;
  readonly holding_name: string;
  readonly holding_title: string;
  readonly asset_category: string;
  readonly expected_label: string;
  readonly expected_kind: SecurityKind;
}

const fixture = JSON.parse(
  readFileSync(new URL("../../fixtures/index/nport-holding-titles.json", import.meta.url), "utf8"),
) as { readonly holdings: readonly TitleRow[] };

function row(title: string, name?: string): TitleRow {
  const found = fixture.holdings.find(
    (holding) =>
      holding.holding_title === title && (name === undefined || holding.holding_name === name),
  );
  if (found === undefined) throw new Error(`no fixture row titled ${title}`);
  return found;
}

function classifyRow(holding: TitleRow) {
  return classifySecurity(holding.holding_title, holding.holding_name, holding.asset_category);
}

describe("classifySecurity on real N-PORT titles", () => {
  it("reads every fixture row as annotated", () => {
    const mismatches = fixture.holdings
      .map((holding) => ({ holding, got: classifyRow(holding) }))
      .filter(
        ({ holding, got }) =>
          got.label !== holding.expected_label || got.kind !== holding.expected_kind,
      )
      .map(
        ({ holding, got }) =>
          `${holding.accession} ${holding.holding_title}: ${got.label}/${got.kind}, expected ${holding.expected_label}/${holding.expected_kind}`,
      );
    expect(mismatches).toEqual([]);
  });

  it("covers every label shape and every kind on real rows", () => {
    expect(fixture.holdings.length).toBeGreaterThan(250);
    const labels = new Set(fixture.holdings.map((holding) => holding.expected_label));
    for (const label of [
      "Series F Preferred",
      "Series F-1 Preferred",
      "Series BB-1 Preferred",
      "Common",
      "Convertible Note",
      "SAFE",
      "SPV interest",
      "Warrant",
      "Unclassified",
    ]) {
      expect(labels).toContain(label);
    }
    const kinds = new Set(fixture.holdings.map((holding) => holding.expected_kind));
    for (const kind of SECURITY_KINDS) expect(kinds).toContain(kind);
  });

  it("reads one series however the filer writes it", () => {
    for (const title of [
      "ANTHROPIC PBC CL F-1 PFD PP (PHYSICAL) (NOT LISTED OR TRADING)",
      "ANTHROPIC PBC SER F-1 CVT PFD PP",
      "ANTHROPIC PBC SERIES F-1 PC PP",
      "Anthropic PBC, Series F-1",
    ]) {
      expect(classifyRow(row(title))).toEqual({ label: "Series F-1 Preferred", kind: "preferred" });
    }
    expect(classifyRow(row("ANTHROPIC PBC. SERIES H 1"))).toEqual({
      label: "Series H-1 Preferred",
      kind: "preferred",
    });
    expect(classifyRow(row("OPENAI GROUP PBC A-2 PC PP"))).toEqual({
      label: "Series A-2 Preferred",
      kind: "preferred",
    });
    expect(classifyRow(row("SPACE EXPLORATION TECH CORP SER I 0% PC PP")).label).toBe(
      "Series I Preferred",
    );
  });

  it("names a series even when the fund files it as common (EC)", () => {
    const holding = row("Databricks, Inc. Series J");
    expect(holding.asset_category).toBe("EC");
    expect(classifyRow(holding)).toEqual({ label: "Series J Preferred", kind: "preferred" });
  });

  it("lets the name fill in a title that says nothing", () => {
    expect(classifyRow(row("DATABRICKS, INC", "Databricks, Inc. Series J")).label).toBe(
      "Series J Preferred",
    );
    expect(classifyRow(row("DATABRICKS INC PP", "DATABRICKS INC-CL A PP")).label).toBe("Common");
  });

  it("declines when title and name disagree", () => {
    expect(
      classifyRow(
        row("VERILY LIFE SCIENCES LLC SER B UNITS PP", "Verily Health, Inc. CL B Common Stock PP"),
      ),
    ).toEqual({ label: "Unclassified", kind: "unknown" });
    expect(
      classifyRow(
        row("AESTAS LLC dba OPENAI LLC EV UNITS Class A", "OPENAI GROUP PBC CLASS A COMMON PP"),
      ).label,
    ).toBe("Unclassified");
  });

  it("reads a vehicle as an SPV interest before the security it holds", () => {
    expect(
      classifyRow(
        row("DA-1125 Gaingels Fund II (invested in Databricks, Inc. Series L Preferred Stock)"),
      ),
    ).toEqual({ label: "SPV interest", kind: "spv_interest" });
    expect(classifyRow(row("MVP Opportunity Fund VI LLC (Epic Games)")).label).toBe("SPV interest");
    expect(classifyRow(row("Anthropic SPV Exposure")).label).toBe("SPV interest");
  });

  it("does not take a custody note for a vehicle", () => {
    expect(classifyRow(row("STRIPE LLC CL B PP (DRS) (NOT LISTED OR TRADING)")).label).toBe(
      "Common",
    );
  });

  it("leaves a bare issuer name unclassified, with the kind its category gives", () => {
    expect(classifyRow(row("ANTHROPIC PBC", "ANTHROPIC PBC"))).toEqual({
      label: "Unclassified",
      kind: "preferred",
    });
    expect(classifyRow(row("Anthropic PBC")).label).toBe("Unclassified");
  });

  it("keeps debt, loans, swaps and rights out of equity labels", () => {
    expect(classifyRow(row("SPCX 5.35 07/15/31"))).toEqual({
      label: "Unclassified",
      kind: "other",
    });
    expect(classifyRow(row("X.AI TERM B 1LN 06/28/2030")).kind).toBe("other");
    expect(classifyRow(row("SPACE EXPLORATION TECHNOLOGIES CORP.-SWAP-CANT-L")).kind).toBe("other");
    expect(classifyRow(row("SPACE EXPLORATION TECHNOLOGIES CORP. CLASS A COMMO")).label).toBe(
      "Unclassified",
    );
    expect(
      classifyRow(row("OPENAI GLOBAL LLC RTS 1:1 @ USD PP (DRS) (NOT LISTED OR TRADING)")),
    ).toEqual({ label: "Unclassified", kind: "other" });
  });

  it("reads a warrant on a series as a warrant, and a SAFE or note by its form", () => {
    expect(classifyRow(row("FORM ENERGY SERIES G WTS 05/31 PP")).label).toBe("Warrant");
    expect(classifyRow(row("Eridu Corp CVT SAFE PP")).label).toBe("SAFE");
    expect(classifyRow(row("Imperative Care, Inc. Convertible Promissory Note")).label).toBe(
      "Convertible Note",
    );
  });

  it("does not read SAFE in an issuer's own name as a SAFE", () => {
    // Not a fixture row: no N-PORT filed by 2026-11-04 names this issuer.
    expect(
      classifySecurity("Safe Superintelligence Inc", "Safe Superintelligence Inc").label,
    ).not.toBe("SAFE");
  });

  it("is deterministic and refuses non-string input", () => {
    const holding = row("Anthropic PBC, Series G");
    expect(classifyRow(holding)).toEqual(classifyRow(holding));
    expect(() => classifySecurity(undefined as unknown as string, "")).toThrow(TypeError);
    expect(() => classifySecurity("", 3 as unknown as string)).toThrow(TypeError);
  });
});

describe("isComparableLabel", () => {
  it("admits preferred series and common only", () => {
    expect(isComparableLabel("Series F-1 Preferred")).toBe(true);
    expect(isComparableLabel("Series BB Preferred")).toBe(true);
    expect(isComparableLabel("Common")).toBe(true);
    for (const label of ["Unclassified", "SPV interest", "Warrant", "SAFE", "Convertible Note"]) {
      expect(isComparableLabel(label)).toBe(false);
    }
  });
});
