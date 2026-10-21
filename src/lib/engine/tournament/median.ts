import type { Bucket } from "./buckets.js";

export interface BucketMedian {
  readonly value: number;
  /**
   * "within" when interpolated inside a bounded bucket; "below" or "above"
   * when the crossing falls in an open-ended end bucket, whose inner edge is
   * reported and never interpolated past.
   */
  readonly position: "within" | "below" | "above";
}

/**
 * The value at which cumulative probability over the range buckets (floor
 * excluded, mass renormalized) crosses 0.5, interpolated log-linearly inside
 * the crossing bucket. Null when the range buckets carry no mass or the
 * question is a binary.
 */
export function bucketMedian(
  buckets: readonly Bucket[],
  probs: readonly number[],
): BucketMedian | null {
  if (probs.length !== buckets.length) throw new RangeError("probs must match the buckets");
  const ranges = buckets.filter((bucket) => bucket.kind === "range");
  if (
    ranges.length < 2 ||
    ranges.every((bucket) => bucket.lower === null && bucket.upper === null)
  ) {
    return null;
  }
  const rangeMass = ranges.reduce((sum, bucket) => sum + probs[bucket.index]!, 0);
  if (!(rangeMass > 0)) return null;

  let cumulative = 0;
  for (const bucket of ranges) {
    const mass = probs[bucket.index]! / rangeMass;
    if (cumulative + mass < 0.5 || mass === 0) {
      cumulative += mass;
      continue;
    }
    if (bucket.lower === null) return { value: bucket.upper!, position: "below" };
    if (bucket.upper === null) return { value: bucket.lower, position: "above" };
    const fraction = (0.5 - cumulative) / mass;
    const { lower, upper } = bucket;
    const value =
      lower > 0
        ? Math.exp(Math.log(lower) + fraction * (Math.log(upper) - Math.log(lower)))
        : lower + fraction * (upper - lower);
    return { value, position: "within" };
  }
  // Floating-point shortfall: the crossing is the last bucket's inner edge.
  const last = ranges[ranges.length - 1]!;
  return { value: last.lower!, position: "above" };
}
