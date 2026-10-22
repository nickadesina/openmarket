/**
 * The model's prior (TECHNICAL_DESIGN.md §5): a port of backtest/sim.py's,
 * which tests/engine/dealer/prior.test.ts holds to 1e-9 against
 * backtest/out/prior_golden.json. Pure: parameters come in as arguments, in
 * the shape backtest/out/params.json gives them.
 *
 * μ is an input, not computed here: the leave-one-out median step-up is the
 * backtest's to fit and params.json's to carry. Times count whole calendar
 * days between UTC dates, as sim.py's `date` arithmetic does.
 */

import { assertDate, assertFinite, assertPositive } from "../assert.js";

import { DAY_MS, utcMidnight } from "../time.js";

export const TIERS = ["mega", "redhot"] as const;
export type Tier = (typeof TIERS)[number];

export interface TierValues {
  readonly mega: number;
  readonly redhot: number;
}

/** The hazard's half of params.json `prior`. */
export interface HazardParams {
  readonly cadence_months: TierValues;
  readonly weibull_k: number;
  readonly days_per_month: number;
  readonly leak_hazard_near: number;
  readonly leak_hazard_far: number;
  readonly leak_window_days: number;
}

/** Mega-cap at or above the threshold, red-hot below (README D10). */
export function tierOf(lastPostMoneyUsd: number, megaThresholdUsd: number): Tier {
  assertPositive(lastPostMoneyUsd, "lastPostMoneyUsd");
  assertPositive(megaThresholdUsd, "megaThresholdUsd");
  return lastPostMoneyUsd >= megaThresholdUsd ? "mega" : "redhot";
}

/** Whole UTC days from `from` to `to`; the time of day on either is ignored. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS);
}

/** Months from `from` to `to`: whole days over the backtest's days per month. */
export function monthsBetween(from: Date, to: Date, daysPerMonth: number): number {
  assertPositive(daysPerMonth, "daysPerMonth");
  return daysBetween(from, to) / daysPerMonth;
}

/** Weibull survival S(t) = exp(−(t/λ)^k), t in months since the last print, floored at 0. */
export function weibullSurvival(tMonths: number, k: number, lambdaMonths: number): number {
  assertFinite(tMonths, "tMonths");
  assertPositive(k, "k");
  assertPositive(lambdaMonths, "lambdaMonths");
  return Math.exp(-((Math.max(tMonths, 0) / lambdaMonths) ** k));
}

/** P(next round in (tNow, tEnd] | none by tNow) = 1 − S(tEnd)/S(tNow), in [0, 1]. */
export function roundProbability(
  tNowMonths: number,
  tEndMonths: number,
  k: number,
  lambdaMonths: number,
): number {
  assertFinite(tEndMonths, "tEndMonths");
  const sNow = weibullSurvival(tNowMonths, k, lambdaMonths);
  if (sNow <= 0) return 1;
  const sEnd = weibullSurvival(tEndMonths, k, lambdaMonths);
  return Math.max(0, Math.min(1, 1 - sEnd / sNow));
}

export interface BinaryPriorInput {
  readonly tier: Tier;
  /** Announcement of the last print, which the hazard's clock starts from. */
  readonly lastPrintAt: Date;
  readonly listedAt: Date;
  /** The binary's expiry (rulebook `binaryExpiry`); only its UTC date counts. */
  readonly expiresAt: Date;
  /** The latest Tier-1 scoop of a round since the last print, valuation or not. */
  readonly leakAt: Date | null;
}

/**
 * The binary's seed price: the Weibull hazard from listing to expiry, raised
 * to leak_hazard_near (expiry within leak_window_days of a scoop) or
 * leak_hazard_far (later) when the scoop is dated on or before listing, then
 * clamped to [pFloor, 1 − pFloor].
 */
export function binaryProbability(
  input: BinaryPriorInput,
  hazard: HazardParams,
  pFloor: number,
): number {
  assertFinite(pFloor, "pFloor");
  if (pFloor <= 0 || pFloor >= 0.5) {
    throw new RangeError("pFloor must be strictly between zero and one half");
  }
  for (const probability of [hazard.leak_hazard_near, hazard.leak_hazard_far]) {
    assertFinite(probability, "leak hazard");
    if (probability <= 0 || probability >= 1)
      throw new RangeError("leak hazard must be between zero and one");
  }
  assertPositive(hazard.leak_window_days, "leak_window_days");
  const lambda = hazard.cadence_months[input.tier];
  const tNow = monthsBetween(input.lastPrintAt, input.listedAt, hazard.days_per_month);
  const tEnd = monthsBetween(input.lastPrintAt, input.expiresAt, hazard.days_per_month);
  let p = roundProbability(tNow, tEnd, hazard.weibull_k, lambda);
  if (input.leakAt !== null && daysBetween(input.leakAt, input.listedAt) >= 0) {
    const near = daysBetween(input.leakAt, input.expiresAt) <= hazard.leak_window_days;
    p = Math.max(p, near ? hazard.leak_hazard_near : hazard.leak_hazard_far);
  }
  return Math.min(Math.max(p, pFloor), 1 - pFloor);
}

export interface ForwardMidInput {
  readonly lastPostMoneyUsd: number;
  /** μ for the name and tier: params.json `prior.mu_stepup`. */
  readonly mu: number;
  readonly asOf: Date;
  /** The latest Tier-1 scoop since the last print, with its valuation when it reported one. */
  readonly leak: { readonly at: Date; readonly postMoneyUsd: number | null } | null;
}

/**
 * The forward's model mid in log units: ln V_last + μ, re-centred to
 * ln V_leak from the day of a scoop that reported a valuation.
 */
export function forwardMid(input: ForwardMidInput): number {
  assertPositive(input.lastPostMoneyUsd, "lastPostMoneyUsd");
  assertFinite(input.mu, "mu");
  assertDate(input.asOf, "asOf");
  const leak = input.leak;
  if (leak !== null) {
    assertDate(leak.at, "leak.at");
    if (leak.postMoneyUsd !== null) assertPositive(leak.postMoneyUsd, "leak.postMoneyUsd");
  }
  if (leak !== null && leak.postMoneyUsd !== null && daysBetween(leak.at, input.asOf) >= 0) {
    return Math.log(leak.postMoneyUsd);
  }
  return Math.log(input.lastPostMoneyUsd) + input.mu;
}
