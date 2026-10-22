import { VALUATION_BOUNDARIES_USD } from "../buckets.js";

/**
 * The bucket edges of a forward's linked tournament question (milestone 7,
 * CONTRACTS.md → Tournament mapping), derived from the forward's implied
 * distribution at listing so the question is reproducible from stored
 * inputs: the listing's first `model_mids` row (mid in ln USD) and σ_tier
 * from params.json.
 *
 * Rule: the implied distribution is the lognormal at the mid with σ_tier
 * (engine/distribution.ts). Its 1st and 99th percentiles bound the ladder;
 * the edges are the universal valuation grid's boundaries (half-octave
 * steps, engine/buckets.ts) strictly inside those bounds, in the question's
 * unit and rounded to three significant figures. Below one boundary inside,
 * the two boundaries bracketing the mid are used instead. The unit is USD_T
 * from a $1T mid up, USD_B below.
 */

export const QUESTION_LADDER_VERSION = "grid-p1-p99-v1";

/** Φ⁻¹(0.99): the 99th percentile of the standard normal. */
const Z_99 = 2.3263478740408408;

const UNIT_SCALE = { USD_B: 1e9, USD_T: 1e12 } as const;
export type LadderUnit = keyof typeof UNIT_SCALE;

export interface QuestionLadder {
  readonly version: string;
  readonly unit: LadderUnit;
  /** Interior edges in `unit`, strictly increasing. */
  readonly edges: readonly number[];
  readonly lowerUsd: number;
  readonly upperUsd: number;
}

function threeFigures(value: number): number {
  return Number(value.toPrecision(3));
}

export function forwardQuestionLadder(
  midLn: number,
  sigma: number,
  boundariesUsd: readonly number[] = VALUATION_BOUNDARIES_USD,
): QuestionLadder {
  if (!Number.isFinite(midLn)) throw new RangeError("midLn must be finite");
  if (!Number.isFinite(sigma) || sigma <= 0) throw new RangeError("sigma must be positive");
  const midUsd = Math.exp(midLn);
  const lowerUsd = Math.exp(midLn - Z_99 * sigma);
  const upperUsd = Math.exp(midLn + Z_99 * sigma);
  let inside = boundariesUsd.filter((boundary) => boundary > lowerUsd && boundary < upperUsd);
  if (inside.length === 0) {
    const below = boundariesUsd.filter((boundary) => boundary <= midUsd).at(-1);
    const above = boundariesUsd.find((boundary) => boundary > midUsd);
    inside = [below, above].filter((boundary) => boundary !== undefined);
  }
  if (inside.length === 0) throw new RangeError("no grid boundary near the mid");
  const unit: LadderUnit = midUsd >= 1e12 ? "USD_T" : "USD_B";
  const edges = inside.map((boundary) => threeFigures(boundary / UNIT_SCALE[unit]));
  return { version: QUESTION_LADDER_VERSION, unit, edges, lowerUsd, upperUsd };
}

/** A post-money in USD as a value in the question's unit. */
export function inLadderUnit(valueUsd: number, unit: LadderUnit): number {
  return valueUsd / UNIT_SCALE[unit];
}
