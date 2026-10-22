import { describe, expect, it } from "vitest";
import { DEALER_PARAMS } from "../../src/lib/config/dealer.js";
import {
  DEMO_ACCOUNTS,
  DEMO_BINARY_SPENDS_USD,
  DEMO_FORWARD_NOTIONALS_USD,
  DEMO_SELL_FRACTIONS,
  DEMO_TRADES_PER_ACCOUNT,
  demoTradePlan,
} from "../../src/lib/config/demo-accounts.js";

/** Decision 0005: five labelled accounts, a plan fixed by its seed, sizes inside the dealer's limits. */
const NAMES = Object.keys(DEALER_PARAMS.forward_t_days).map((name) => name.toLowerCase());

describe("demo accounts", () => {
  it("are five accounts whose handles and names say what they are", () => {
    expect(DEMO_ACCOUNTS).toEqual(
      [1, 2, 3, 4, 5].map((n) => ({
        handle: `demo_${n}`,
        displayName: `Demo trader ${n}`,
      })),
    );
    expect(DEMO_ACCOUNTS.map((account) => Object.keys(account).sort())).toEqual(
      DEMO_ACCOUNTS.map(() => ["displayName", "handle"]),
    );
  });

  it("plans the same trades from the same seed, whatever order the names arrive in", () => {
    expect(demoTradePlan(NAMES)).toEqual(demoTradePlan([...NAMES].reverse()));
    expect(demoTradePlan(NAMES, 1)).not.toEqual(demoTradePlan(NAMES));
  });

  it("gives every account a handful of trades on every name, both sides of both contracts", () => {
    const plan = demoTradePlan(NAMES);
    expect(plan).toHaveLength(NAMES.length * DEMO_ACCOUNTS.length * DEMO_TRADES_PER_ACCOUNT);
    for (const slug of NAMES) {
      for (let account = 0; account < DEMO_ACCOUNTS.length; account += 1) {
        const trades = plan.filter((trade) => trade.slug === slug && trade.account === account);
        expect(trades).toHaveLength(DEMO_TRADES_PER_ACCOUNT);
        // An account's first trade on a name is never a sell.
        expect(trades[0]!.kind).not.toBe("binary_sell");
      }
    }
    const sides = new Set(plan.flatMap((trade) => ("side" in trade ? [trade.side] : [])));
    expect(sides).toEqual(new Set(["long", "short", "yes", "no"]));
    expect(plan.some((trade) => trade.kind === "binary_sell")).toBe(true);
  });

  it("sizes every trade well inside the dealer's per-side cap", () => {
    // The cap an event flag halves (CONTRACTS.md → The dealer).
    const capUsd = DEALER_PARAMS.dealer.cap_usd * DEALER_PARAMS.dealer.flag_cap_mult;
    for (const trade of demoTradePlan(NAMES)) {
      if (trade.kind === "forward") {
        expect(DEMO_FORWARD_NOTIONALS_USD).toContain(trade.notionalUsd);
      } else if (trade.kind === "binary_buy") {
        expect(DEMO_BINARY_SPENDS_USD).toContain(trade.spendUsd);
      } else {
        expect(DEMO_SELL_FRACTIONS).toContain(trade.fraction);
      }
    }
    // Even if every planned forward on a name took one side of a flagged book, the cap would hold.
    for (const slug of NAMES) {
      const gross = demoTradePlan(NAMES)
        .filter((trade) => trade.slug === slug && trade.kind === "forward")
        .reduce((sum, trade) => sum + (trade.kind === "forward" ? trade.notionalUsd : 0), 0);
      expect(gross).toBeLessThan(capUsd);
    }
  });
});
