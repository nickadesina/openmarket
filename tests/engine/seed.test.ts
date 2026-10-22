import { describe, expect, it } from "vitest";

import { seedBinaryMarket } from "../../src/lib/engine/seed.js";

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
