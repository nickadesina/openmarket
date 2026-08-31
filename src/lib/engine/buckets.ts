export const VALUATION_GRID_VERSION = "valuation-v1" as const;

const FIRST_BOUNDARY_EXPONENT = -32;
const LAST_BOUNDARY_EXPONENT = 7;
const GRID_ANCHOR_USD = 1_000_000_000_000;

export const VALUATION_BOUNDARIES_USD: readonly number[] = Object.freeze(
  Array.from(
    { length: LAST_BOUNDARY_EXPONENT - FIRST_BOUNDARY_EXPONENT + 1 },
    (_, index) =>
      GRID_ANCHOR_USD * 2 ** ((FIRST_BOUNDARY_EXPONENT + index) / 2),
  ),
);

export const VALUATION_BUCKET_COUNT = VALUATION_BOUNDARIES_USD.length + 1;

function assertBucketIndex(bucketIndex: number): void {
  if (
    !Number.isInteger(bucketIndex) ||
    bucketIndex < 0 ||
    bucketIndex >= VALUATION_BUCKET_COUNT
  ) {
    throw new RangeError(
      `bucketIndex must be an integer from 0 to ${VALUATION_BUCKET_COUNT - 1}`,
    );
  }
}

/** Returns finite lower and upper interpolation edges for a valuation bucket. */
export function valuationBucketEdges(bucketIndex: number): {
  lower: number;
  upper: number;
} {
  assertBucketIndex(bucketIndex);

  const lower =
    bucketIndex === 0
      ? GRID_ANCHOR_USD * 2 ** ((FIRST_BOUNDARY_EXPONENT - 1) / 2)
      : VALUATION_BOUNDARIES_USD[bucketIndex - 1]!;
  const upper =
    bucketIndex === VALUATION_BUCKET_COUNT - 1
      ? GRID_ANCHOR_USD * 2 ** ((LAST_BOUNDARY_EXPONENT + 1) / 2)
      : VALUATION_BOUNDARIES_USD[bucketIndex]!;

  return { lower, upper };
}

/** Maps a non-negative valuation to its canonical bucket. Boundaries are inclusive. */
export function valuationBucketIndex(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("value must be a finite, non-negative valuation");
  }

  let low = 0;
  let high = VALUATION_BOUNDARIES_USD.length;

  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (value <= VALUATION_BOUNDARIES_USD[middle]!) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  return low;
}
