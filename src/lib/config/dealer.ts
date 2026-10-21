import { z } from "zod";

import params from "../../../backtest/out/params.json";

/**
 * The dealer's parameters, as the backtest wrote them (README D12). Nothing in
 * this file sets a number: `tests/config/dealer-params.test.ts` fails if
 * params.json is stale against the backtest, edited without a version bump,
 * or overridden here.
 *
 * MODEL_VERSION is semver for the prior's formulas and these parameters
 * together; bump it whenever either changes, and re-pin PARAMS_SHA256.
 */
export const MODEL_VERSION = "1.0.0";
export const PARAMS_SHA256 = "7a6184140713f3f2fe0dc5668c205864d1060acffb2619fe216805946b4b8657";
export const PARAMS_SOURCE = "backtest/out/params.json";

const tierSchema = z.object({ mega: z.number().finite(), redhot: z.number().finite() }).strict();
const positive = z.number().finite().positive();

const paramsSchema = z
  .object({
    data_through: z.iso.date(),
    inputs_sha256: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/)),
    tier: z.object({ mega_threshold_usd: positive }).strict(),
    prior: z
      .object({
        mu_stepup: z.record(z.string(), tierSchema),
        mu_stepup_fallback: tierSchema,
        cadence_months: tierSchema,
        weibull_k: positive,
        days_per_month: positive,
        leak_hazard_near: z.number().gt(0).lt(1),
        leak_hazard_far: z.number().gt(0).lt(1),
        leak_window_days: z.number().int().positive(),
      })
      .strict(),
    sigma_tier: tierSchema,
    dealer: z
      .object({
        kappa: positive,
        cap_usd: positive,
        b_usd: positive,
        s_floor: positive,
        gamma: z.number().finite().nonnegative(),
        p_floor: z.number().gt(0).lt(0.5),
        flag_spread_mult: positive,
        flag_cap_mult: positive,
        flag_hours: z.number().int().positive(),
      })
      .strict(),
    forward_t_days: z.record(z.string(), z.number().int().positive()),
  })
  .strict();

export type DealerParams = z.infer<typeof paramsSchema>;

export const DEALER_PARAMS: DealerParams = paramsSchema.parse(params);
