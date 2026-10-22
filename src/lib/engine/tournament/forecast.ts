/** Stored forecasts carry this many decimal places; it is also the canonical hash form. */
export const FORECAST_DECIMALS = 10;

/**
 * A level at or above this prints in exponent notation under `toFixed`, which
 * the canonical form does not admit.
 */
const MAX_FORECAST_LEVEL = 1e15;

/** Prefixes a forward's payload; legacy and binary payloads are digits, `.` and `,` only. */
const FORWARD_PAYLOAD_PREFIX = "fwd:";

export type ForecastKind = "binary" | "forward";

export class ForecastError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "ForecastError";
  }
}

function atStoredPrecision(value: number): number {
  return Number(value.toFixed(FORECAST_DECIMALS));
}

/** A binary's P(YES) at stored precision; throws unless it lies strictly inside (0, 1) there. */
function normalizeProbability(p: number): number {
  if (!Number.isFinite(p)) throw new ForecastError("A probability must be a finite number.");
  const rounded = atStoredPrecision(p);
  if (!(rounded > 0 && rounded < 1)) {
    throw new ForecastError("A probability must lie strictly between 0 and 1.");
  }
  return rounded;
}

/** A forward's level at stored precision; throws unless it is positive there. */
function normalizeLevel(value: number): number {
  if (!Number.isFinite(value)) throw new ForecastError("A level must be a finite number.");
  if (value >= MAX_FORECAST_LEVEL) throw new ForecastError("That level is out of range.");
  const rounded = atStoredPrecision(value);
  if (!(rounded > 0)) throw new ForecastError("A level must be greater than 0.");
  return rounded;
}

/** What a forecaster submits: by the question's kind, one probability or one level. */
export type ForecastValue = { readonly p: number } | { readonly value: number };

/** A stored forecast: exactly one of `p` and `value` is set. */
export interface ForecastPoint {
  readonly p: number | null;
  readonly value: number | null;
}

/** Validates a submission against the question's kind and returns it at stored precision. */
export function normalizeForecast(input: ForecastValue, kind: ForecastKind): ForecastPoint {
  if (kind === "binary") {
    if (!("p" in input)) throw new ForecastError("A binary forecast is one probability, p.");
    return { p: normalizeProbability(input.p), value: null };
  }
  if (!("value" in input)) throw new ForecastError("A forward forecast is one level, value.");
  return { p: null, value: normalizeLevel(input.value) };
}

/** Fixed-precision decimals joined by commas: the provenance hash input for a vector. */
function canonicalProbs(probs: readonly number[]): string {
  return probs.map((probability) => probability.toFixed(FORECAST_DECIMALS)).join(",");
}

/** A forecast event as hashed: `p`, `value`, or (legacy) the archived vector. */
export interface CanonicalForecastInput {
  readonly p: number | null;
  readonly value: number | null;
  /** A pre-013 event's bucket vector; null for every event since. */
  readonly archivedProbs?: readonly number[] | null;
}

/**
 * The event's payload in the provenance hash (decision 0004 → Event hash),
 * chosen by which column is set, never by the question's kind:
 * - binary: `canonicalProbs([p, 1 − p])`, byte for byte the pre-013 binary payload;
 * - forward: `"fwd:" + x.toFixed(10)`;
 * - legacy: `canonicalProbs(archived probs)`.
 */
export function forecastCanonical(event: CanonicalForecastInput): string {
  const { p, value } = event;
  const archived = event.archivedProbs ?? null;
  const set = [p, value, archived].filter((field) => field !== null).length;
  if (set !== 1) {
    throw new ForecastError(
      "A forecast event carries exactly one of p, value or an archived vector.",
    );
  }
  if (p !== null) {
    const rounded = atStoredPrecision(p);
    return canonicalProbs([rounded, 1 - rounded]);
  }
  if (value !== null) return `${FORWARD_PAYLOAD_PREFIX}${value.toFixed(FORECAST_DECIMALS)}`;
  return canonicalProbs(archived!);
}
