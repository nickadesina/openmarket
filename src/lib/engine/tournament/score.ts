import { assertFinite, assertPositive } from "../assert.js";

/** ε: the least probability a log is taken of; bounds the worst segment. */
export const SCORE_EPSILON = 1e-3;

/**
 * Baseline-relative log score of one probability on the outcome that
 * happened: 0 for uniform over `outcomeCount` outcomes, 100 for certainty.
 * A binary is `outcomeCount = 2`: 0 is "said 50%".
 */
export function pointLogScore(probability: number, outcomeCount: number): number {
  assertFinite(probability, "probability");
  if (probability < 0 || probability > 1)
    throw new RangeError("probability must be between zero and one");
  if (!Number.isSafeInteger(outcomeCount) || outcomeCount <= 1)
    throw new RangeError("outcomeCount must be an integer greater than one");
  return (
    (100 / Math.log(outcomeCount)) * Math.log(outcomeCount * Math.max(probability, SCORE_EPSILON))
  );
}

/**
 * The lowest score a forecast can take (decision 0004): a binary at ε on the
 * outcome that happened, and the forward's floor. About −896.6.
 */
export const CLAMP_SCORE = pointLogScore(SCORE_EPSILON, 2);

export type BinaryOutcome = "yes" | "no";

/** The n = 2 log score of a P(YES) forecast once the binary resolves. */
export function binaryScore(p: number, outcome: BinaryOutcome): number {
  return pointLogScore(outcome === "yes" ? p : 1 - p, 2);
}

/**
 * The forward score of a level `x` against the settling value `y` (same
 * unit): 100 when exact, 0 at a 2× miss either way, affine in −|ln x − ln y|,
 * floored at CLAMP_SCORE (which binds past a 1/ε = 1000× miss).
 */
export function forwardScore(x: number, y: number): number {
  assertPositive(x, "x");
  assertPositive(y, "y");
  return Math.max(100 * (1 - Math.abs(Math.log(x / y)) / Math.LN2), CLAMP_SCORE);
}

export interface TimedForecast<T> {
  /** Server submission time, epoch milliseconds. */
  readonly at: number;
  readonly forecast: T;
}

export interface ScoreInput<T> {
  /** Open window [t0, t1] in epoch milliseconds. */
  readonly opensAt: number;
  readonly closesAt: number;
  /** One forecaster's submissions in any order; those outside the window are ignored. */
  readonly forecasts: readonly TimedForecast<T>[];
  /** The score of holding one forecast, given the resolution. */
  readonly score: (forecast: T) => number;
}

export interface ScoreResult {
  readonly timeAvgLogScore: number;
  readonly finalLogScore: number;
  /** Fraction of the open window with a forecast on file. */
  readonly coverage: number;
}

/**
 * Time-averaged score. The forecast held at t is the latest submitted at or
 * before t; time before the first submission contributes 0, so the integral
 * is an exact sum over the segments between submissions.
 */
export function timeAveragedScore<T>(input: ScoreInput<T>): ScoreResult | null {
  const { opensAt, closesAt, score } = input;
  if (!(closesAt > opensAt)) throw new RangeError("the open window must have positive length");

  const inWindow = input.forecasts
    .filter((forecast) => forecast.at >= opensAt && forecast.at < closesAt)
    .sort((left, right) => left.at - right.at);
  if (inWindow.length === 0) return null;

  let integral = 0;
  for (let index = 0; index < inWindow.length; index += 1) {
    const held = inWindow[index]!;
    const segmentEnd = index + 1 < inWindow.length ? inWindow[index + 1]!.at : closesAt;
    integral += (segmentEnd - held.at) * score(held.forecast);
  }

  const window = closesAt - opensAt;
  const last = inWindow[inWindow.length - 1]!;
  return {
    timeAvgLogScore: integral / window,
    finalLogScore: score(last.forecast),
    coverage: (closesAt - inWindow[0]!.at) / window,
  };
}
