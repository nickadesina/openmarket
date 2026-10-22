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
 * price band on the binary), and on each name forwards and binary buys
 * come in opposite pairs (long then short at one notional, YES then NO at
 * one share count), so the flow nets out: the dealer's inventory skew stays
 * within one trade and the YES price near the model's p. A fill the dealer refuses is skipped, never forced. These are
 * not dealer parameters and move no price to a level.
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
export const DEMO_FORWARD_NOTIONALS_USD: readonly number[] = Object.freeze([250, 500, 750, 1_000]);

/** Binary buy sizes, USD spent. */
export const DEMO_BINARY_SPENDS_USD: readonly number[] = Object.freeze([10, 25, 50, 100]);

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
      /**
       * Buys as many shares of `side` as the name's last binary buy filled on
       * the other side: together they are complete sets, so the YES price
       * returns to where the pair began.
       */
      readonly slug: string;
      readonly account: number;
      readonly kind: "binary_match";
      readonly side: "yes" | "no";
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

type Draws = readonly [number, number, number, number];

/** A name's opening trade of a kind, waiting for the trade that takes its other side. */
type OpenPairs = Map<string, { readonly side: string; readonly size: number }>;

/**
 * Trades of a kind on a name come in pairs: an opener draws its side and
 * size, and the next trade of that kind on the name takes the other side at
 * the same size. The net flow on a name is never more than one opener.
 */
function paired<S extends string>(
  open: OpenPairs,
  key: string,
  sides: readonly [S, S],
  sideDraw: number,
  size: number,
): { readonly side: S; readonly size: number } {
  const opener = open.get(key);
  if (opener !== undefined) {
    open.delete(key);
    return { side: opener.side === sides[0] ? sides[1] : sides[0], size: opener.size };
  }
  const side = sides[sideDraw < 0.5 ? 0 : 1];
  open.set(key, { side, size });
  return { side, size };
}

/**
 * One trade from its four draws. A round-0 trade is never a sell, so an
 * account holds something before it sells. Binary buys pair like forwards,
 * but the second of a pair matches the first's shares, not its dollars.
 */
function plannedTrade(
  slug: string,
  account: number,
  round: number,
  [kindDraw, sideDraw, sizeDraw, fractionDraw]: Draws,
  open: OpenPairs,
): DemoTrade {
  if (kindDraw < 0.4) {
    const { side, size } = paired(
      open,
      `${slug}:forward`,
      ["long", "short"] as const,
      sideDraw,
      pick(sizeDraw, DEMO_FORWARD_NOTIONALS_USD),
    );
    return { slug, account, kind: "forward", side, notionalUsd: size };
  }
  if (kindDraw < 0.8 || round === 0) {
    const key = `${slug}:binary`;
    const opening = !open.has(key);
    const { side, size } = paired(
      open,
      key,
      ["yes", "no"] as const,
      sideDraw,
      pick(sizeDraw, DEMO_BINARY_SPENDS_USD),
    );
    return opening
      ? { slug, account, kind: "binary_buy", side, spendUsd: size }
      : { slug, account, kind: "binary_match", side };
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
  const open: OpenPairs = new Map();
  const plan: DemoTrade[] = [];
  for (let round = 0; round < DEMO_TRADES_PER_ACCOUNT; round += 1) {
    for (const slug of names) {
      for (let account = 0; account < DEMO_ACCOUNTS.length; account += 1) {
        plan.push(plannedTrade(slug, account, round, [next(), next(), next(), next()], open));
      }
    }
  }
  return plan;
}
