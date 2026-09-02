import { describe, expect, it } from "vitest";

import { contractDelta, contractMask, sellableQuantity } from "../../src/lib/engine/contracts.js";
import type { ContractSide, TradeAction } from "../../src/lib/engine/types.js";

describe("contractMask", () => {
  it("partitions all 41 outcomes at every valuation strike", () => {
    for (let strikeIndex = 0; strikeIndex < 40; strikeIndex += 1) {
      const yes = contractMask(41, strikeIndex, "yes");
      const no = contractMask(41, strikeIndex, "no");

      expect(yes).toHaveLength(41);
      expect(no).toHaveLength(41);
      for (let bucketIndex = 0; bucketIndex < 41; bucketIndex += 1) {
        expect(Number(yes[bucketIndex]) + Number(no[bucketIndex])).toBe(1);
        expect(yes[bucketIndex]).toBe(bucketIndex > strikeIndex);
        expect(no[bucketIndex]).toBe(bucketIndex <= strikeIndex);
      }
    }
  });

  it("returns fresh mutable-compatible masks", () => {
    const first = contractMask(3, 0, "yes");
    const second = contractMask(3, 0, "yes");

    expect(first).toEqual([false, true, true]);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    first[0] = true;
    expect(second).toEqual([false, true, true]);
  });

  it("rejects invalid bucket counts, strikes, and sides", () => {
    for (const bucketCount of [1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => contractMask(bucketCount, 0, "yes")).toThrow(RangeError);
    }
    for (const strikeIndex of [-1, 2, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => contractMask(3, strikeIndex, "no")).toThrow(RangeError);
    }
    expect(() => contractMask(3, 0, "maybe" as ContractSide)).toThrow(RangeError);
  });
});

describe("contractDelta", () => {
  it("uses positive covered-bucket deltas for buys", () => {
    expect(contractDelta(5, 1, "yes", "buy", 2.5)).toEqual([0, 0, 2.5, 2.5, 2.5]);
    expect(contractDelta(5, 1, "no", "buy", 2.5)).toEqual([2.5, 2.5, 0, 0, 0]);
  });

  it("uses negative covered-bucket deltas for sells", () => {
    expect(contractDelta(4, 2, "yes", "sell", 0.25)).toEqual([0, 0, 0, -0.25]);
    expect(contractDelta(4, 2, "no", "sell", 0.25)).toEqual([-0.25, -0.25, -0.25, 0]);
  });

  it("rejects invalid actions and quantities", () => {
    expect(() => contractDelta(3, 0, "yes", "hold" as TradeAction, 1)).toThrow(RangeError);

    for (const quantity of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => contractDelta(3, 0, "yes", "buy", quantity)).toThrow(RangeError);
    }
  });
});

describe("sellableQuantity", () => {
  it("returns the minimum holding inside the selected mask", () => {
    expect(sellableQuantity([9, 4.5, 7, 2.25, 11], [false, true, true, true, false])).toBe(2.25);
    expect(sellableQuantity([0, 3], [true, false])).toBe(0);
  });

  it("does not mutate holdings or masks", () => {
    const holdings = Object.freeze([5, 2, 8]);
    const mask = Object.freeze([true, true, false]);
    const holdingsBefore = [...holdings];
    const maskBefore = [...mask];

    expect(sellableQuantity(holdings, mask)).toBe(2);
    expect(holdings).toEqual(holdingsBefore);
    expect(mask).toEqual(maskBefore);
  });

  it("rejects malformed, mismatched, and non-finite vectors", () => {
    expect(() => sellableQuantity([], [])).toThrow(RangeError);
    expect(() => sellableQuantity([1, 2], [true])).toThrow(RangeError);
    expect(() => sellableQuantity([1, Number.NaN], [true, false])).toThrow(RangeError);
    expect(() => sellableQuantity([1, Number.POSITIVE_INFINITY], [true, false])).toThrow(
      RangeError,
    );
    expect(() => sellableQuantity([1, -0.1], [true, false])).toThrow(RangeError);
    expect(() => sellableQuantity([1, 2], [false, false])).toThrow(RangeError);
    expect(() => sellableQuantity([1, 2], [true, 1 as unknown as boolean])).toThrow(RangeError);
  });
});
