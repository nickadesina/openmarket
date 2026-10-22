import { EPS, SQRT_TWO } from "./types.js";

function validateQuantileInputs(
  probabilities: readonly number[],
  boundaries: readonly number[],
  quantile: number,
): { virtualLowerEdge: number; virtualUpperEdge: number } {
  if (!Number.isFinite(quantile) || quantile <= 0 || quantile >= 1) {
    throw new RangeError("quantile must be strictly between zero and one");
  }
  if (probabilities.length === 0 || boundaries.length !== probabilities.length - 1) {
    throw new RangeError("probabilities must contain exactly one more value than boundaries");
  }

  let probabilitySum = 0;
  for (const probability of probabilities) {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new RangeError("probabilities must be finite values between zero and one");
    }
    probabilitySum += probability;
  }
  if (!Number.isFinite(probabilitySum) || Math.abs(probabilitySum - 1) > EPS) {
    throw new RangeError("probabilities must sum to one");
  }

  let previousBoundary = 0;
  for (const boundary of boundaries) {
    if (!Number.isFinite(boundary) || boundary <= 0 || boundary <= previousBoundary) {
      throw new RangeError("boundaries must be finite, positive, and strictly increasing");
    }
    previousBoundary = boundary;
  }

  if (boundaries.length === 0) {
    throw new RangeError("a valuation distribution requires at least one boundary");
  }

  const firstBoundary = boundaries[0]!;
  const lastBoundary = boundaries[boundaries.length - 1]!;

  const virtualLowerEdge = firstBoundary / SQRT_TWO;
  const virtualUpperEdge = lastBoundary * SQRT_TWO;
  if (
    !Number.isFinite(virtualLowerEdge) ||
    virtualLowerEdge <= 0 ||
    !Number.isFinite(virtualUpperEdge)
  ) {
    throw new RangeError("boundaries must have finite, positive virtual edges");
  }

  return { virtualLowerEdge, virtualUpperEdge };
}

/**
 * Returns the valuation at which the cumulative probability first reaches
 * `quantile` (0 < quantile < 1), interpolating uniformly in log space within
 * the containing bucket. The open-ended end buckets use virtual edges half an
 * octave beyond the grid, matching the median convention.
 */
export function impliedValuationQuantile(
  probabilities: readonly number[],
  boundaries: readonly number[],
  quantile: number,
): number {
  const { virtualLowerEdge, virtualUpperEdge } = validateQuantileInputs(
    probabilities,
    boundaries,
    quantile,
  );

  let cumulativeBefore = 0;
  for (let bucketIndex = 0; bucketIndex < probabilities.length; bucketIndex += 1) {
    const bucketProbability = probabilities[bucketIndex]!;

    const cumulativeAfter = cumulativeBefore + bucketProbability;
    if (bucketProbability > 0 && cumulativeAfter >= quantile) {
      const lowerEdge = bucketIndex === 0 ? virtualLowerEdge : boundaries[bucketIndex - 1]!;
      const upperEdge =
        bucketIndex === boundaries.length ? virtualUpperEdge : boundaries[bucketIndex]!;

      const fraction = (quantile - cumulativeBefore) / bucketProbability;
      const interpolated = Math.exp(
        Math.log(lowerEdge) + fraction * (Math.log(upperEdge) - Math.log(lowerEdge)),
      );
      return Math.min(upperEdge, Math.max(lowerEdge, interpolated));
    }
    cumulativeBefore = cumulativeAfter;
  }

  throw new RangeError("probabilities do not contain the requested percentile");
}
