import { describe, expect, it } from "vitest";

import { markVersusPrint, type PrintInput } from "../../../src/lib/engine/index/print.js";
import { spvPremium } from "../../../src/lib/engine/index/spv.js";

/** Arithmetic only: no certificate has been imported yet, so these prints are placeholders. */
function print(
  id: string,
  announcedOn: string,
  seriesLabel: string | null,
  pps: number | null,
): PrintInput {
  return { id, roundName: id, announcedOn, seriesLabel, pricePerShareUsd: pps };
}

const MARK = { securityLabel: "Series B Preferred", asOf: "2026-06-30", markPerShareUsd: 20 };

describe("markVersusPrint", () => {
  it("uses the newest priced round on or before the mark", () => {
    const result = markVersusPrint(MARK, [
      print("a", "2025-01-01", "Series A Preferred", 5),
      print("b", "2026-01-01", "Series B Preferred", 10),
      print("c", "2026-06-30", "Series C Preferred", 16),
      print("d", "2026-07-01", "Series D Preferred", 40),
    ]);
    expect(result).toMatchObject({ status: "ok", printId: "c", match: "newest_series" });
    expect(result.ln).toBeCloseTo(Math.log(20 / 16), 12);
  });

  it("falls back to the mark's own series when the newest round is unpriced", () => {
    const result = markVersusPrint(MARK, [
      print("b", "2026-01-01", "Series B Preferred", 10),
      print("c", "2026-05-01", null, null),
    ]);
    expect(result).toMatchObject({ status: "ok", printId: "b", match: "same_label" });
    expect(result.ln).toBeCloseTo(Math.log(2), 12);
  });

  it("is null with a reason otherwise", () => {
    expect(markVersusPrint(MARK, [])).toEqual({
      status: "none",
      ln: null,
      reason: "no_print_on_or_before_mark",
    });
    expect(
      markVersusPrint(MARK, [
        print("a", "2025-01-01", "Series A Preferred", 5),
        print("c", "2026-05-01", null, null),
      ]),
    ).toMatchObject({ status: "none", reason: "no_certificate_price" });
    expect(
      markVersusPrint({ ...MARK, markPerShareUsd: 0 }, [
        print("b", "2026-01-01", "Series B Preferred", 10),
      ]),
    ).toMatchObject({ status: "none", reason: "zero_mark" });
  });

  it("validates and does not mutate", () => {
    const prints = [
      print("c", "2026-05-01", null, null),
      print("b", "2026-01-01", "Series B Preferred", 10),
    ];
    const before = structuredClone(prints);
    markVersusPrint(MARK, prints);
    expect(prints).toEqual(before);
    expect(() =>
      markVersusPrint(MARK, [print("a", "2026-01-01", "Series A Preferred", 0)]),
    ).toThrow(RangeError);
    expect(() => markVersusPrint({ ...MARK, asOf: "June" }, [])).toThrow(RangeError);
  });
});

describe("spvPremium", () => {
  const quote = {
    quotedPricePerShareUsd: 120,
    upfrontFeePct: 5,
    mgmtFeePct: 2,
    carryPct: 20,
    layers: 2,
  };

  it("gives the premium with the upfront fee and the fee-free premium beside it", () => {
    const result = spvPremium(quote, 100);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.premiumLn).toBeCloseTo(Math.log(1.26), 12);
    expect(result.grossPremiumLn).toBeCloseTo(Math.log(1.2), 12);
    expect(result).toMatchObject({ mgmtFeePct: 2, carryPct: 20, layers: 2 });
  });

  it("has no fee-inclusive premium when the fee is not stated, and none without a per-share quote", () => {
    const noFee = spvPremium({ ...quote, upfrontFeePct: null }, 100);
    expect(noFee.status === "ok" && noFee.premiumLn).toBeNull();
    expect(spvPremium({ ...quote, quotedPricePerShareUsd: null }, 100)).toEqual({
      status: "none",
      reason: "no_per_share_quote",
    });
  });

  it("refuses out-of-range terms", () => {
    expect(() => spvPremium(quote, 0)).toThrow(RangeError);
    expect(() => spvPremium({ ...quote, upfrontFeePct: 101 }, 100)).toThrow(RangeError);
    expect(() => spvPremium({ ...quote, layers: 0 }, 100)).toThrow(RangeError);
    expect(() => spvPremium({ ...quote, layers: 1.5 }, 100)).toThrow(RangeError);
  });
});
