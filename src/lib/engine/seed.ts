import { impliedValuationMedian } from "./median.js";

const VALUATION_BOUNDARY_COUNT = 40;
const MIN_VALUATION_PROBABILITY = 0.001;
const SQRT_TWO = Math.sqrt(2);

interface SeededMarket {
  probabilities: number[];
  q: number[];
  currentMetric: number;
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
}

function assertPositive(value: number, name: string): void {
  assertFinite(value, name);
  if (value <= 0) {
    throw new RangeError(`${name} must be greater than zero`);
  }
}

function validateBoundaries(boundaries: readonly number[]): void {
  if (!Array.isArray(boundaries) || boundaries.length !== VALUATION_BOUNDARY_COUNT) {
    throw new RangeError(`boundaries must contain exactly ${VALUATION_BOUNDARY_COUNT} values`);
  }

  let previous = 0;
  for (const boundary of boundaries) {
    assertPositive(boundary, "boundary");
    if (boundary <= previous) {
      throw new RangeError("boundaries must be strictly increasing");
    }
    previous = boundary;
  }

  const firstBoundary = boundaries[0]!;
  const lastBoundary = boundaries[boundaries.length - 1]!;
  if (firstBoundary / SQRT_TWO <= 0 || !Number.isFinite(lastBoundary * SQRT_TWO)) {
    throw new RangeError("boundaries must have finite, positive virtual edges");
  }
}

// Numerical Recipes' complementary-error-function approximation. Its maximum
// absolute error is about 1.2e-7, including in the tails needed by the grid.
function complementaryErrorFunction(value: number): number {
  const t = 1 / (1 + 0.5 * value);
  let polynomial = 0.17087277;
  polynomial = -0.82215223 + t * polynomial;
  polynomial = 1.48851587 + t * polynomial;
  polynomial = -1.13520398 + t * polynomial;
  polynomial = 0.27886807 + t * polynomial;
  polynomial = -0.18628806 + t * polynomial;
  polynomial = 0.09678418 + t * polynomial;
  polynomial = 0.37409196 + t * polynomial;
  polynomial = 1.00002368 + t * polynomial;
  return t * Math.exp(-value * value - 1.26551223 + t * polynomial);
}

function standardNormalCdf(value: number): number {
  if (value === 0) {
    return 0.5;
  }
  const tail = 0.5 * complementaryErrorFunction(Math.abs(value) / SQRT_TWO);
  return value < 0 ? tail : 1 - tail;
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

export function seedValuationMarket(
  anchorValuation: number,
  sigma: number,
  b: number,
  boundaries: readonly number[],
): SeededMarket {
  assertPositive(anchorValuation, "anchorValuation");
  assertPositive(sigma, "sigma");
  assertPositive(b, "b");
  validateBoundaries(boundaries);

  const mu = Math.log(anchorValuation);
  const cumulative = boundaries.map((boundary) =>
    standardNormalCdf((Math.log(boundary) - mu) / sigma),
  );
  const masses = new Array<number>(boundaries.length + 1);
  masses[0] = cumulative[0] ?? 0;
  for (let index = 1; index < cumulative.length; index += 1) {
    masses[index] = Math.max(0, cumulative[index]! - cumulative[index - 1]!);
  }
  masses[masses.length - 1] = Math.max(0, 1 - (cumulative.at(-1) ?? 1));

  const floored = masses.map((mass) => Math.max(mass, MIN_VALUATION_PROBABILITY));
  const total = floored.reduce((sum, probability) => sum + probability, 0);
  const probabilities = floored.map((probability) => probability / total);
  const q = quantitiesFromProbabilities(probabilities, b);

  return {
    probabilities,
    q,
    currentMetric: impliedValuationMedian(probabilities, boundaries),
  };
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
