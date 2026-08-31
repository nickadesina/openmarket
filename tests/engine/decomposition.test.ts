import { describe, expect, it } from "vitest";

import { decomposeHoldings } from "../../src/lib/engine/decomposition.js";
import {
  EPS,
  type DecomposedPosition,
} from "../../src/lib/engine/types.js";

describe("decomposeHoldings", () => {
  it("extracts an exact YES suffix", () => {
    expect(decomposeHoldings([0, 0, 3, 3])).toEqual({
      positions: [{ side: "yes", strikeIndex: 1, quantity: 3 }],
      residual: [0, 0, 0, 0],
    });
  });

  it("extracts an exact NO prefix", () => {
    expect(decomposeHoldings([2, 2, 2, 0])).toEqual({
      positions: [{ side: "no", strikeIndex: 2, quantity: 2 }],
      residual: [0, 0, 0, 0],
    });
  });

  it("greedily decomposes mixed YES and NO exposure", () => {
    expect(decomposeHoldings([1, 1, 2, 2])).toEqual({
      positions: [
        { side: "yes", strikeIndex: 1, quantity: 2 },
        { side: "no", strikeIndex: 1, quantity: 1 },
      ],
      residual: [0, 0, 0, 0],
    });
  });

  it("applies every deterministic tie-break in order", () => {
    expect(decomposeHoldings([2, 0, 1, 1]).positions[0]).toEqual({
      side: "yes",
      strikeIndex: 1,
      quantity: 1,
    });

    expect(decomposeHoldings([1, 1, 0, 1, 1]).positions[0]).toEqual({
      side: "no",
      strikeIndex: 1,
      quantity: 1,
    });

    expect(decomposeHoldings([1, 1]).positions[0]).toEqual({
      side: "yes",
      strikeIndex: 0,
      quantity: 1,
    });
  });

  it("reconstructs the original holdings and bounds extraction count", () => {
    const holdings = [4, 1.25, 3.5, 2, 5.25, 0.75];
    const decomposition = decomposeHoldings(holdings);
    const reconstructed = reconstruct(holdings.length, decomposition);

    for (let bucket = 0; bucket < holdings.length; bucket += 1) {
      expect(Math.abs(reconstructed[bucket]! - holdings[bucket]!)).toBeLessThanOrEqual(
        EPS,
      );
    }
    expect(decomposition.positions.length).toBeLessThanOrEqual(
      holdings.filter((holding) => holding > EPS).length,
    );
  });

  it("leaves only non-negative residual exposure and clips tiny values", () => {
    const decomposition = decomposeHoldings([0, 2, EPS / 2, -EPS / 2]);

    expect(decomposition.positions).toEqual([]);
    expect(decomposition.residual).toEqual([0, 2, 0, 0]);
    for (const holding of decomposition.residual) {
      expect(holding).toBeGreaterThanOrEqual(0);
    }
  });

  it("rejects invalid lengths, non-finite values, and material negatives", () => {
    expect(() => decomposeHoldings([])).toThrow(RangeError);
    expect(() => decomposeHoldings([1])).toThrow(RangeError);
    expect(() => decomposeHoldings([0, Number.NaN])).toThrow(RangeError);
    expect(() => decomposeHoldings([0, Number.POSITIVE_INFINITY])).toThrow(
      RangeError,
    );
    expect(() => decomposeHoldings([0, Number.NEGATIVE_INFINITY])).toThrow(
      RangeError,
    );
    expect(() => decomposeHoldings([0, -2 * EPS])).toThrow(RangeError);
  });

  it("does not mutate caller-owned holdings", () => {
    const holdings = Object.freeze([1, 1, 2, 2]);
    const original = [...holdings];

    const decomposition = decomposeHoldings(holdings);

    expect(holdings).toEqual(original);
    expect(decomposition.residual).not.toBe(holdings);
  });
});

function reconstruct(
  bucketCount: number,
  decomposition: {
    readonly positions: readonly DecomposedPosition[];
    readonly residual: readonly number[];
  },
): number[] {
  const reconstructed = decomposition.residual.slice();
  expect(reconstructed).toHaveLength(bucketCount);

  for (const position of decomposition.positions) {
    const firstBucket = position.side === "yes" ? position.strikeIndex + 1 : 0;
    const finalBucket =
      position.side === "yes" ? bucketCount - 1 : position.strikeIndex;
    for (let bucket = firstBucket; bucket <= finalBucket; bucket += 1) {
      reconstructed[bucket] = reconstructed[bucket]! + position.quantity;
    }
  }

  return reconstructed;
}
