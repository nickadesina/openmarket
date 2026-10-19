/** Probability floor applied before taking a log; bounds the worst segment. */
export const SCORE_EPSILON = 1e-3;

export interface TimedForecast {
  /** Server submission time, epoch milliseconds. */
  readonly at: number;
  readonly probs: readonly number[];
}

export interface ScoreInput {
  readonly bucketCount: number;
  readonly winningIndex: number;
  /** Open window [t0, t1] in epoch milliseconds. */
  readonly opensAt: number;
  readonly closesAt: number;
  /** One forecaster's submissions in any order; those outside the window are ignored. */
  readonly forecasts: readonly TimedForecast[];
}

export interface ScoreResult {
  readonly timeAvgLogScore: number;
  readonly finalLogScore: number;
  /** Fraction of the open window with a forecast on file. */
  readonly coverage: number;
}

/**
 * Baseline-relative log score of one probability on the winning bucket:
 * 0 for uniform, 100 for certainty, about −200 at the clamp for n = 9.
 */
export function pointLogScore(probability: number, bucketCount: number): number {
  return (
    (100 / Math.log(bucketCount)) * Math.log(bucketCount * Math.max(probability, SCORE_EPSILON))
  );
}

/** The score of a zero (clamped) probability on the bucket that wins. */
export function clampedFloorScore(bucketCount: number): number {
  return pointLogScore(0, bucketCount);
}

/**
 * Time-averaged log score. p(t) is the latest forecast submitted at or
 * before t, uniform before the first submission, so the integral is an
 * exact sum over the segments between submissions.
 */
export function timeAveragedScore(input: ScoreInput): ScoreResult | null {
  const { bucketCount, winningIndex, opensAt, closesAt } = input;
  if (!Number.isInteger(bucketCount) || bucketCount < 2) {
    throw new RangeError("bucketCount must be an integer of at least 2");
  }
  if (!Number.isInteger(winningIndex) || winningIndex < 0 || winningIndex >= bucketCount) {
    throw new RangeError("winningIndex is out of range");
  }
  if (!(closesAt > opensAt)) throw new RangeError("the open window must have positive length");

  const inWindow = input.forecasts
    .filter((forecast) => forecast.at >= opensAt && forecast.at < closesAt)
    .slice()
    .sort((left, right) => left.at - right.at);
  if (inWindow.length === 0) return null;

  let integral = 0;
  for (let index = 0; index < inWindow.length; index += 1) {
    const forecast = inWindow[index]!;
    if (forecast.probs.length !== bucketCount) {
      throw new RangeError("forecast length does not match bucketCount");
    }
    const segmentEnd = index + 1 < inWindow.length ? inWindow[index + 1]!.at : closesAt;
    integral +=
      (segmentEnd - forecast.at) * pointLogScore(forecast.probs[winningIndex]!, bucketCount);
  }

  const window = closesAt - opensAt;
  const last = inWindow[inWindow.length - 1]!;
  return {
    timeAvgLogScore: integral / window,
    finalLogScore: pointLogScore(last.probs[winningIndex]!, bucketCount),
    coverage: (closesAt - inWindow[0]!.at) / window,
  };
}
