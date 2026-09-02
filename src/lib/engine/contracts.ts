import type { ContractSide, TradeAction } from "./types.js";

function assertBucketCount(bucketCount: number): void {
  if (!Number.isInteger(bucketCount) || bucketCount < 2) {
    throw new RangeError("bucketCount must be an integer of at least 2");
  }
}

function assertStrikeIndex(bucketCount: number, strikeIndex: number): void {
  if (!Number.isInteger(strikeIndex) || strikeIndex < 0 || strikeIndex >= bucketCount - 1) {
    throw new RangeError(`strikeIndex must be an integer from 0 to ${bucketCount - 2}`);
  }
}

function assertSide(side: ContractSide): void {
  if (side !== "yes" && side !== "no") {
    throw new RangeError('side must be "yes" or "no"');
  }
}

function assertAction(action: TradeAction): void {
  if (action !== "buy" && action !== "sell") {
    throw new RangeError('action must be "buy" or "sell"');
  }
}

/** Builds the suffix (YES) or prefix (NO) claim mask at a strike. */
export function contractMask(
  bucketCount: number,
  strikeIndex: number,
  side: ContractSide,
): boolean[] {
  assertBucketCount(bucketCount);
  assertStrikeIndex(bucketCount, strikeIndex);
  assertSide(side);

  return Array.from({ length: bucketCount }, (_, bucketIndex) =>
    side === "yes" ? bucketIndex > strikeIndex : bucketIndex <= strikeIndex,
  );
}

/** Builds the market-state and holdings delta for a contract trade. */
export function contractDelta(
  bucketCount: number,
  strikeIndex: number,
  side: ContractSide,
  action: TradeAction,
  quantity: number,
): number[] {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new RangeError("quantity must be finite and greater than zero");
  }
  assertAction(action);

  const mask = contractMask(bucketCount, strikeIndex, side);
  const signedQuantity = action === "buy" ? quantity : -quantity;
  return mask.map((included) => (included ? signedQuantity : 0));
}

/** Returns the greatest quantity removable from every outcome in a mask. */
export function sellableQuantity(holdings: readonly number[], mask: readonly boolean[]): number {
  if (!Array.isArray(holdings) || !Array.isArray(mask)) {
    throw new RangeError("holdings and mask must be arrays");
  }
  if (holdings.length === 0 || holdings.length !== mask.length) {
    throw new RangeError("holdings and mask must have the same non-zero length");
  }

  let minimum = Number.POSITIVE_INFINITY;
  let includesOutcome = false;

  for (let index = 0; index < holdings.length; index += 1) {
    const holding = holdings[index]!;
    const included = mask[index]!;

    if (!Number.isFinite(holding) || holding < 0) {
      throw new RangeError("holdings must contain finite, non-negative values");
    }
    if (typeof included !== "boolean") {
      throw new RangeError("mask must contain only boolean values");
    }
    if (included) {
      includesOutcome = true;
      minimum = Math.min(minimum, holding);
    }
  }

  if (!includesOutcome) {
    throw new RangeError("mask must include at least one outcome");
  }

  return minimum;
}
