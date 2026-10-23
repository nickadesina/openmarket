import { SCORE_EPSILON } from "./score.js";

/** Default extremization exponent; stored per question so it can be tuned without rewriting history. */
const DEFAULT_EXTREMIZATION = 1.5;

/** The aggregate is published only once this many forecasters are on file. */
export const MIN_PUBLISHED_FORECASTERS = 5;

/** Recorded on every aggregate row; bump when the weighting changes. */
export const AGGREGATE_WEIGHTING_VERSION = "equal-v1";

/** Clamps a probability to [ε, 1 − ε]. */
function clampProbability(probability: number, epsilon = SCORE_EPSILON): number {
  return Math.min(Math.max(probability, epsilon), 1 - epsilon);
}

/** Numerically stable logistic. */
function logistic(logit: number): number {
  return logit >= 0 ? 1 / (1 + Math.exp(-logit)) : Math.exp(logit) / (1 + Math.exp(logit));
}

/**
 * The binary crowd: geometric mean of odds across forecasters, extremized by
 * `a`, as P(YES) = σ(a · mean logit(clamp p)). Null for an empty set.
 */
export function aggregateBinary(
  probabilities: readonly number[],
  extremization = DEFAULT_EXTREMIZATION,
  epsilon = SCORE_EPSILON,
): number | null {
  if (probabilities.length === 0) return null;
  if (!Number.isFinite(extremization) || extremization <= 0) {
    throw new RangeError("extremization must be a positive number");
  }
  let logitSum = 0;
  for (const probability of probabilities) {
    if (!Number.isFinite(probability)) throw new RangeError("probabilities must be finite");
    const clamped = clampProbability(probability, epsilon);
    logitSum += Math.log(clamped) - Math.log1p(-clamped);
  }
  return logistic((extremization * logitSum) / probabilities.length);
}

/**
 * The forward crowd: the median of the forecasters' ln levels (the mean of
 * the two middle ones for an even count), returned in the levels' unit.
 * Null for an empty set.
 */
export function aggregateForward(levels: readonly number[]): number | null {
  if (levels.length === 0) return null;
  const logs = levels
    .map((level) => {
      if (!(level > 0) || !Number.isFinite(level)) throw new RangeError("levels must be positive");
      return Math.log(level);
    })
    .sort((left, right) => left - right);
  const middle = Math.floor(logs.length / 2);
  const medianLn = logs.length % 2 === 1 ? logs[middle]! : (logs[middle - 1]! + logs[middle]!) / 2;
  return Math.exp(medianLn);
}
