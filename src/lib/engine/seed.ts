import { assertFinite, assertPositive } from "./assert.js";

/** The two-outcome LMSR book a dealer binary trades on, seeded at a YES probability. */

interface SeededMarket {
  probabilities: number[];
  q: number[];
  currentMetric: number;
}

function quantitiesFromProbabilities(probabilities: readonly number[], b: number): number[] {
  const logProbabilities = probabilities.map((probability) => Math.log(probability));
  const meanLogProbability =
    logProbabilities.reduce((sum, probability) => sum + probability, 0) / logProbabilities.length;
  const quantities = logProbabilities.map((probability) => b * (probability - meanLogProbability));
  const centeringResidual = quantities.reduce((sum, quantity) => sum + quantity, 0);
  const lastIndex = quantities.length - 1;
  quantities[lastIndex] = quantities[lastIndex]! - centeringResidual;
  if (quantities.some((quantity) => !Number.isFinite(quantity))) {
    throw new RangeError("b is too large to produce finite quantities");
  }
  return quantities;
}

export function seedBinaryMarket(yesProbability: number, b: number): SeededMarket {
  assertFinite(yesProbability, "yesProbability");
  assertPositive(b, "b");
  if (yesProbability <= 0 || yesProbability >= 1) {
    throw new RangeError("yesProbability must be strictly between zero and one");
  }

  const probabilities = [Number((1 - yesProbability).toPrecision(15)), yesProbability];
  return {
    probabilities,
    q: quantitiesFromProbabilities(probabilities, b),
    currentMetric: yesProbability,
  };
}
