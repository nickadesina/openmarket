import { SCORE_EPSILON } from "./score.js";

/** Default extremization exponent; stored per question so it can be tuned without rewriting history. */
export const DEFAULT_EXTREMIZATION = 1.5;

/** The aggregate is published only once this many forecasters are on file. */
export const MIN_PUBLISHED_FORECASTERS = 5;

/** Recorded on every aggregate row; bump when the weighting changes. */
export const AGGREGATE_WEIGHTING_VERSION = "equal-v1";

/** Clamps a vector to [ε, 1 − ε] and renormalizes it. */
export function clampVector(probs: readonly number[], epsilon = SCORE_EPSILON): number[] {
  const clamped = probs.map((probability) => Math.min(Math.max(probability, epsilon), 1 - epsilon));
  const sum = clamped.reduce((total, probability) => total + probability, 0);
  return clamped.map((probability) => probability / sum);
}

/**
 * Geometric mean of odds across forecasters, extremized by `a`, mapped back
 * to probabilities and renormalized. Computed in log space: per bucket the
 * mean logit is scaled by `a` and passed through the logistic function.
 * Returns null for an empty set.
 */
export function aggregateForecasts(
  vectors: readonly (readonly number[])[],
  extremization = DEFAULT_EXTREMIZATION,
  epsilon = SCORE_EPSILON,
): number[] | null {
  if (vectors.length === 0) return null;
  if (!Number.isFinite(extremization) || extremization <= 0) {
    throw new RangeError("extremization must be a positive number");
  }
  const bucketCount = vectors[0]!.length;
  if (bucketCount < 2) throw new RangeError("vectors need at least two buckets");

  const logitSums = new Array<number>(bucketCount).fill(0);
  for (const vector of vectors) {
    if (vector.length !== bucketCount) throw new RangeError("vectors differ in length");
    const clamped = clampVector(vector, epsilon);
    clamped.forEach((probability, index) => {
      logitSums[index]! += Math.log(probability) - Math.log1p(-probability);
    });
  }

  const raw = logitSums.map((sum) => {
    const logit = (extremization * sum) / vectors.length;
    // Numerically stable logistic.
    return logit >= 0 ? 1 / (1 + Math.exp(-logit)) : Math.exp(logit) / (1 + Math.exp(logit));
  });
  const total = raw.reduce((sum, probability) => sum + probability, 0);
  return raw.map((probability) => probability / total);
}
