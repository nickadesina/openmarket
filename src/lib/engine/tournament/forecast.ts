/** Tolerance on a submitted vector's sum before the server renormalizes it. */
export const FORECAST_SUM_TOLERANCE = 1e-6;

/** Stored probabilities carry this many decimal places; it is also the canonical hash form. */
export const FORECAST_DECIMALS = 10;

export class ForecastError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "ForecastError";
  }
}

/**
 * Validates a submitted vector against the bucket count and returns the
 * renormalized vector at stored precision: every entry ≥ 0 and the sum
 * within 1e-6 of 1.
 */
export function normalizeForecast(probs: readonly number[], bucketCount: number): number[] {
  if (probs.length !== bucketCount) {
    throw new ForecastError(`A forecast needs exactly ${bucketCount} probabilities.`);
  }
  let sum = 0;
  for (const probability of probs) {
    if (!Number.isFinite(probability) || probability < 0) {
      throw new ForecastError("Every probability must be a finite number of at least 0.");
    }
    sum += probability;
  }
  if (Math.abs(sum - 1) > FORECAST_SUM_TOLERANCE) {
    throw new ForecastError("Probabilities must sum to 1.");
  }
  const scale = 10 ** FORECAST_DECIMALS;
  return probs.map((probability) => Math.round((probability / sum) * scale) / scale);
}

/** Fixed-precision decimals joined by commas: the provenance hash input for a vector. */
export function canonicalProbs(probs: readonly number[]): string {
  return probs.map((probability) => probability.toFixed(FORECAST_DECIMALS)).join(",");
}
