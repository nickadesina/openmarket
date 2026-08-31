export interface DownsampleMarkPoint {
  readonly timestamp: string;
  readonly marketSequence: string;
  readonly value: number;
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
    throw new RangeError(
      `points[${index}].marketSequence must be a non-negative integer string`,
    );
  }
  return timestamp;
}

function copyPoint<T extends DownsampleMarkPoint>(point: T): T {
  return { ...point };
}

/**
 * Selects the final ordered observation in each time bucket while preserving
 * the first and last observations. The caller's array and points are untouched.
 */
export function downsampleMarks<T extends DownsampleMarkPoint>(
  points: readonly T[],
  maxPoints: number,
): T[] {
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 2) {
    throw new RangeError("maxPoints must be an integer of at least 2");
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
      throw new RangeError(
        "points must be ordered by timestamp and then market sequence",
      );
    }
    timestamps[index] = timestamp;
    previousTimestamp = timestamp;
    previousSequence = sequence;
  }

  if (points.length <= maxPoints) {
    return points.map(copyPoint);
  }
  if (maxPoints === 2) {
    return [copyPoint(points[0]!), copyPoint(points[points.length - 1]!)];
  }

  const firstTimestamp = timestamps[0]!;
  const lastTimestamp = timestamps[timestamps.length - 1]!;
  const bucketCount = maxPoints - 2;
  const span = lastTimestamp - firstTimestamp;
  const finalByBucket = new Map<number, T>();

  for (let index = 1; index < points.length - 1; index += 1) {
    const bucket =
      span === 0
        ? 0
        : Math.min(
            bucketCount - 1,
            Math.floor(((timestamps[index]! - firstTimestamp) * bucketCount) / span),
          );
    finalByBucket.set(bucket, points[index]!);
  }

  return [
    copyPoint(points[0]!),
    ...[...finalByBucket.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, point]) => copyPoint(point)),
    copyPoint(points[points.length - 1]!),
  ];
}
