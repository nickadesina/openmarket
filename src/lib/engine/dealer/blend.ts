import { assertFinite, assertNonNegative } from "../assert.js";
/**
 * The published reference price (README D14, TECHNICAL_DESIGN.md §8): a
 * pre-committed blend of the model mid, the 30-day traded price on the
 * instrument's own book, and the tournament crowd.
 *
 *     R   = w_m·m + w_t·p̄_traded + w_c·p̄_crowd
 *     w_t = min(0.6, V₃₀ / (V₃₀ + V₀))              V₀ = $50,000
 *     w_c = min(0.3, n / (n + n₀)) · [n ≥ N_min]    n₀ = 20, N_min = 10
 *     w_m = 1 − w_t − w_c
 *
 * m is the latest `model_mids` value, not the dealer's inventory-skewed
 * quote mid, so the house's own book never moves the reference (its sign is
 * published beside it instead). A forward blends in ln USD (the crowd's
 * median enters as its log); a binary blends probabilities.
 *
 * The constants below are policy, not backtest parameters: they are the
 * published schedule, versioned by BLEND_VERSION, and every payload that
 * carries a reference carries them. Changing one, or what an input means,
 * is a new BLEND_VERSION; stored rows keep the version that produced them,
 * and a published schedule is never edited.
 *
 * History:
 * - 1.0.0: the crowd is the linked question's bucket aggregate: P(YES) for
 *   a binary, the median read off the bucket vector for a forward.
 * - 1.1.0 (decision 0004): the same constants; the crowd is the linked
 *   question's one-number aggregate: the pooled P(YES) for a binary, the
 *   median of the forecasters' levels for a forward.
 */
export const BLEND_VERSION = "1.1.0";

export interface BlendSchedule {
  readonly version: string;
  readonly traded: {
    /** Cap on w_t. */
    readonly max_weight: number;
    /** V₀: the volume at which traded flow would earn half the weight, USD. */
    readonly v0_usd: number;
    /** The trailing window traded flow is averaged over. */
    readonly window_days: number;
  };
  readonly crowd: {
    /** Cap on w_c. */
    readonly max_weight: number;
    /** n₀: the forecaster count at which the crowd would earn half the weight. */
    readonly n0: number;
    /** N_min: below this many forecasters the crowd carries no weight. */
    readonly n_min: number;
  };
}

export const BLEND_SCHEDULE: BlendSchedule = Object.freeze({
  version: BLEND_VERSION,
  traded: Object.freeze({ max_weight: 0.6, v0_usd: 50_000, window_days: 30 }),
  crowd: Object.freeze({ max_weight: 0.3, n0: 20, n_min: 10 }),
});

/** Every schedule ever published, so a stored row recomputes under its own version. */
export const BLEND_SCHEDULES_BY_VERSION: Readonly<Record<string, BlendSchedule>> = Object.freeze({
  "1.0.0": Object.freeze({
    version: "1.0.0",
    traded: Object.freeze({ max_weight: 0.6, v0_usd: 50_000, window_days: 30 }),
    crowd: Object.freeze({ max_weight: 0.3, n0: 20, n_min: 10 }),
  }),
  [BLEND_VERSION]: BLEND_SCHEDULE,
});

export type BlendKind = "forward" | "binary";

export interface BlendWeights {
  readonly model: number;
  readonly traded: number;
  readonly crowd: number;
}

export interface BlendInputs {
  readonly kind: BlendKind;
  /** m: ln USD for a forward, probability for a binary. */
  readonly model: number;
  /** p̄_traded over the window and the volume V behind it (USD); null with no trades. */
  readonly traded: { readonly value: number; readonly volumeUsd: number } | null;
  /** p̄_crowd (same unit as the model) and the forecaster count n; null with no linked aggregate. */
  readonly crowd: { readonly value: number; readonly forecasters: number } | null;
}

export interface BlendResult {
  /** R, in the model's unit. */
  readonly value: number;
  readonly weights: BlendWeights;
  /** True when R is the model mid exactly: no flow and no crowd past N_min. */
  readonly modelOnly: boolean;
}

function assertProbability(value: number, name: string, open: boolean): void {
  assertFinite(value, name);
  const outside = open ? value <= 0 || value >= 1 : value < 0 || value > 1;
  if (outside) throw new RangeError(`${name} must be a probability`);
}

/** w_t from the window's traded volume in USD. */
export function tradedWeight(volumeUsd: number, schedule: BlendSchedule = BLEND_SCHEDULE): number {
  assertNonNegative(volumeUsd, "volumeUsd");
  if (volumeUsd === 0) return 0;
  const { max_weight, v0_usd } = schedule.traded;
  return Math.min(max_weight, volumeUsd / (volumeUsd + v0_usd));
}

/** w_c from the forecaster count; zero below N_min. */
export function crowdWeight(forecasters: number, schedule: BlendSchedule = BLEND_SCHEDULE): number {
  if (!Number.isSafeInteger(forecasters) || forecasters < 0) {
    throw new RangeError("forecasters must be a non-negative integer");
  }
  const { max_weight, n0, n_min } = schedule.crowd;
  if (forecasters < n_min) return 0;
  return Math.min(max_weight, forecasters / (forecasters + n0));
}

/** The three weights; w_m takes what flow and crowd leave. */
export function blendWeights(
  volumeUsd: number,
  forecasters: number,
  schedule: BlendSchedule = BLEND_SCHEDULE,
): BlendWeights {
  const traded = tradedWeight(volumeUsd, schedule);
  const crowd = crowdWeight(forecasters, schedule);
  return { model: 1 - traded - crowd, traded, crowd };
}

function validate(inputs: BlendInputs): void {
  if (inputs.kind !== "forward" && inputs.kind !== "binary") {
    throw new RangeError('kind must be "forward" or "binary"');
  }
  const binary = inputs.kind === "binary";
  if (binary) assertProbability(inputs.model, "model", true);
  else assertFinite(inputs.model, "model");
  if (inputs.traded !== null) {
    if (binary) assertProbability(inputs.traded.value, "traded.value", false);
    else assertFinite(inputs.traded.value, "traded.value");
    assertNonNegative(inputs.traded.volumeUsd, "traded.volumeUsd");
  }
  if (inputs.crowd !== null) {
    if (binary) assertProbability(inputs.crowd.value, "crowd.value", false);
    else assertFinite(inputs.crowd.value, "crowd.value");
  }
}

/**
 * R and its weights. With no flow and no crowd past N_min, R is the model
 * mid itself, not a product that might round away from it.
 */
export function blend(inputs: BlendInputs, schedule: BlendSchedule = BLEND_SCHEDULE): BlendResult {
  validate(inputs);
  const weights = blendWeights(
    inputs.traded?.volumeUsd ?? 0,
    inputs.crowd?.forecasters ?? 0,
    schedule,
  );
  if (weights.traded === 0 && weights.crowd === 0) {
    return { value: inputs.model, weights, modelOnly: true };
  }
  const traded = weights.traded === 0 ? 0 : weights.traded * inputs.traded!.value;
  const crowd = weights.crowd === 0 ? 0 : weights.crowd * inputs.crowd!.value;
  return { value: weights.model * inputs.model + traded + crowd, weights, modelOnly: false };
}

/** The crowd's forward component: its median post-money in USD, as ln USD. */
export function crowdForwardLn(medianUsd: number): number {
  assertFinite(medianUsd, "medianUsd");
  if (medianUsd <= 0) throw new RangeError("medianUsd must be greater than zero");
  return Math.log(medianUsd);
}
