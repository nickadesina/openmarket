import { describe, expect, it } from "vitest";

import { evidenceInputSchema, evidenceReviewSchema } from "../../src/lib/api/tournament-schemas.js";
import { evidenceDedupeKey, evidenceTerms } from "../../src/lib/services/tournament/evidence.js";

const BASE = { companySlug: "modal", kind: "scoop" as const, day: "2026-10-01" };

describe("evidenceDedupeKey", () => {
  it("is 16 hex and shared by syndicated copies of one report", () => {
    const key = evidenceDedupeKey({ ...BASE, outlet: "The Information", valuationUsd: 2.4e10 });
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    // Outlet case and spacing, and the valuation past one significant figure, do not matter.
    expect(
      evidenceDedupeKey({ ...BASE, outlet: "  the   information ", valuationUsd: 2.0e10 }),
    ).toBe(key);
  });

  it("differs by name, kind, day, outlet and valuation", () => {
    const key = evidenceDedupeKey({ ...BASE, outlet: "Bloomberg", valuationUsd: 3e10 });
    for (const changed of [
      { ...BASE, companySlug: "openai" },
      { ...BASE, kind: "release" as const },
      { ...BASE, day: "2026-10-02" },
      { ...BASE, outlet: "Reuters" },
      { ...BASE, valuationUsd: 4e10 },
    ]) {
      expect(evidenceDedupeKey({ outlet: "Bloomberg", valuationUsd: 3e10, ...changed })).not.toBe(
        key,
      );
    }
  });
});

describe("evidenceTerms", () => {
  it("keeps decision 0001's shape and leaves absent fields absent", () => {
    expect(evidenceTerms({ source_url: "https://example.com/a", kind: "scoop" })).toEqual({
      valuation_basis: "unknown",
    });
    expect(
      evidenceTerms({
        source_url: "https://example.com/a",
        kind: "release",
        terms: { valuation_basis: "pre", valuation_usd: 1e10, amount_usd: 1e9 },
      }),
    ).toEqual({ valuation_basis: "pre", valuation_usd: 1e10, amount_usd: 1e9 });
  });
});

describe("evidence schemas", () => {
  it("needs a valuation for a pre- or post-money basis", () => {
    const base = { source_url: "https://example.com/a", kind: "scoop" };
    expect(
      evidenceInputSchema.safeParse({ ...base, terms: { valuation_basis: "unknown" } }).success,
    ).toBe(true);
    expect(
      evidenceInputSchema.safeParse({ ...base, terms: { valuation_basis: "post" } }).success,
    ).toBe(false);
    expect(
      evidenceInputSchema.safeParse({
        ...base,
        terms: { valuation_basis: "unknown", outlet: "a\u0000" },
      }).success,
    ).toBe(false);
  });

  it("names a confirming flag exactly when it confirms", () => {
    const flag = "00000000-0000-4000-8000-000000000001";
    expect(
      evidenceReviewSchema.safeParse({ decision: "confirmed", confirming_flag_id: flag }).success,
    ).toBe(true);
    expect(evidenceReviewSchema.safeParse({ decision: "confirmed" }).success).toBe(false);
    expect(
      evidenceReviewSchema.safeParse({ decision: "rejected", confirming_flag_id: flag }).success,
    ).toBe(false);
    expect(
      evidenceReviewSchema.safeParse({ decision: "rejected", note: "Dead link." }).success,
    ).toBe(true);
  });
});
