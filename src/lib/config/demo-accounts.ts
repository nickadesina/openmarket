/**
 * The five demo accounts and the trades `npm run seed:demo` places for them
 * (decision 0005). Demo accounts exist only to show the markets working:
 * they are labelled wherever they appear, trade only through the real
 * services, and never sign in, forecast or post.
 *
 * Handles say what the accounts are; nothing else about them is invented.
 * The trades come from one fixed seed, so a fresh database listed and quoted
 * the same way gets the same book. Sizes are small against the dealer's
 * limits (CONTRACTS.md → The dealer: Q per side on the forward, b and the
 * price band on the binary); a fill the dealer refuses is skipped, never
 * forced. These are not dealer parameters and move no price to a level.
 */

export interface DemoAccount {
  /** A `password`-namespace handle with no credential: shown without an "@". */
  readonly handle: string;
  readonly displayName: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = Object.freeze(
  [1, 2, 3, 4, 5].map((n) =>
    Object.freeze({ handle: `demo_${n}`, displayName: `Demo trader ${n}` }),
  ),
);

/** The generator's seed. Changing it changes every demo book; reruns never change one. */
export const DEMO_SEED = 20_261_022;

/** Trades each account places on each listed name. */
export const DEMO_TRADES_PER_ACCOUNT = 3;

/** Forward notionals, USD: a fill of each posts the same in collateral (κ = 1). */
export const DEMO_FORWARD_NOTIONALS_USD: readonly number[] = Object.freeze([
  250, 500, 1_000, 1_500, 2_500,
]);

/** Binary buy sizes, USD spent. */
export const DEMO_BINARY_SPENDS_USD: readonly number[] = Object.freeze([20, 50, 100, 200]);

/** A binary sell's share of the account's larger holding on that book. */
export const DEMO_SELL_FRACTIONS: readonly number[] = Object.freeze([0.25, 0.5, 1]);

/** One planned trade. A sell names no side: it sells the side the account holds more of. */
export type DemoTrade =
  | {
      readonly slug: string;
      readonly account: number;
      readonly kind: "forward";
      readonly side: "long" | "short";
      readonly notionalUsd: number;
    }
  | {
      readonly slug: string;
      readonly account: number;
      readonly kind: "binary_buy";
      readonly side: "yes" | "no";
      readonly spendUsd: number;
    }
  | {
      readonly slug: string;
      readonly account: number;
      readonly kind: "binary_sell";
      readonly fraction: number;
    };

/** mulberry32: a small, fixed, portable PRNG; the same seed gives the same stream everywhere. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pick<T>(draw: number, values: readonly T[]): T {
  return values[Math.floor(draw * values.length)]!;
}

/**
 * One trade from its four draws. A round-0 trade is never a sell, so an
 * account holds something before it sells.
 */
function plannedTrade(
  slug: string,
  account: number,
  round: number,
  [kindDraw, sideDraw, sizeDraw, fractionDraw]: readonly [number, number, number, number],
): DemoTrade {
  if (kindDraw < 0.4) {
    const side = sideDraw < 0.5 ? "long" : "short";
    return {
      slug,
      account,
      kind: "forward",
      side,
      notionalUsd: pick(sizeDraw, DEMO_FORWARD_NOTIONALS_USD),
    };
  }
  if (kindDraw < 0.8 || round === 0) {
    const side = sideDraw < 0.5 ? "yes" : "no";
    return {
      slug,
      account,
      kind: "binary_buy",
      side,
      spendUsd: pick(sizeDraw, DEMO_BINARY_SPENDS_USD),
    };
  }
  return { slug, account, kind: "binary_sell", fraction: pick(fractionDraw, DEMO_SELL_FRACTIONS) };
}

/**
 * Every planned trade, round by round across the names (sorted by slug) and
 * accounts, so the tape interleaves names the way a used market does. The
 * plan depends only on the seed and the slugs; whether a trade fills is the
 * dealer's call at execution. Each trade takes four draws whatever its kind,
 * so one trade's kind never shifts the draws behind the trades after it.
 */
export function demoTradePlan(slugs: readonly string[], seed: number = DEMO_SEED): DemoTrade[] {
  const next = generator(seed);
  const names = [...slugs].sort();
  const plan: DemoTrade[] = [];
  for (let round = 0; round < DEMO_TRADES_PER_ACCOUNT; round += 1) {
    for (const slug of names) {
      for (let account = 0; account < DEMO_ACCOUNTS.length; account += 1) {
        plan.push(plannedTrade(slug, account, round, [next(), next(), next(), next()]));
      }
    }
  }
  return plan;
}
