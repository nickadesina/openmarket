/**
 * The quarterly timing binary on the existing LMSR (CONTRACTS.md → Contract
 * A, README D12): two outcomes, NO at index 0 and YES at index 1 as
 * seedBinaryMarket lays them out, seeded once per quarter at the model p with
 * a fixed b and never re-centred or re-scaled mid-quarter. The only rule the
 * binary adds to lmsr.ts is the price clamp [p_floor, 1 − p_floor].
 */
import { probabilities } from "../lmsr.js";
import { seedBinaryMarket } from "../seed.js";

export const BINARY_NO_INDEX = 0;
export const BINARY_YES_INDEX = 1;

export interface SeededBinary {
  /** LMSR quantities, [NO, YES]. */
  readonly q: readonly [number, number];
  /** [P(NO), P(YES)] at the seed. */
  readonly probabilities: readonly [number, number];
  readonly yesProbability: number;
}

export type BinaryClampCheck =
  | { readonly ok: true; readonly yesProbabilityAfter: number }
  | {
      readonly ok: false;
      readonly reason: "below_floor" | "above_ceiling";
      readonly yesProbabilityAfter: number;
    };

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

function assertPFloor(pFloor: number): void {
  assertFinite(pFloor, "pFloor");
  if (pFloor <= 0 || pFloor >= 0.5) {
    throw new RangeError("pFloor must be strictly between zero and one half");
  }
}

function assertProbability(value: number, name: string): void {
  assertFinite(value, name);
  if (value <= 0 || value >= 1) {
    throw new RangeError(`${name} must be strictly between zero and one`);
  }
}

function assertTwoOutcomes(vector: readonly number[], name: string): void {
  if (vector.length !== 2) {
    throw new RangeError(`${name} must have exactly two outcomes`);
  }
}

/** Seeds the binary's LMSR so P(YES) = p at liquidity b (USD). */
export function seedBinary(p: number, bUsd: number): SeededBinary {
  const seeded = seedBinaryMarket(p, bUsd);
  return {
    q: [seeded.q[BINARY_NO_INDEX]!, seeded.q[BINARY_YES_INDEX]!],
    probabilities: [
      seeded.probabilities[BINARY_NO_INDEX]!,
      seeded.probabilities[BINARY_YES_INDEX]!,
    ],
    yesProbability: seeded.currentMetric,
  };
}

/** Whether a YES price sits inside [p_floor, 1 − p_floor], edges included. */
export function withinClamp(yesProbability: number, pFloor: number): boolean {
  assertFinite(yesProbability, "yesProbability");
  assertPFloor(pFloor);
  return yesProbability >= pFloor && yesProbability <= 1 - pFloor;
}

/**
 * Whether a trade `delta` on state `q` keeps the YES price inside the clamp.
 * A trade that would leave [p_floor, 1 − p_floor] is refused whole, whichever
 * side it buys or sells.
 */
export function checkBinaryClamp(
  q: readonly number[],
  delta: readonly number[],
  bUsd: number,
  pFloor: number,
): BinaryClampCheck {
  assertTwoOutcomes(q, "q");
  assertTwoOutcomes(delta, "delta");
  assertPFloor(pFloor);
  const after = q.map((value, index) => {
    const shift = delta[index]!;
    assertFinite(shift, `delta[${index}]`);
    return value + shift;
  });
  const yesProbabilityAfter = probabilities(after, bUsd)[BINARY_YES_INDEX]!;
  if (yesProbabilityAfter < pFloor) {
    return { ok: false, reason: "below_floor", yesProbabilityAfter };
  }
  if (yesProbabilityAfter > 1 - pFloor) {
    return { ok: false, reason: "above_ceiling", yesProbabilityAfter };
  }
  return { ok: true, yesProbabilityAfter };
}

/**
 * The published worst-case house loss per binary quarter, b·ln(1/p_floor)
 * (CONTRACTS.md → Contract A): ≈ $5,991 at b = $2,000, p_floor = 0.05.
 */
export function binaryLossBoundUsd(bUsd: number, pFloor: number): number {
  assertPositive(bUsd, "bUsd");
  assertPFloor(pFloor);
  return bUsd * Math.log(1 / pFloor);
}

/**
 * The unclamped LMSR bound from a seed, b·ln(1/min(p0, 1 − p0)): what the
 * house could lose if prices ran to 0 or 1. Equals b·ln 2 only from 50/50.
 */
export function seedLossBoundUsd(bUsd: number, p0: number): number {
  assertPositive(bUsd, "bUsd");
  assertProbability(p0, "p0");
  return bUsd * Math.log(1 / Math.min(p0, 1 - p0));
}

/**
 * The exact worst case under the clamp. The house's loss if outcome i wins is
 * b·ln(p_i,final / p_i,seed); the clamp caps p_i,final at 1 − p_floor, so the
 * loss is at most b·ln((1 − p_floor) / min(p0, 1 − p0)). For a seed inside the
 * clamp this never exceeds binaryLossBoundUsd.
 */
export function clampedLossBoundUsd(bUsd: number, p0: number, pFloor: number): number {
  assertPositive(bUsd, "bUsd");
  assertProbability(p0, "p0");
  assertPFloor(pFloor);
  return bUsd * Math.log((1 - pFloor) / Math.min(p0, 1 - p0));
}
