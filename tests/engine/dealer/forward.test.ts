import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DEALER_PARAMS } from "../../../src/lib/config/dealer.js";
import {
  collateralCents,
  type ForwardPosition,
  type ForwardQuoteParams,
  type ForwardSide,
  fill,
  maxFillCents,
  payoutCents,
  quote,
  settlementCreditCents,
  voidCreditCents,
} from "../../../src/lib/engine/dealer/forward.js";

const dealer = DEALER_PARAMS.dealer;
const CAP_CENTS = Math.round(dealer.cap_usd * 100);

/** A quote at the published parameters; the mid is a ln-USD level, not a parameter. */
function params(overrides: Partial<ForwardQuoteParams> = {}): ForwardQuoteParams {
  return {
    midLn: Math.log(61e9),
    inventoryCents: 0,
    capCents: CAP_CENTS,
    kappa: dealer.kappa,
    gamma: dealer.gamma,
    sFloor: dealer.s_floor,
    sigmaTier: DEALER_PARAMS.sigma_tier.mega,
    widened: false,
    flagSpreadMult: dealer.flag_spread_mult,
    flagCapMult: dealer.flag_cap_mult,
    ...overrides,
  };
}

const inventory = fc.integer({ min: -2 * CAP_CENTS, max: 2 * CAP_CENTS });
const notional = fc.integer({ min: 1, max: 10 * CAP_CENTS });
const lnLevel = fc.double({ min: 15, max: 30, noNaN: true });
const side = fc.constantFrom<ForwardSide>("long", "short");
const sigma = fc.constantFrom(DEALER_PARAMS.sigma_tier.mega, DEALER_PARAMS.sigma_tier.redhot);

describe("forward quote formula", () => {
  it("matches a hand-computed quote (illustrative inputs)", () => {
    // m = 24, I = $10,000 dealer long, Q = $25,000, κ = 1, γ = 0.5, s_floor = 0.05, σ = 0.35:
    // m̃ = 24 − 0.5·1·0.4 = 23.8; s = 0.05 + 0.35·0.4 = 0.19.
    const illustrative = {
      midLn: 24,
      inventoryCents: 1_000_000,
      capCents: 2_500_000,
      kappa: 1,
      gamma: 0.5,
      sFloor: 0.05,
      sigmaTier: 0.35,
      widened: false,
      flagSpreadMult: 3,
      flagCapMult: 0.5,
    };
    const base = quote(illustrative);
    expect(base.mid).toBe(24);
    expect(base.adjustedMid).toBeCloseTo(23.8, 12);
    expect(base.halfSpread).toBeCloseTo(0.19, 12);
    expect(base.bid).toBeCloseTo(23.61, 12);
    expect(base.ask).toBeCloseTo(23.99, 12);
    expect(base.maxLongCents).toBe(3_500_000);
    expect(base.maxShortCents).toBe(1_500_000);

    // Widened: s × 3 = 0.57 around the same m̃; Q_eff = $12,500.
    const widened = quote({ ...illustrative, widened: true });
    expect(widened.adjustedMid).toBeCloseTo(23.8, 12);
    expect(widened.halfSpread).toBeCloseTo(0.57, 12);
    expect(widened.effectiveCapCents).toBe(1_250_000);
    expect(widened.maxLongCents).toBe(2_250_000);
    expect(widened.maxShortCents).toBe(250_000);
  });

  it("quotes s_floor around the mid when flat, at the published parameters", () => {
    const flat = quote(params());
    expect(flat.adjustedMid).toBe(flat.mid);
    expect(flat.halfSpread).toBe(dealer.s_floor);
    expect(flat.maxLongCents).toBe(CAP_CENTS);
    expect(flat.maxShortCents).toBe(CAP_CENTS);
  });

  it("widens by exactly flag_spread_mult and leaves the skew on the base Q", () => {
    fc.assert(
      fc.property(inventory, sigma, (inventoryCents, sigmaTier) => {
        const base = quote(params({ inventoryCents, sigmaTier }));
        const widened = quote(params({ inventoryCents, sigmaTier, widened: true }));
        expect(widened.adjustedMid).toBe(base.adjustedMid);
        expect(widened.halfSpread).toBeCloseTo(base.halfSpread * dealer.flag_spread_mult, 12);
        expect(widened.effectiveCapCents).toBe(Math.floor(CAP_CENTS * dealer.flag_cap_mult));
      }),
    );
  });

  it("always quotes bid below ask", () => {
    fc.assert(
      fc.property(inventory, lnLevel, sigma, fc.boolean(), (inventoryCents, midLn, s, widened) => {
        const q = quote(params({ inventoryCents, midLn, sigmaTier: s, widened }));
        expect(q.bid).toBeLessThan(q.ask);
        expect(q.bid).toBeLessThan(q.adjustedMid);
        expect(q.ask).toBeGreaterThan(q.adjustedMid);
      }),
    );
  });

  it("skews the mid against the dealer's inventory, monotonically", () => {
    fc.assert(
      fc.property(inventory, inventory, lnLevel, (a, b, midLn) => {
        const qa = quote(params({ inventoryCents: a, midLn }));
        const qb = quote(params({ inventoryCents: b, midLn }));
        // Dealer net long → mid lowered to attract user longs; net short → raised.
        expect(Math.sign(qa.mid - qa.adjustedMid)).toBe(Math.sign(a));
        if (a < b) expect(qa.adjustedMid).toBeGreaterThan(qb.adjustedMid);
        // The spread grows with |I| on either side.
        if (Math.abs(a) < Math.abs(b)) expect(qa.halfSpread).toBeLessThan(qb.halfSpread);
      }),
    );
  });

  it("throws RangeError on non-finite or invalid inputs", () => {
    expect(() => quote(params({ midLn: Number.NaN }))).toThrow(RangeError);
    expect(() => quote(params({ midLn: Number.POSITIVE_INFINITY }))).toThrow(RangeError);
    expect(() => quote(params({ inventoryCents: 1.5 }))).toThrow(RangeError);
    expect(() => quote(params({ capCents: 0 }))).toThrow(RangeError);
    expect(() => quote(params({ kappa: Number.NaN }))).toThrow(RangeError);
    expect(() => quote(params({ sFloor: 0 }))).toThrow(RangeError);
    expect(() => quote(params({ gamma: -1 }))).toThrow(RangeError);
  });
});

describe("forward fills and the cap", () => {
  it("fills a long at the ask and a short at the bid, moving inventory against the user", () => {
    const q = quote(params({ inventoryCents: 100_000 }));
    const long = fill("long", 50_000, q);
    const short = fill("short", 50_000, q);
    expect(long).toEqual({
      ok: true,
      side: "long",
      notionalCents: 50_000,
      entryLn: q.ask,
      inventoryAfterCents: 50_000,
    });
    expect(short).toEqual({
      ok: true,
      side: "short",
      notionalCents: 50_000,
      entryLn: q.bid,
      inventoryAfterCents: 150_000,
    });
  });

  it("pulls the side that would push the dealer past Q, and caps the other at 2Q", () => {
    const atCap = quote(params({ inventoryCents: -CAP_CENTS }));
    expect(atCap.maxLongCents).toBe(0);
    expect(maxFillCents("long", atCap)).toBe(0);
    expect(fill("long", 1, atCap)).toEqual({ ok: false, reason: "side_pulled" });
    expect(maxFillCents("short", atCap)).toBe(2 * CAP_CENTS);
    expect(fill("short", 2 * CAP_CENTS, atCap)).toMatchObject({
      ok: true,
      inventoryAfterCents: CAP_CENTS,
    });
    expect(fill("short", 2 * CAP_CENTS + 1, atCap)).toEqual({
      ok: false,
      reason: "exceeds_cap",
      maxCents: 2 * CAP_CENTS,
    });
  });

  it("halves the cap for new positions while widened but lets the dealer unwind", () => {
    const qEff = Math.floor(CAP_CENTS * dealer.flag_cap_mult);
    // Dealer long past Q_eff when the flag lands: shorts (more dealer long) are pulled,
    // longs reduce it, down to −Q_eff.
    const q = quote(params({ inventoryCents: qEff + 100_000, widened: true }));
    expect(fill("short", 1, q)).toEqual({ ok: false, reason: "side_pulled" });
    expect(q.maxLongCents).toBe(2 * qEff + 100_000);
    expect(fill("long", q.maxLongCents, q)).toMatchObject({ ok: true, inventoryAfterCents: -qEff });
  });

  it("refuses non-positive notional and throws on non-integer or non-finite notional", () => {
    const q = quote(params());
    expect(fill("long", 0, q)).toEqual({ ok: false, reason: "non_positive" });
    expect(fill("short", -100, q)).toEqual({ ok: false, reason: "non_positive" });
    expect(() => fill("long", 1.5, q)).toThrow(RangeError);
    expect(() => fill("long", Number.NaN, q)).toThrow(RangeError);
  });

  it("never leaves the dealer past the effective cap unless it was already, and then only nearer zero", () => {
    fc.assert(
      fc.property(inventory, notional, side, fc.boolean(), (inventoryCents, n, s, widened) => {
        const q = quote(params({ inventoryCents, widened }));
        const result = fill(s, n, q);
        if (!result.ok) {
          expect(n).toBeGreaterThan(maxFillCents(s, q));
          return;
        }
        const after = Math.abs(result.inventoryAfterCents);
        if (Math.abs(inventoryCents) <= q.effectiveCapCents) {
          expect(after).toBeLessThanOrEqual(q.effectiveCapCents);
        } else {
          expect(after).toBeLessThan(Math.abs(inventoryCents));
        }
      }),
    );
  });
});

describe("forward collateral, payout and settlement", () => {
  const position = (overrides: Partial<ForwardPosition> = {}): ForwardPosition => ({
    side: "long",
    notionalCents: 1_000_000,
    entryLn: Math.log(61e9),
    kappa: dealer.kappa,
    ...overrides,
  });

  it("posts ceil(N·κ) collateral (illustrative κ values)", () => {
    expect(collateralCents(1_000_000, 1)).toBe(1_000_000);
    expect(collateralCents(3, 0.5)).toBe(2);
    // 10 · 0.7 is 7.000000000000001 in floating point; nobody owes the eighth cent.
    expect(collateralCents(10, 0.7)).toBe(7);
    expect(() => collateralCents(0, 1)).toThrow(RangeError);
    expect(() => collateralCents(100, Number.NaN)).toThrow(RangeError);
  });

  it("pays N·(settle − F₀) inside the clip and N·κ at it, short the negative", () => {
    const entryLn = Math.log(61e9);
    const up = Math.log(2) / 2;
    expect(payoutCents(position({ entryLn }), entryLn + up)).toBeCloseTo(1_000_000 * up, 6);
    expect(payoutCents(position({ entryLn, side: "short" }), entryLn + up)).toBeCloseTo(
      -1_000_000 * up,
      6,
    );
    const kappa = dealer.kappa;
    expect(payoutCents(position({ entryLn }), entryLn + 5 * kappa)).toBe(1_000_000 * kappa);
    expect(payoutCents(position({ entryLn }), entryLn - 5 * kappa)).toBe(-1_000_000 * kappa);
    expect(payoutCents(position({ entryLn }), entryLn)).toBe(0);
  });

  it("is symmetric: a long's payout is exactly the short's negative, and bounded by N·κ", () => {
    fc.assert(
      fc.property(notional, lnLevel, lnLevel, (n, entryLn, settleLn) => {
        const long = payoutCents(position({ notionalCents: n, entryLn }), settleLn);
        const short = payoutCents(position({ notionalCents: n, entryLn, side: "short" }), settleLn);
        expect(long + short).toBe(0);
        expect(Math.abs(long)).toBeLessThanOrEqual(n * dealer.kappa);
      }),
    );
  });

  it("credits collateral plus payout, floored, at the clip edges and in between", () => {
    const entryLn = Math.log(61e9);
    const kappa = dealer.kappa;
    expect(settlementCreditCents(position({ entryLn }), entryLn + 9)).toBe(2_000_000);
    expect(settlementCreditCents(position({ entryLn }), entryLn - 9)).toBe(0);
    expect(settlementCreditCents(position({ entryLn, side: "short" }), entryLn - 9)).toBe(
      2_000_000,
    );
    expect(settlementCreditCents(position({ entryLn }), entryLn)).toBe(1_000_000);
    const move = kappa / 3;
    expect(settlementCreditCents(position({ entryLn }), entryLn + move)).toBe(
      Math.floor(1_000_000 + 1_000_000 * move),
    );
  });

  it("keeps every credit in [0, 2·collateral]", () => {
    fc.assert(
      fc.property(side, notional, lnLevel, lnLevel, (s, n, entryLn, settleLn) => {
        const p = position({ side: s, notionalCents: n, entryLn });
        const credit = settlementCreditCents(p, settleLn);
        const collateral = collateralCents(n, p.kappa);
        expect(Number.isSafeInteger(credit)).toBe(true);
        expect(credit).toBeGreaterThanOrEqual(0);
        expect(credit).toBeLessThanOrEqual(2 * collateral);
      }),
    );
  });

  it("credits a long and a short of the same N at the same F₀ 2·collateral, less at most a cent", () => {
    fc.assert(
      fc.property(notional, lnLevel, lnLevel, (n, entryLn, settleLn) => {
        const long = settlementCreditCents(position({ notionalCents: n, entryLn }), settleLn);
        const short = settlementCreditCents(
          position({ notionalCents: n, entryLn, side: "short" }),
          settleLn,
        );
        const collateral = collateralCents(n, dealer.kappa);
        expect(long + short).toBeLessThanOrEqual(2 * collateral);
        expect(long + short).toBeGreaterThanOrEqual(2 * collateral - 1);
      }),
    );
  });

  it("voids with exactly the collateral back", () => {
    fc.assert(
      fc.property(side, notional, (s, n) => {
        const p = position({ side: s, notionalCents: n });
        expect(voidCreditCents(p)).toBe(collateralCents(n, p.kappa));
      }),
    );
  });

  it("throws RangeError on non-finite settlement inputs", () => {
    expect(() => payoutCents(position(), Number.NaN)).toThrow(RangeError);
    expect(() => payoutCents(position({ entryLn: Number.NEGATIVE_INFINITY }), 20)).toThrow(
      RangeError,
    );
    expect(() => settlementCreditCents(position({ kappa: Number.NaN }), 20)).toThrow(RangeError);
  });
});
