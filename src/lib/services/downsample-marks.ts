export interface DownsampleMarkPoint {
  readonly timestamp: string;
  readonly marketSequence: string;
  readonly value: number;
}

/** Epoch milliseconds bounding the range the points were read from. */
export interface DownsampleWindow {
  readonly start: number;
  readonly end: number;
}

function orderedTimestamp(point: DownsampleMarkPoint, index: number): number {
  const timestamp = Date.parse(point.timestamp);
  if (!Number.isFinite(timestamp)) {
    throw new RangeError(`points[${index}].timestamp must be an ISO timestamp`);
  }
  if (!Number.isFinite(point.value) || point.value < 0) {
    throw new RangeError(`points[${index}].value must be finite and non-negative`);
  }
  if (!/^\d+$/.test(point.marketSequence)) {
    throw new RangeError(`points[${index}].marketSequence must be a non-negative integer string`);
  }
  return timestamp;
}

function copyPoint<T extends DownsampleMarkPoint>(point: T): T {
  return { ...point };
}

/**
 * Reduces a mark series to at most `maxPoints` while preserving the first and
 * last observations and, in every occupied time bucket, the lowest and highest
 * values in their original order. Buckets divide the window itself rather than
 * the data extent, so a new print at the edge does not re-bucket the interior.
 * Reverted spikes survive: a bucket's extreme is kept whichever print set it.
 * The caller's array and points are untouched.
 */
export function downsampleMarks<T extends DownsampleMarkPoint>(
  points: readonly T[],
  maxPoints: number,
  window: DownsampleWindow,
): T[] {
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 2) {
    throw new RangeError("maxPoints must be an integer of at least 2");
  }
  if (!Number.isFinite(window.start) || !Number.isFinite(window.end) || window.end < window.start) {
    throw new RangeError("window must be a finite, non-decreasing epoch range");
  }

  const timestamps = new Array<number>(points.length);
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  let previousSequence = -1n;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    const timestamp = orderedTimestamp(point, index);
    const sequence = BigInt(point.marketSequence);
    if (
      timestamp < previousTimestamp ||
      (timestamp === previousTimestamp && sequence < previousSequence)
    ) {
      throw new RangeError("points must be ordered by timestamp and then market sequence");
    }
    timestamps[index] = timestamp;
    previousTimestamp = timestamp;
    previousSequence = sequence;
  }

  if (points.length <= maxPoints) {
    return points.map(copyPoint);
  }
  const lastIndex = points.length - 1;
  if (maxPoints < 4) {
    return [copyPoint(points[0]!), copyPoint(points[lastIndex]!)];
  }

  // Two survivors per bucket plus the two endpoints never exceed maxPoints.
  const bucketCount = Math.floor((maxPoints - 2) / 2);
  const span = window.end - window.start;
  const lowByBucket = new Map<number, number>();
  const highByBucket = new Map<number, number>();

  for (let index = 1; index < lastIndex; index += 1) {
    const bucket =
      span === 0
        ? 0
        : Math.min(
            bucketCount - 1,
            Math.max(0, Math.floor(((timestamps[index]! - window.start) * bucketCount) / span)),
          );
    const value = points[index]!.value;
    const low = lowByBucket.get(bucket);
    if (low === undefined || value < points[low]!.value) lowByBucket.set(bucket, index);
    const high = highByBucket.get(bucket);
    // `<=` keeps the later print on ties so a flat bucket still ends where it ended.
    if (high === undefined || points[high]!.value <= value) highByBucket.set(bucket, index);
  }

  const survivors = new Set<number>([0, lastIndex]);
  for (const index of lowByBucket.values()) survivors.add(index);
  for (const index of highByBucket.values()) survivors.add(index);
  return [...survivors]
    .sort((left, right) => left - right)
    .map((index) => copyPoint(points[index]!));
}
