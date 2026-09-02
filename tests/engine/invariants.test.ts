import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  VALUATION_BOUNDARIES_USD,
  VALUATION_BUCKET_COUNT,
  valuationBucketEdges,
  valuationBucketIndex,
} from "../../src/lib/engine/buckets.js";
import { contractDelta, contractMask } from "../../src/lib/engine/contracts.js";
import { decomposeHoldings } from "../../src/lib/engine/decomposition.js";
import { probabilities, solveBuyQuantityForSpend, tradeCost } from "../../src/lib/engine/lmsr.js";
import { impliedValuationMedian } from "../../src/lib/engine/median.js";
import { seedValuationMarket } from "../../src/lib/engine/seed.js";
import { type ContractSide, EPS, MIN_QUANTITY } from "../../src/lib/engine/types.js";

const PROPERTY_OPTIONS = { numRuns: 48, seed: 0x51eed } as const;

const liquidityArb = fc.integer({ min: 10, max: 1_000 });
const qEntryArb = fc.integer({ min: -10_000, max: 10_000 }).map((value) => value / 100);
const marketStateArb = fc.tuple(
  fc.array(qEntryArb, {
    minLength: VALUATION_BUCKET_COUNT,
    maxLength: VALUATION_BUCKET_COUNT,
  }),
  liquidityArb,
);
const strikeArb = fc.integer({ min: 0, max: VALUATION_BOUNDARIES_USD.length - 1 });
const sideArb = fc.constantFrom<ContractSide>("yes", "no");
const quantityArb = fc.integer({ min: 1, max: 100_000 }).map((value) => value / 1_000);

function addVectors(left: readonly number[], right: readonly number[]): number[] {
  if (left.length !== right.length) {
    throw new RangeError("Cannot add vectors of different lengths");
  }

  return left.map((value, index) => value + right[index]!);
}

function expectClose(actual: number, expected: number, scale = 1): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(EPS * Math.max(1, scale));
}

function medianBucketIndex(pmf: readonly number[]): number {
  let cumulative = 0;

  for (let index = 0; index < pmf.length; index += 1) {
    cumulative += pmf[index]!;
    if (cumulative >= 0.5) {
      return index;
    }
  }

  return pmf.length - 1;
}

describe("cross-module mathematical invariants", () => {
  it("normalizes every LMSR PMF", () => {
    fc.assert(
      fc.property(marketStateArb, ([q, liquidity]) => {
        const pmf = probabilities(q, liquidity);

        expect(pmf).toHaveLength(VALUATION_BUCKET_COUNT);
        expect(pmf.every((probability) => Number.isFinite(probability))).toBe(true);
        expect(pmf.every((probability) => probability >= 0 && probability <= 1)).toBe(true);
        expectClose(
          pmf.reduce((sum, probability) => sum + probability, 0),
          1,
        );
      }),
      PROPERTY_OPTIONS,
    );
  });

  it("makes YES probability non-increasing across the strike ladder", () => {
    fc.assert(
      fc.property(marketStateArb, ([q, liquidity]) => {
        const pmf = probabilities(q, liquidity);
        let previousYesProbability = 1;

        for (let strikeIndex = 0; strikeIndex < VALUATION_BOUNDARIES_USD.length; strikeIndex += 1) {
          const mask = contractMask(VALUATION_BUCKET_COUNT, strikeIndex, "yes");
          const yesProbability = pmf.reduce(
            (sum, probability, bucketIndex) => sum + (mask[bucketIndex] ? probability : 0),
            0,
          );

          expect(yesProbability).toBeLessThanOrEqual(previousYesProbability + EPS);
          previousYesProbability = yesProbability;
        }
      }),
      PROPERTY_OPTIONS,
    );
  });

  it("prices equal-quantity YES and NO buys as one full set", () => {
    fc.assert(
      fc.property(
        marketStateArb,
        strikeArb,
        quantityArb,
        ([q, liquidity], strikeIndex, quantity) => {
          const yesDelta = contractDelta(
            VALUATION_BUCKET_COUNT,
            strikeIndex,
            "yes",
            "buy",
            quantity,
          );
          const noDelta = contractDelta(VALUATION_BUCKET_COUNT, strikeIndex, "no", "buy", quantity);
          const yesCost = tradeCost(q, yesDelta, liquidity);
          const qAfterYes = addVectors(q, yesDelta);
          const noCost = tradeCost(qAfterYes, noDelta, liquidity);

          expectClose(yesCost + noCost, quantity, quantity);
        },
      ),
      PROPERTY_OPTIONS,
    );
  });

  it("makes disjoint and combined trade deltas path-independent", () => {
    fc.assert(
      fc.property(
        marketStateArb,
        strikeArb,
        quantityArb,
        quantityArb,
        ([q, liquidity], strikeIndex, yesQuantity, noQuantity) => {
          const yesDelta = contractDelta(
            VALUATION_BUCKET_COUNT,
            strikeIndex,
            "yes",
            "buy",
            yesQuantity,
          );
          const noDelta = contractDelta(
            VALUATION_BUCKET_COUNT,
            strikeIndex,
            "no",
            "buy",
            noQuantity,
          );
          const combinedDelta = addVectors(yesDelta, noDelta);
          const directCost = tradeCost(q, combinedDelta, liquidity);

          const qAfterYes = addVectors(q, yesDelta);
          const yesThenNoCost =
            tradeCost(q, yesDelta, liquidity) + tradeCost(qAfterYes, noDelta, liquidity);

          const qAfterNo = addVectors(q, noDelta);
          const noThenYesCost =
            tradeCost(q, noDelta, liquidity) + tradeCost(qAfterNo, yesDelta, liquidity);

          expectClose(yesThenNoCost, directCost, Math.abs(directCost));
          expectClose(noThenYesCost, directCost, Math.abs(directCost));
          expect(addVectors(qAfterYes, noDelta)).toEqual(addVectors(qAfterNo, yesDelta));
        },
      ),
      PROPERTY_OPTIONS,
    );
  });

  it("reproduces seeded probabilities from seeded q", () => {
    const anchorArb = fc
      .tuple(fc.integer({ min: 1, max: 999 }), fc.integer({ min: 7, max: 10 }))
      .map(([mantissa, exponent]) => mantissa * 10 ** exponent);
    const sigmaArb = fc.integer({ min: 25, max: 100 }).map((value) => value / 100);
    const seedLiquidityArb = fc.integer({ min: 100, max: 50_000 });

    fc.assert(
      fc.property(anchorArb, sigmaArb, seedLiquidityArb, (anchor, sigma, liquidity) => {
        const seed = seedValuationMarket(anchor, sigma, liquidity, VALUATION_BOUNDARIES_USD);
        const reproduced = probabilities(seed.q, liquidity);

        expect(reproduced).toHaveLength(seed.probabilities.length);
        for (let index = 0; index < reproduced.length; index += 1) {
          expectClose(reproduced[index]!, seed.probabilities[index]!);
        }
      }),
      PROPERTY_OPTIONS,
    );
  });

  it("keeps spend buys within the submitted cent amount", () => {
    const spendCentsArb = fc.integer({ min: 1, max: 100_000 });

    fc.assert(
      fc.property(
        marketStateArb,
        strikeArb,
        sideArb,
        spendCentsArb,
        ([q, liquidity], strikeIndex, side, spendCents) => {
          const mask = contractMask(VALUATION_BUCKET_COUNT, strikeIndex, side);
          const result = solveBuyQuantityForSpend(q, mask, liquidity, spendCents);

          expect(result.quantity).toBeGreaterThanOrEqual(MIN_QUANTITY);
          expect(result.costUsd).toBeGreaterThan(0);
          expect(result.costUsd).toBeLessThanOrEqual(spendCents / 100 + EPS);
          expect(result.cashAmountCents).toBeGreaterThan(0);
          expect(result.cashAmountCents).toBeLessThanOrEqual(spendCents);
        },
      ),
      PROPERTY_OPTIONS,
    );
  });

  it("rejects sub-cent spends before they can create sub-minimum or zero-cent effects", () => {
    const invalidSpendCentsArb = fc.constantFrom(0, Number.MIN_VALUE, 0.5, 0.999999);

    fc.assert(
      fc.property(
        marketStateArb,
        strikeArb,
        sideArb,
        invalidSpendCentsArb,
        ([q, liquidity], strikeIndex, side, spendCents) => {
          const mask = contractMask(VALUATION_BUCKET_COUNT, strikeIndex, side);

          expect(() => solveBuyQuantityForSpend(q, mask, liquidity, spendCents)).toThrow(
            RangeError,
          );
        },
      ),
      PROPERTY_OPTIONS,
    );
  });

  it("keeps the implied median inside its selected valuation bucket", () => {
    fc.assert(
      fc.property(marketStateArb, ([q, liquidity]) => {
        const pmf = probabilities(q, liquidity);
        const selectedBucketIndex = medianBucketIndex(pmf);
        const median = impliedValuationMedian(pmf, VALUATION_BOUNDARIES_USD);
        const edges = valuationBucketEdges(selectedBucketIndex);
        const edgeScale = Math.max(Math.abs(edges.lower), Math.abs(edges.upper), 1);

        expect(median).toBeGreaterThanOrEqual(edges.lower - EPS * edgeScale);
        expect(median).toBeLessThanOrEqual(edges.upper + EPS * edgeScale);
        expect(valuationBucketIndex(median)).toBe(selectedBucketIndex);
      }),
      PROPERTY_OPTIONS,
    );
  });

  it("reconstructs non-negative holdings from decomposed positions and residual", () => {
    const tradeArb = fc.record({
      strikeIndex: strikeArb,
      side: sideArb,
      quantity: quantityArb,
    });

    fc.assert(
      fc.property(fc.array(tradeArb, { minLength: 0, maxLength: 12 }), (trades) => {
        const holdings = Array<number>(VALUATION_BUCKET_COUNT).fill(0);

        for (const trade of trades) {
          const delta = contractDelta(
            VALUATION_BUCKET_COUNT,
            trade.strikeIndex,
            trade.side,
            "buy",
            trade.quantity,
          );
          for (let bucketIndex = 0; bucketIndex < holdings.length; bucketIndex += 1) {
            holdings[bucketIndex] = holdings[bucketIndex]! + delta[bucketIndex]!;
          }
        }

        const snapshot = holdings.slice();
        const decomposition = decomposeHoldings(holdings);
        const reconstructed = decomposition.residual.slice();

        expect(holdings).toEqual(snapshot);
        expect(decomposition.residual).toHaveLength(holdings.length);
        expect(decomposition.residual.every((quantity) => quantity >= -EPS)).toBe(true);

        for (const position of decomposition.positions) {
          expect(position.quantity).toBeGreaterThan(0);
          const delta = contractDelta(
            VALUATION_BUCKET_COUNT,
            position.strikeIndex,
            position.side,
            "buy",
            position.quantity,
          );
          for (let bucketIndex = 0; bucketIndex < reconstructed.length; bucketIndex += 1) {
            reconstructed[bucketIndex] = reconstructed[bucketIndex]! + delta[bucketIndex]!;
          }
        }

        for (let bucketIndex = 0; bucketIndex < holdings.length; bucketIndex += 1) {
          expect(reconstructed[bucketIndex]!).toBeGreaterThanOrEqual(-EPS);
          expectClose(
            reconstructed[bucketIndex]!,
            holdings[bucketIndex]!,
            Math.abs(holdings[bucketIndex]!),
          );
        }
      }),
      PROPERTY_OPTIONS,
    );
  });
});
