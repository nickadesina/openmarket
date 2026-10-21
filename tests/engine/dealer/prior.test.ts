import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEALER_PARAMS } from "../../../src/lib/config/dealer.js";
import {
  binaryProbability,
  forwardMid,
  type HazardParams,
  monthsBetween,
  roundProbability,
  type Tier,
  tierOf,
  weibullSurvival,
} from "../../../src/lib/engine/dealer/prior.js";
import { binaryExpiry } from "../../../src/lib/engine/dealer/rulebook.js";

/**
 * prior.ts is a port of backtest/sim.py's prior (TECHNICAL_DESIGN.md §5).
 * backtest/golden.py records sim's outputs on the calibration run, with their
 * inputs, in backtest/out/prior_golden.json; backtest.yml fails if a rerun does
 * not reproduce that file. Here the port must agree with every row to 1e-9.
 */
const TOLERANCE = 1e-9;

interface GoldenBase {
  readonly company: string;
  readonly tier: Tier;
  readonly last_print_date: string;
  readonly last_post_money_usd: number;
}

interface GoldenBinary extends GoldenBase {
  readonly listed: string;
  readonly expiry: string;
  readonly leak_date: string | null;
  readonly p_model: number;
}

interface GoldenForward extends GoldenBase {
  readonly listed: string;
  readonly expiry: string;
  readonly mu: number;
  readonly mid0: number;
}

interface GoldenMark extends GoldenBase {
  readonly date: string;
  readonly mu: number;
  readonly leak_date: string | null;
  readonly leak_post_money_usd: number | null;
  readonly mid: number;
}

const golden = JSON.parse(readFileSync("backtest/out/prior_golden.json", "utf8")) as {
  readonly binaries: readonly GoldenBinary[];
  readonly forwards: readonly GoldenForward[];
  readonly marks: readonly GoldenMark[];
};

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const P_FLOOR = DEALER_PARAMS.dealer.p_floor;
const HAZARD: HazardParams = DEALER_PARAMS.prior;
const THRESHOLD = DEALER_PARAMS.tier.mega_threshold_usd;

function within(actual: number, expected: number, label: string): void {
  expect(Math.abs(actual - expected), label).toBeLessThanOrEqual(TOLERANCE);
}

describe("prior against sim.py (backtest/out/prior_golden.json)", () => {
  it("covers every row kind, both tiers and the leak override", () => {
    expect(golden.binaries.length).toBeGreaterThan(0);
    expect(golden.forwards.length).toBeGreaterThan(0);
    expect(golden.marks.length).toBeGreaterThan(0);
    expect(new Set(golden.binaries.map((row) => row.tier))).toEqual(new Set(["mega", "redhot"]));
    expect(
      golden.binaries.some((row) => row.leak_date !== null && row.leak_date <= row.listed),
    ).toBe(true);
    expect(golden.marks.some((row) => row.leak_date !== null && row.leak_date <= row.date)).toBe(
      true,
    );
  });

  it("puts every row in the tier sim put it in", () => {
    for (const row of [...golden.binaries, ...golden.forwards, ...golden.marks]) {
      expect(tierOf(row.last_post_money_usd, THRESHOLD), row.company).toBe(row.tier);
    }
  });

  it("uses the μ params.json publishes for the name and tier", () => {
    for (const row of [...golden.forwards, ...golden.marks]) {
      expect(row.mu, `${row.company} ${row.tier}`).toBe(
        DEALER_PARAMS.prior.mu_stepup[row.company]?.[row.tier],
      );
    }
  });

  it("prices every binary quarter as sim did, with the rulebook's expiry", () => {
    for (const row of golden.binaries) {
      const label = `${row.company} listed ${row.listed}`;
      const expiresAt = binaryExpiry(day(row.listed));
      expect(expiresAt.toISOString().slice(0, 10), label).toBe(row.expiry);
      const p = binaryProbability(
        {
          tier: row.tier,
          lastPrintAt: day(row.last_print_date),
          listedAt: day(row.listed),
          expiresAt,
          leakAt: row.leak_date === null ? null : day(row.leak_date),
        },
        HAZARD,
        P_FLOOR,
      );
      within(p, row.p_model, label);
    }
  });

  it("sets every forward life's opening mid as sim did", () => {
    for (const row of golden.forwards) {
      const mid = forwardMid({
        lastPostMoneyUsd: row.last_post_money_usd,
        mu: row.mu,
        asOf: day(row.listed),
        leak: null,
      });
      within(mid, row.mid0, `${row.company} listed ${row.listed}`);
    }
  });

  it("re-centres the weekly mid on a scoop as sim's dealer did", () => {
    for (const row of golden.marks) {
      const mid = forwardMid({
        lastPostMoneyUsd: row.last_post_money_usd,
        mu: row.mu,
        asOf: day(row.date),
        leak:
          row.leak_date === null
            ? null
            : { at: day(row.leak_date), postMoneyUsd: row.leak_post_money_usd },
      });
      within(mid, row.mid, `${row.company} ${row.date}`);
    }
  });
});

describe("prior", () => {
  const lastPrintAt = day("2026-01-15");
  const base = {
    tier: "mega" as const,
    lastPrintAt,
    listedAt: day("2026-04-01"),
    expiresAt: day("2026-06-30"),
    leakAt: null,
  };

  it("splits tiers at the threshold, which is mega-cap", () => {
    expect(tierOf(THRESHOLD, THRESHOLD)).toBe("mega");
    expect(tierOf(THRESHOLD - 1, THRESHOLD)).toBe("redhot");
  });

  it("counts whole UTC days, whatever the time of day", () => {
    const from = new Date("2026-01-01T23:59:59Z");
    const to = new Date("2026-01-31T00:00:01Z");
    expect(monthsBetween(from, to, HAZARD.days_per_month)).toBe(30 / HAZARD.days_per_month);
  });

  it("clamps to [p_floor, 1 − p_floor]", () => {
    const justPrinted = { ...base, listedAt: lastPrintAt, expiresAt: day("2026-01-16") };
    expect(binaryProbability(justPrinted, HAZARD, P_FLOOR)).toBe(P_FLOOR);
    const overdue = { ...base, lastPrintAt: day("1996-01-15") };
    expect(roundProbability(360, 365, HAZARD.weibull_k, 11)).toBeGreaterThan(1 - P_FLOOR);
    expect(binaryProbability(overdue, HAZARD, P_FLOOR)).toBe(1 - P_FLOOR);
  });

  it("prices a zero-length quarter at the floor", () => {
    const sameDay = { ...base, expiresAt: base.listedAt };
    expect(roundProbability(3, 3, HAZARD.weibull_k, 11)).toBe(0);
    expect(binaryProbability(sameDay, HAZARD, P_FLOOR)).toBe(P_FLOOR);
  });

  it("is certain once survival underflows, as sim's guard is", () => {
    expect(weibullSurvival(1e6, HAZARD.weibull_k, 7)).toBe(0);
    expect(roundProbability(1e6, 1e6 + 1, HAZARD.weibull_k, 7)).toBe(1);
  });

  it("raises p to the near hazard when expiry is within the window of a scoop", () => {
    // 2026-05-01 to 2026-06-30 is 60 days: the window is inclusive.
    const near = { ...base, listedAt: day("2026-05-02"), leakAt: day("2026-05-01") };
    expect(binaryProbability(near, HAZARD, P_FLOOR)).toBe(HAZARD.leak_hazard_near);
    const far = { ...near, leakAt: day("2026-04-30") };
    expect(binaryProbability(far, HAZARD, P_FLOOR)).toBe(HAZARD.leak_hazard_far);
  });

  it("counts a scoop dated on the listing day and ignores one after it", () => {
    const onListing = { ...base, leakAt: base.listedAt };
    expect(binaryProbability(onListing, HAZARD, P_FLOOR)).toBe(HAZARD.leak_hazard_far);
    const after = { ...base, leakAt: day("2026-04-02") };
    expect(binaryProbability(after, HAZARD, P_FLOOR)).toBe(
      binaryProbability(base, HAZARD, P_FLOOR),
    );
    expect(binaryProbability(base, HAZARD, P_FLOOR)).toBeLessThan(HAZARD.leak_hazard_near);
  });

  it("never lowers p on a scoop", () => {
    const overdue = { ...base, lastPrintAt: day("1996-01-15"), leakAt: base.listedAt };
    expect(binaryProbability(overdue, HAZARD, P_FLOOR)).toBe(1 - P_FLOOR);
  });

  it("re-centres the mid on a scoop with a valuation, from its day on", () => {
    const input = { lastPostMoneyUsd: 20e9, mu: 0.5, asOf: day("2026-03-01") };
    expect(forwardMid({ ...input, leak: null })).toBe(Math.log(20e9) + 0.5);
    const leak = { at: day("2026-03-01"), postMoneyUsd: 30e9 };
    expect(forwardMid({ ...input, leak })).toBe(Math.log(30e9));
    expect(forwardMid({ ...input, leak: { ...leak, at: day("2026-03-02") } })).toBe(
      Math.log(20e9) + 0.5,
    );
    expect(forwardMid({ ...input, leak: { ...leak, postMoneyUsd: null } })).toBe(
      Math.log(20e9) + 0.5,
    );
  });
});
