import { assertPositive } from "./assert.js";
import { SQRT_TWO } from "./types.js";
/**
 * The read-only implied distribution (README D11, TECHNICAL_DESIGN.md §6):
 * a lognormal centred on the forward's model mid with the tier's prior width
 * σ, laid over the 41-bucket valuation grid. Nothing trades on it; it is the
 * forward mid restated as bucket masses and as P(valuation > strike).
 *
 * Every bucket is floored at MIN_BUCKET_PROBABILITY before normalizing, the
 * rule the ladder's seed used. README D5 keeps that floor open as a display
 * question, so the tails it creates are a grid artifact, not a view.
 */

export const MIN_BUCKET_PROBABILITY = 0.001;

function validateBoundaries(boundaries: readonly number[]): void {
  if (!Array.isArray(boundaries) || boundaries.length < 1) {
    throw new RangeError("boundaries must contain at least one value");
  }
  let previous = 0;
  for (const boundary of boundaries) {
    assertPositive(boundary, "boundary");
    if (boundary <= previous) throw new RangeError("boundaries must be strictly increasing");
    previous = boundary;
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
  if (value === 0) return 0.5;
  const tail = 0.5 * complementaryErrorFunction(Math.abs(value) / SQRT_TWO);
  return value < 0 ? tail : 1 - tail;
}

/**
 * Bucket masses of a lognormal with median `centerUsd` and log-sd `sigma`
 * over `boundaries` (bucket i ends at boundary i; the last is open above),
 * floored and renormalized. Returns boundaries.length + 1 probabilities.
 */
export function lognormalBucketProbabilities(
  centerUsd: number,
  sigma: number,
  boundaries: readonly number[],
): number[] {
  assertPositive(centerUsd, "centerUsd");
  assertPositive(sigma, "sigma");
  validateBoundaries(boundaries);

  const mu = Math.log(centerUsd);
  const cumulative = boundaries.map((boundary) =>
    standardNormalCdf((Math.log(boundary) - mu) / sigma),
  );
  const masses = new Array<number>(boundaries.length + 1);
  masses[0] = cumulative[0]!;
  for (let index = 1; index < cumulative.length; index += 1) {
    masses[index] = Math.max(0, cumulative[index]! - cumulative[index - 1]!);
  }
  masses[boundaries.length] = Math.max(0, 1 - cumulative.at(-1)!);

  const floored = masses.map((mass) => Math.max(mass, MIN_BUCKET_PROBABILITY));
  const total = floored.reduce((sum, mass) => sum + mass, 0);
  return floored.map((mass) => mass / total);
}

/** P(valuation > boundary i) for each boundary: the mass of every bucket above it. */
export function probabilitiesAbove(probabilities: readonly number[]): number[] {
  if (probabilities.length < 2) {
    throw new RangeError("probabilities must contain at least two buckets");
  }
  for (const mass of probabilities) {
    if (!Number.isFinite(mass) || mass < 0) {
      throw new RangeError("probabilities must be finite and non-negative");
    }
  }
  const above = new Array<number>(probabilities.length - 1);
  let tail = 0;
  for (let index = probabilities.length - 1; index >= 1; index -= 1) {
    const mass = probabilities[index]!;
    tail += mass;
    above[index - 1] = Math.min(1, tail);
  }
  return above;
}
