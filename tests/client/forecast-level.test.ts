import { describe, expect, it } from "vitest";

import { forwardScoreLadder, isForecastLevel } from "../../src/lib/client/tournament.js";

describe("forward forecast field", () => {
  it("accepts only levels the forecast service accepts", () => {
    expect(isForecastLevel(null)).toBe(false);
    expect(isForecastLevel(0)).toBe(false);
    expect(isForecastLevel(-1)).toBe(false);
    expect(isForecastLevel(1e15)).toBe(false);
    expect(isForecastLevel(1e308)).toBe(false);
    expect(isForecastLevel(850)).toBe(true);
  });

  it("previews the largest accepted level without throwing", () => {
    expect(() => forwardScoreLadder(1e15 - 1)).not.toThrow();
  });
});
