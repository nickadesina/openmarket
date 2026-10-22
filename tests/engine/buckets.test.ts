import { describe, expect, it } from "vitest";

import {
  VALUATION_BOUNDARIES_USD,
  VALUATION_BUCKET_COUNT,
  VALUATION_GRID_VERSION,
} from "../../src/lib/engine/buckets.js";

describe("valuation grid v1", () => {
  it("exports the canonical 40 formula-derived boundaries", () => {
    const expected = Array.from(
      { length: 40 },
      (_, index) => 1_000_000_000_000 * 2 ** ((index - 32) / 2),
    );

    expect(VALUATION_GRID_VERSION).toBe("valuation-v1");
    expect(VALUATION_BOUNDARIES_USD).toEqual(expected);
    expect(VALUATION_BOUNDARIES_USD).toHaveLength(40);
    expect(VALUATION_BUCKET_COUNT).toBe(41);
    expect(Object.isFrozen(VALUATION_BOUNDARIES_USD)).toBe(true);
  });
});
