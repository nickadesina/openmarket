/**
 * Tournament buckets. A question is a discrete distribution over n buckets.
 * Range buckets tile the real line (lower inclusive, upper exclusive; the
 * first has no lower bound, the last no upper bound). A numeric question
 * carries exactly one floor bucket, "no qualifying event by expiry", which
 * has no bounds and sits last. A binary is two unbounded range buckets,
 * Yes then No, and no floor.
 */

export type BucketKind = "range" | "floor";

export interface Bucket {
  readonly index: number;
  readonly kind: BucketKind;
  readonly lower: number | null;
  readonly upper: number | null;
  readonly label: string;
}

export const BINARY_LABELS = ["Yes", "No"] as const;

/** Index of the Yes bucket on a binary question. */
export const BINARY_YES_INDEX = 0;

export class BucketError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "BucketError";
  }
}

function formatEdge(value: number): string {
  // Edges are typed by hand (66, 0.95); print them back the same way.
  return String(value);
}

/** Display label generated from bounds: `<66`, `66–70`, `>94`. */
export function rangeLabel(lower: number | null, upper: number | null): string {
  if (lower === null && upper === null) return "Any";
  if (lower === null) return `<${formatEdge(upper!)}`;
  if (upper === null) return `>${formatEdge(lower)}`;
  return `${formatEdge(lower)}–${formatEdge(upper)}`;
}

export interface NumericBucketInput {
  /** Interior edges, strictly increasing; n − 1 edges make n range buckets. */
  readonly edges: readonly number[];
  readonly floorLabel: string;
  /** Optional label overrides by range-bucket index. */
  readonly labels?: readonly (string | null)[];
}

export function numericBuckets(input: NumericBucketInput): Bucket[] {
  const { edges, floorLabel } = input;
  if (edges.length < 1) {
    throw new BucketError("A numeric question needs at least one edge.");
  }
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index]!;
    if (!Number.isFinite(edge)) throw new BucketError("Edges must be finite numbers.");
    if (index > 0 && edge <= edges[index - 1]!) {
      throw new BucketError("Edges must be strictly increasing.");
    }
  }
  if (floorLabel.trim().length === 0) {
    throw new BucketError("The floor bucket needs a label.");
  }

  const buckets: Bucket[] = [];
  for (let index = 0; index <= edges.length; index += 1) {
    const lower = index === 0 ? null : edges[index - 1]!;
    const upper = index === edges.length ? null : edges[index]!;
    const override = input.labels?.[index];
    buckets.push({
      index,
      kind: "range",
      lower,
      upper,
      label: override === undefined || override === null ? rangeLabel(lower, upper) : override,
    });
  }
  buckets.push({
    index: buckets.length,
    kind: "floor",
    lower: null,
    upper: null,
    label: floorLabel.trim(),
  });
  return buckets;
}

export function binaryBuckets(): Bucket[] {
  return BINARY_LABELS.map((label, index) => ({
    index,
    kind: "range",
    lower: null,
    upper: null,
    label,
  }));
}

/** Throws unless the buckets satisfy the tiling and floor rules for their question type. */
export function assertValidBuckets(buckets: readonly Bucket[], binary: boolean): void {
  buckets.forEach((bucket, position) => {
    if (bucket.index !== position) throw new BucketError("Bucket indexes must run 0..n−1.");
  });

  if (binary) {
    if (
      buckets.length !== 2 ||
      buckets.some((bucket) => bucket.kind !== "range" || bucket.lower !== null) ||
      buckets.some((bucket) => bucket.upper !== null)
    ) {
      throw new BucketError("A binary has exactly two unbounded range buckets and no floor.");
    }
    return;
  }

  const floors = buckets.filter((bucket) => bucket.kind === "floor");
  if (floors.length !== 1) throw new BucketError("A numeric question has exactly one floor.");
  const floor = floors[0]!;
  if (floor.lower !== null || floor.upper !== null) {
    throw new BucketError("The floor bucket has no bounds.");
  }
  const ranges = buckets.filter((bucket) => bucket.kind === "range");
  if (ranges.length < 2) throw new BucketError("A numeric question needs two range buckets.");
  if (ranges[0]!.lower !== null || ranges[ranges.length - 1]!.upper !== null) {
    throw new BucketError("Range buckets must tile the real line.");
  }
  for (let index = 1; index < ranges.length; index += 1) {
    const previous = ranges[index - 1]!;
    const current = ranges[index]!;
    if (previous.upper === null || current.lower !== previous.upper) {
      throw new BucketError("Adjacent range buckets must share an edge.");
    }
    if (current.upper !== null && current.upper <= current.lower!) {
      throw new BucketError("Edges must be strictly increasing.");
    }
  }
}

export function floorIndex(buckets: readonly Bucket[]): number | null {
  const floor = buckets.find((bucket) => bucket.kind === "floor");
  return floor === undefined ? null : floor.index;
}

/** The range bucket holding `value`: lower inclusive, upper exclusive. */
export function bucketIndexForValue(buckets: readonly Bucket[], value: number): number {
  if (!Number.isFinite(value)) throw new BucketError("Resolved value must be finite.");
  for (const bucket of buckets) {
    if (bucket.kind !== "range") continue;
    const aboveLower = bucket.lower === null || value >= bucket.lower;
    const belowUpper = bucket.upper === null || value < bucket.upper;
    if (aboveLower && belowUpper) return bucket.index;
  }
  throw new BucketError("Resolved value falls in no range bucket.");
}
