import { z } from "zod";

import params from "../../../backtest/out/params.json";

/**
 * The dealer's parameters, as the backtest wrote them (README D12). Nothing in
 * this file sets a number: `tests/config/dealer-params.test.ts` fails if
 * params.json is stale against the backtest, edited without a version bump,
 * or overridden here.
 *
 * MODEL_VERSION is semver for the prior's formulas and these parameters
 * together. A rerun that changes params.json adds a new version here with the
 * file's digest; published versions keep theirs, so model_version on any
 * stored mid names the parameters that produced it.
 */
export const PARAMS_SHA256_BY_MODEL_VERSION: Readonly<Record<string, string>> = {
  "1.0.0": "594d29a5a7bcfa216d7acd18ebdf0dd777bb667bd835f7383928252873c23074",
};
export const MODEL_VERSION = Object.keys(PARAMS_SHA256_BY_MODEL_VERSION).at(-1)!;

const tierSchema = z.object({ mega: z.number().finite(), redhot: z.number().finite() }).strict();
const positive = z.number().finite().positive();
const positiveTierSchema = z.object({ mega: positive, redhot: positive }).strict();

const paramsSchema = z
  .object({
    data_through: z.iso.date(),
    inputs_sha256: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/)),
    tier: z.object({ mega_threshold_usd: positive }).strict(),
    prior: z
      .object({
        mu_stepup: z.record(z.string(), tierSchema),
        mu_stepup_fallback: tierSchema,
        cadence_months: positiveTierSchema,
        weibull_k: positive,
        days_per_month: positive,
        leak_hazard_near: z.number().gt(0).lt(1),
        leak_hazard_far: z.number().gt(0).lt(1),
        leak_window_days: z.number().int().positive(),
      })
      .strict(),
    sigma_tier: positiveTierSchema,
    dealer: z
      .object({
        kappa: positive,
        cap_usd: positive,
        b_usd: positive,
        s_floor: positive,
        gamma: z.number().finite().nonnegative(),
        p_floor: z.number().gt(0).lt(0.5),
        flag_spread_mult: positive,
        flag_cap_mult: positive.max(1),
        flag_hours: z.number().int().positive(),
      })
      .strict(),
    forward_t_days: z.record(z.string(), z.number().int().positive()),
    contract: z.object({ binary_min_days: z.number().int().positive() }).strict(),
  })
  .strict()
  .refine(
    (value) => sameKeys(value.forward_t_days, value.prior.mu_stepup),
    "forward_t_days and prior.mu_stepup must name the same listed companies",
  );

function sameKeys(left: object, right: object): boolean {
  const a = Object.keys(left).sort();
  const b = Object.keys(right).sort();
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

export type DealerParams = z.infer<typeof paramsSchema>;

export const DEALER_PARAMS: DealerParams = paramsSchema.parse(params);
