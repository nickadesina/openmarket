import { describe, expect, it } from "vitest";

import { classifySecurity } from "../../src/lib/ingest/parse/security-label.js";

/**
 * Titles, names and asset categories as funds filed them in N-PORT
 * (dev ingest of NPORT-P filed 2026-09-15 to 2026-11-04), with the label
 * each must get.
 */
const FILED: readonly (readonly [string, string, string, string])[] = [
  ["ANTHROPIC PBC SERIES G-1 PC PP", "ANTHROPIC PBC", "EP", "Series G-1 Preferred"],
  [
    "ANTHROPIC PBC SER H-1 CVT PFD PP",
    "Anthropic PBC SER H-1 CVT PFD PP",
    "EP",
    "Series H-1 Preferred",
  ],
  [
    "ANTHROPIC PBC CL F-1 PFD PP (PHYSICAL) (NOT LISTED OR TRADING)",
    "ANTHROPIC PBC",
    "EP",
    "Series F-1 Preferred",
  ],
  ["Anthropic PBC, Series G-1", "Anthropic PBC", "EC", "Series G-1 Preferred"],
  ["OPENAI GROUP PBC A-3 PC PP", "OPENAI GROUP PBC", "EP", "Series A-3 Preferred"],
  [
    "OPENAI GROUP PBC CL A-2 CV PFD PP (DRS) (NOT LISTED OR TRADING)",
    "OPENAI GROUP PBC",
    "EP",
    "Series A-2 Preferred",
  ],
  ["DATABRICKS INC SER L PC PP", "DATABRICKS INC", "EP", "Series L Preferred"],
  [
    "Databricks Inc Series I Preferred",
    "Databricks Inc Series I Preferred",
    "EP",
    "Series I Preferred",
  ],
  ["ANDURIL INDUSTRIES INC CL B PP", "ANDURIL INDUSTRIES INC", "EC", "Class B Common"],
  ["Stripe Inc - Class B", "Stripe Inc - Class B", "EC", "Class B Common"],
  [
    "DATABRICKS INC CL C COMMMON STOCK PP",
    "DATABRICKS INC - CL C COMMMON STOCK PP",
    "EC",
    "Class C Common",
  ],
  [
    "SPACE EXPLORATION TECHNOLOGIES CORP CLASS A COM STK",
    "SPACE EXPLORATION TECHNOLOGIES CORP",
    "EC",
    "Class A Common",
  ],
  ["EPIC GAMES INC PP", "EPIC GAMES INC", "EC", "Common"],
  ["ANTHROPIC PBC", "ANTHROPIC PBC", "EP", "Preferred"],
  [
    "Studio Type One Soul II LLC (OpenAI)",
    "Studio Type One Soul II LLC (OpenAI)",
    "EC",
    "SPV interest",
  ],
  [
    "MVP Opportunity Fund VI LLC (Epic Games)",
    "MVP Opportunity Fund VI LLC (Epic Games)",
    "EC",
    "SPV interest",
  ],
  ["Anduril Investors LLC, Series G", "Anduril Investors LLC", "EC", "SPV interest"],
  ["Anthropic SPV Exposure", "Anthropic SPV Exposure", "OTHER", "SPV interest"],
  [
    "NV Figure AI Series B QP Partners LLC Economic Exposure to Figure AI, Inc. Series B Preferred Stock",
    "NV Figure AI Series B QP Partners LLC Economic Exposure",
    "OTHER",
    "SPV interest",
  ],
  [
    "SPACE EXPLORATION TECHNOLOGIES CORP 144A 5.350000% 07/15/2031",
    "SPACE EXPLORATION TECHNOLOGIES CORP.",
    "DBT",
    "Debt",
  ],
  ["STRIPE INC SERIES A 5.04 2030 PP", "STRIPE INC SERIES A 5.04 2030 PP", "DBT", "Debt"],
  ["Databricks Inc 2025 1st Amendment Delayed Draw Term Loan", "Databricks Inc", "LON", "Debt"],
  ["Space Exploration Technologies Corp. CDS 06/31", "Barclays", "DCR", "Derivative"],
  ["CFD SPACE EXPLORATION TECHN-CL A", "CFD SPACE EXPLORATION TECHN-CL A", "DE", "Derivative"],
  ["Databricks, Inc.", "Databricks, Inc.", "", "Unclassified"],
];

describe("interim security labels", () => {
  it.each(FILED)("%s → %s", (title, name, category, label) => {
    expect(classifySecurity(title, name, category).label).toBe(label);
  });

  it("gives each label its kind", () => {
    const kinds = Object.fromEntries(
      FILED.map(([title, name, category]) => {
        const { label, kind } = classifySecurity(title, name, category);
        return [label.replace(/^Series \S+ /, "Series ").replace(/^Class \S+ /, "Class "), kind];
      }),
    );
    expect(kinds).toEqual({
      "Series Preferred": "preferred",
      Preferred: "preferred",
      "Class Common": "common",
      Common: "common",
      "SPV interest": "spv_interest",
      Debt: "other",
      Derivative: "other",
      Unclassified: "unknown",
    });
  });
});
