import { describe, expect, it } from "vitest";

import { seedBinaryMarket, seedValuationMarket } from "../../src/lib/engine/seed.js";

const ANCHOR = 100;
const B = 15_000;
const BOUNDARIES = Array.from({ length: 40 }, (_, index) => ANCHOR * 2 ** ((index - 19.5) / 2));

function softmax(q: readonly number[], b: number): number[] {
  const scaled = q.map((quantity) => quantity / b);
  const max = Math.max(...scaled);
  const weights = scaled.map((value) => Math.exp(value - max));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

function expectNormalized(probabilities: readonly number[]): void {
  expect(probabilities.reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1, 14);
  for (const probability of probabilities) {
    expect(Number.isFinite(probability)).toBe(true);
    expect(probability).toBeGreaterThan(0);
  }
}

function expectSoftmaxInversion(
  probabilities: readonly number[],
  q: readonly number[],
  b: number,
): void {
  const recovered = softmax(q, b);
  expect(recovered).toHaveLength(probabilities.length);
  recovered.forEach((probability, index) => {
    expect(probability).toBeCloseTo(probabilities[index]!, 14);
  });
}

describe("seedValuationMarket", () => {
  it("normalizes the bucket probabilities and mean-centers q", () => {
    const result = seedValuationMarket(ANCHOR, 0.5, B, BOUNDARIES);

    expect(result.probabilities).toHaveLength(41);
    expect(result.q).toHaveLength(41);
    expectNormalized(result.probabilities);
    expect(result.q.reduce((sum, quantity) => sum + quantity, 0)).toBeCloseTo(0, 9);
    expect(result.q.every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(result.currentMetric)).toBe(true);
  });

  it("inverts softmax and places the median at the anchor", () => {
    const result = seedValuationMarket(ANCHOR, 0.5, B, BOUNDARIES);

    expectSoftmaxInversion(result.probabilities, result.q, B);
    expect(result.currentMetric).toBeCloseTo(ANCHOR, 5);
  });

  it("is deterministic and does not mutate its boundaries", () => {
    const boundaries = [...BOUNDARIES];
    const snapshot = [...boundaries];

    const first = seedValuationMarket(ANCHOR, 0.5, B, boundaries);
    const second = seedValuationMarket(ANCHOR, 0.5, B, boundaries);

    expect(boundaries).toEqual(snapshot);
    expect(first).toEqual(second);
    expect(first.probabilities).not.toBe(second.probabilities);
    expect(first.q).not.toBe(second.q);
  });

  it.each<[number, number, number, readonly number[]]>([
    [0, 0.5, B, BOUNDARIES],
    [-1, 0.5, B, BOUNDARIES],
    [Number.NaN, 0.5, B, BOUNDARIES],
    [ANCHOR, 0, B, BOUNDARIES],
    [ANCHOR, Number.POSITIVE_INFINITY, B, BOUNDARIES],
    [ANCHOR, 0.5, 0, BOUNDARIES],
    [ANCHOR, 0.5, Number.NaN, BOUNDARIES],
    [ANCHOR, 0.5, B, BOUNDARIES.slice(1)],
    [ANCHOR, 0.5, B, [...BOUNDARIES.slice(0, 10), Number.NaN, ...BOUNDARIES.slice(11)]],
    [ANCHOR, 0.5, B, [...BOUNDARIES.slice(0, 10), BOUNDARIES[9]!, ...BOUNDARIES.slice(11)]],
  ])("rejects invalid valuation inputs", (anchor, sigma, b, boundaries) => {
    expect(() => seedValuationMarket(anchor, sigma, b, boundaries)).toThrow(RangeError);
  });
});

describe("seedBinaryMarket", () => {
  it("uses [NO, YES] order, normalizes, centers q, and inverts softmax", () => {
    const result = seedBinaryMarket(0.7, 200);

    expect(result.probabilities).toEqual([0.3, 0.7]);
    expect(result.currentMetric).toBe(0.7);
    expectNormalized(result.probabilities);
    expect(result.q.reduce((sum, quantity) => sum + quantity, 0)).toBeCloseTo(0, 12);
    expect(result.q.every(Number.isFinite)).toBe(true);
    expectSoftmaxInversion(result.probabilities, result.q, 200);
  });

  it("returns fresh arrays deterministically", () => {
    const first = seedBinaryMarket(0.25, 100);
    const second = seedBinaryMarket(0.25, 100);

    expect(first).toEqual(second);
    expect(first.probabilities).not.toBe(second.probabilities);
    expect(first.q).not.toBe(second.q);
  });

  it.each<[number, number]>([
    [0, 100],
    [1, 100],
    [-0.1, 100],
    [1.1, 100],
    [Number.NaN, 100],
    [Number.POSITIVE_INFINITY, 100],
    [0.5, 0],
    [0.5, -1],
    [0.5, Number.NaN],
  ])("rejects invalid binary inputs", (probability, b) => {
    expect(() => seedBinaryMarket(probability, b)).toThrow(RangeError);
  });
});
