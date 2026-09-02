import { describe, expect, it } from "vitest";

import { formatCentsAsUsd, parseUsdToCents, USD_MAX_LENGTH } from "../../src/lib/api/money.js";

describe("decimal USD conversion", () => {
  it("converts dollars to cents without Float64 currency arithmetic", () => {
    expect(parseUsdToCents("0")).toBe(0);
    expect(parseUsdToCents("0.01")).toBe(1);
    expect(parseUsdToCents("12.3")).toBe(1_230);
    expect(parseUsdToCents("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseUsdToCents("-12.34")).toBe(-1_234);
  });

  it("rejects every trailing ECMAScript line terminator", () => {
    for (const terminator of ["\n", "\r\n", "\u2028", "\u2029"]) {
      expect(() => parseUsdToCents(`12.34${terminator}`)).toThrow(RangeError);
    }
  });

  it("formats integer cents canonically", () => {
    expect(formatCentsAsUsd(0)).toBe("0.00");
    expect(formatCentsAsUsd(1)).toBe("0.01");
    expect(formatCentsAsUsd(-1_234)).toBe("-12.34");
    expect(formatCentsAsUsd(90_071_992_547_409_912n)).toBe("900719925474099.12");
  });

  it("rejects ambiguous, fractional-cent, and unsafe values", () => {
    for (const value of [
      "",
      ".50",
      "00.50",
      "+1.00",
      "1.",
      "1.001",
      "1e2",
      " 1.00",
      "90071992547409.92",
    ]) {
      expect(() => parseUsdToCents(value)).toThrow(RangeError);
    }

    for (const value of [0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
      expect(() => formatCentsAsUsd(value)).toThrow(RangeError);
    }
  });

  it("rejects overlong input before numeric conversion", () => {
    expect(() => parseUsdToCents("9".repeat(USD_MAX_LENGTH + 1))).toThrow(RangeError);
  });
});
