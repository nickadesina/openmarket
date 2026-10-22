import { assertFinite, assertPositive } from "../assert.js";
import { CENT_TOLERANCE } from "../types.js";
/**
 * The next-print forward's quoter and payout (CONTRACTS.md → Contract B and
 * The dealer). Pure: every parameter arrives as an argument, so the services
 * pass `DEALER_PARAMS` (src/lib/config/dealer.ts) and nothing here is a number
 * the backtest owns.
 *
 * Units: valuations and prices in natural-log USD; notional, inventory,
 * collateral and cash in integer cents. Inventory I is the dealer's net
 * position in notional cents, positive when the dealer is net long (users net
 * short): a user long of N moves I by −N, a user short by +N.
 */

export type ForwardSide = "long" | "short";

export interface ForwardQuoteParams {
  /** Model mid m, ln USD. */
  readonly midLn: number;
  /** Dealer inventory I, signed notional cents. */
  readonly inventoryCents: number;
  /** Position cap Q per side per name, notional cents. */
  readonly capCents: number;
  /** Payout clip κ, log units. */
  readonly kappa: number;
  /** Risk aversion γ. */
  readonly gamma: number;
  /** Spread floor s_floor, log units. */
  readonly sFloor: number;
  /** Prior-error sd σ_tier, log units. */
  readonly sigmaTier: number;
  /** True while an event flag widens the instrument (lifecycle state `widened`). */
  readonly widened: boolean;
  readonly flagSpreadMult: number;
  readonly flagCapMult: number;
}

export interface ForwardQuote {
  /** m, ln USD. */
  readonly mid: number;
  /** m̃ = m − γ·κ·I/Q, ln USD. */
  readonly adjustedMid: number;
  /** s, log units, after the flag multiplier when widened. */
  readonly halfSpread: number;
  /** m̃ − s: a short fills here. */
  readonly bid: number;
  /** m̃ + s: a long fills here. */
  readonly ask: number;
  /** Most notional a user can go long without breaching the effective cap; 0 = pulled. */
  readonly maxLongCents: number;
  /** Most notional a user can go short without breaching the effective cap; 0 = pulled. */
  readonly maxShortCents: number;
  /** I the quote was made at. */
  readonly inventoryCents: number;
  /** Q_eff: Q, or Q·flag_cap_mult while widened. */
  readonly effectiveCapCents: number;
}

export type ForwardFillRefusal =
  | { readonly ok: false; readonly reason: "non_positive" }
  | { readonly ok: false; readonly reason: "side_pulled" }
  | { readonly ok: false; readonly reason: "exceeds_cap"; readonly maxCents: number };

export type ForwardFill =
  | {
      readonly ok: true;
      readonly side: ForwardSide;
      readonly notionalCents: number;
      /** F₀: the quote side filled at, ln USD. */
      readonly entryLn: number;
      /** I after the fill, signed notional cents. */
      readonly inventoryAfterCents: number;
    }
  | ForwardFillRefusal;

/** What settlement and void need to know about one open position. */
export interface ForwardPosition {
  readonly side: ForwardSide;
  readonly notionalCents: number;
  /** F₀, ln USD. */
  readonly entryLn: number;
  /** κ the position opened under. */
  readonly kappa: number;
}

function assertSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer`);
  }
}

function assertSide(side: ForwardSide): void {
  if (side !== "long" && side !== "short") {
    throw new RangeError('side must be "long" or "short"');
  }
}

function validateQuoteParams(params: ForwardQuoteParams): void {
  assertFinite(params.midLn, "midLn");
  assertSafeInteger(params.inventoryCents, "inventoryCents");
  assertSafeInteger(params.capCents, "capCents");
  assertPositive(params.capCents, "capCents");
  assertPositive(params.kappa, "kappa");
  assertFinite(params.gamma, "gamma");
  if (params.gamma < 0) throw new RangeError("gamma must not be negative");
  assertPositive(params.sFloor, "sFloor");
  assertFinite(params.sigmaTier, "sigmaTier");
  if (params.sigmaTier < 0) throw new RangeError("sigmaTier must not be negative");
  if (typeof params.widened !== "boolean") throw new RangeError("widened must be boolean");
  assertPositive(params.flagSpreadMult, "flagSpreadMult");
  assertPositive(params.flagCapMult, "flagCapMult");
}

/**
 * The dealer's two-way quote:
 *
 *     m̃ = m − γ·κ·I/Q        s = s_floor + σ_tier·|I|/Q
 *     bid = m̃ − s             ask = m̃ + s
 *
 * Widened, s ×= flag_spread_mult and new positions are capped at
 * Q_eff = Q·flag_cap_mult. The skew and spread terms keep the base Q, not
 * Q_eff: the flag is meant to multiply the spread by exactly
 * flag_spread_mult and leave the skew alone, and dividing by Q_eff would
 * also double the inventory terms, so the widened quote would no longer be
 * the ×3 CONTRACTS.md publishes. Q_eff is used only for the cap check.
 *
 * Cap check: a side is pulled when any fill on it would push I past ±Q_eff.
 * maxLong = max(0, Q_eff + I) and maxShort = max(0, Q_eff − I). Inside the
 * cap that is exactly |I_after| ≤ Q_eff. If a flag halved Q under an
 * inventory already past Q_eff, the side that reduces |I| still fills, down
 * to −Q_eff on the other side: the flag binds new risk, it does not stop the
 * dealer unwinding.
 */
export function quote(params: ForwardQuoteParams): ForwardQuote {
  validateQuoteParams(params);
  const { midLn: m, inventoryCents: inventory, capCents: cap } = params;

  const adjustedMid = m - (params.gamma * params.kappa * inventory) / cap;
  const baseHalfSpread = params.sFloor + (params.sigmaTier * Math.abs(inventory)) / cap;
  const halfSpread = params.widened ? baseHalfSpread * params.flagSpreadMult : baseHalfSpread;
  // Rounded down: a fractional cent of cap would be dealer risk nobody set.
  const effectiveCapCents = params.widened ? Math.floor(cap * params.flagCapMult) : cap;

  const bid = adjustedMid - halfSpread;
  const ask = adjustedMid + halfSpread;
  for (const [value, name] of [
    [adjustedMid, "adjustedMid"],
    [bid, "bid"],
    [ask, "ask"],
  ] as const) {
    if (!Number.isFinite(value)) throw new RangeError(`${name} is outside the finite range`);
  }

  return {
    mid: m,
    adjustedMid,
    halfSpread,
    bid,
    ask,
    maxLongCents: Math.max(0, effectiveCapCents + inventory),
    maxShortCents: Math.max(0, effectiveCapCents - inventory),
    inventoryCents: inventory,
    effectiveCapCents,
  };
}

function validateQuote(forwardQuote: ForwardQuote): void {
  for (const field of ["mid", "adjustedMid", "halfSpread", "bid", "ask"] as const) {
    assertFinite(forwardQuote[field], field);
  }
  if (forwardQuote.halfSpread < 0 || forwardQuote.bid > forwardQuote.ask) {
    throw new RangeError("quote spread must not be negative");
  }
  assertSafeInteger(forwardQuote.inventoryCents, "inventoryCents");
  for (const field of ["effectiveCapCents", "maxLongCents", "maxShortCents"] as const) {
    assertSafeInteger(forwardQuote[field], field);
    if (forwardQuote[field] < 0) throw new RangeError(`${field} must not be negative`);
  }
  const { effectiveCapCents: cap, inventoryCents: inventory } = forwardQuote;
  if (
    forwardQuote.maxLongCents !== Math.max(0, cap + inventory) ||
    forwardQuote.maxShortCents !== Math.max(0, cap - inventory)
  ) {
    throw new RangeError("quote availability must agree with its cap and inventory");
  }
}

/** How much notional a user can take on a side of this quote; 0 means the side is pulled. */
export function maxFillCents(side: ForwardSide, forwardQuote: ForwardQuote): number {
  assertSide(side);
  validateQuote(forwardQuote);
  return side === "long" ? forwardQuote.maxLongCents : forwardQuote.maxShortCents;
}

/**
 * Fills a user's position notional-for-notional at the posted price: a long
 * at the ask, a short at the bid. Entry F₀ is that price.
 */
export function fill(
  side: ForwardSide,
  notionalCents: number,
  forwardQuote: ForwardQuote,
): ForwardFill {
  assertSide(side);
  assertSafeInteger(notionalCents, "notionalCents");
  const maxCents = maxFillCents(side, forwardQuote);
  if (notionalCents <= 0) return { ok: false, reason: "non_positive" };
  if (maxCents === 0) return { ok: false, reason: "side_pulled" };
  if (notionalCents > maxCents) return { ok: false, reason: "exceeds_cap", maxCents };

  const inventoryAfterCents =
    side === "long"
      ? forwardQuote.inventoryCents - notionalCents
      : forwardQuote.inventoryCents + notionalCents;
  assertSafeInteger(inventoryAfterCents, "inventoryAfterCents");
  return {
    ok: true,
    side,
    notionalCents,
    entryLn: side === "long" ? forwardQuote.ask : forwardQuote.bid,
    inventoryAfterCents,
  };
}

/**
 * Collateral debited at open: ceil(N·κ) cents, the position's maximum loss.
 * The tolerance keeps float noise (10 · 0.7 = 7.000000000000001) from
 * charging a cent nobody owes.
 */
export function collateralCents(notionalCents: number, kappa: number): number {
  assertSafeInteger(notionalCents, "notionalCents");
  if (notionalCents <= 0) throw new RangeError("notionalCents must be greater than zero");
  assertPositive(kappa, "kappa");
  const collateral = Math.ceil(notionalCents * kappa - CENT_TOLERANCE);
  assertSafeInteger(collateral, "collateral");
  return collateral;
}

/**
 * Exact, unrounded payout in cents: N·clip(settle_ln − F₀, −κ, +κ) for a
 * long, the negative for a short. Settlement quantizes it.
 */
export function payoutCents(position: ForwardPosition, settleLn: number): number {
  assertSide(position.side);
  assertSafeInteger(position.notionalCents, "notionalCents");
  if (position.notionalCents <= 0) throw new RangeError("notionalCents must be greater than zero");
  assertFinite(position.entryLn, "entryLn");
  assertPositive(position.kappa, "kappa");
  assertFinite(settleLn, "settleLn");

  const move = Math.min(position.kappa, Math.max(-position.kappa, settleLn - position.entryLn));
  const longPayout = position.notionalCents * move;
  const payout = position.side === "long" ? longPayout : -longPayout;
  return payout === 0 ? 0 : payout;
}

/**
 * Cash credited at settlement: collateral plus payout, floored so the ledger
 * never pays more than the exact amount, and clamped to [0, 2·collateral].
 */
export function settlementCreditCents(position: ForwardPosition, settleLn: number): number {
  const collateral = collateralCents(position.notionalCents, position.kappa);
  const exact = collateral + payoutCents(position, settleLn);
  return Math.min(2 * collateral, Math.max(0, Math.floor(exact + CENT_TOLERANCE)));
}

/** Cash credited when the forward voids: exactly the collateral posted at open. */
export function voidCreditCents(position: ForwardPosition): number {
  assertSide(position.side);
  return collateralCents(position.notionalCents, position.kappa);
}
