import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEALER_PARAMS } from "../../src/lib/config/dealer.js";
import type { JsonValue } from "../../src/lib/db/schema.js";
import { binaryProbability } from "../../src/lib/engine/dealer/prior.js";
import { binaryExpiry, RULEBOOK_VERSION } from "../../src/lib/engine/dealer/rulebook.js";
import {
  type BinaryMidInputs,
  computeMid,
  type ForwardMidInputs,
  flagsSinceAnchor,
  type LiveInstrument,
  type MidFlag,
  midFromInputs,
  midInputs,
  sameMid,
  scoopValuationUsd,
} from "../../src/lib/services/dealer/compute-mids.js";
import { fixtureFlagsFor, utcDay } from "./event-flags-fixture.js";

/**
 * compute-mids' pure half. Anthropic is anchored on its Series G
 * (2026-02-12, $380B) so the fixture's Series H scoop (2026-05-12, $930B)
 * and release (2026-05-28) are news since the anchor; backtest/out/
 * prior_golden.json holds sim.py's outputs for that same interval.
 */
const ANCHOR = {
  anchor_round: "Series G",
  anchor_date: "2026-02-12",
  anchor_post_money_usd: "380000000000.00",
  anchor_source_url: "https://example.test/anthropic-series-g",
} as const;

const FLAGS: MidFlag[] = fixtureFlagsFor("anthropic", ["scoop", "release"]).map((flag) => ({
  id: flag.dedupe_key,
  kind: flag.kind,
  at: utcDay(flag.published_at),
  observed_at: utcDay(flag.observed_at),
  terms_json: flag.terms,
}));
const SCOOP_H = FLAGS.find(
  (flag) => flag.kind === "scoop" && flag.at.getTime() === Date.parse("2026-05-12"),
)!;
const RELEASE_H = FLAGS.find(
  (flag) => flag.kind === "release" && flag.at.getTime() === Date.parse("2026-05-28"),
)!;

const golden = JSON.parse(readFileSync("backtest/out/prior_golden.json", "utf8")) as {
  readonly binaries: readonly {
    company: string;
    last_print_date: string;
    listed: string;
    expiry: string;
    p_model: number;
  }[];
  readonly marks: readonly {
    company: string;
    last_print_date: string;
    date: string;
    mid: number;
  }[];
};

function instrument(
  kind: "binary" | "forward",
  opensAt: Date,
  company = "Anthropic",
): LiveInstrument {
  return {
    id: `${company}-${kind}`,
    kind,
    opens_at: opensAt,
    expires_at:
      kind === "binary"
        ? binaryExpiry(opensAt)
        : new Date(opensAt.getTime() + DEALER_PARAMS.forward_t_days.Anthropic! * 86_400_000),
    company_id: "company",
    company,
    tier: "mega",
    binary_event: company === "Anthropic" ? "public_s1" : "priced_round",
    p_floor: DEALER_PARAMS.dealer.p_floor,
    ...ANCHOR,
  };
}

const NOW = new Date("2026-10-21T12:00:00.000Z");

describe("compute-mids inputs", () => {
  it("reads the fixture's Series H scoop and release", () => {
    expect(SCOOP_H).toBeDefined();
    expect(RELEASE_H).toBeDefined();
    expect(scoopValuationUsd(SCOOP_H.terms_json)).toBe(930_000_000_000);
  });

  it("counts flags dated after the anchor's day and seen by now", () => {
    const news = flagsSinceAnchor(FLAGS, ANCHOR.anchor_date, NOW);
    expect(news.map((flag) => flag.id).sort()).toEqual([RELEASE_H.id, SCOOP_H.id].sort());
    expect(flagsSinceAnchor(FLAGS, ANCHOR.anchor_date, utcDay("2026-05-11"))).toEqual([]);
    // From an earlier anchor the Series G scoop (2026-01-07) and release count too.
    expect(flagsSinceAnchor(FLAGS, "2026-01-06", NOW).map((flag) => flag.kind)).toEqual([
      "scoop",
      "release",
      "scoop",
      "release",
    ]);
  });

  it("ignores a valuation that is missing, null or not positive", () => {
    expect(scoopValuationUsd({ valuation_basis: "unknown" })).toBeNull();
    expect(scoopValuationUsd({ valuation_usd: null, valuation_basis: null })).toBeNull();
    expect(scoopValuationUsd({ valuation_usd: 0, valuation_basis: "unknown" })).toBeNull();
  });
});

describe("compute-mids binary", () => {
  it("reproduces sim.py's binary seed prices for the interval", () => {
    const rows = golden.binaries.filter(
      (row) => row.company === "Anthropic" && row.last_print_date === "2026-02-12",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const mid = computeMid(instrument("binary", utcDay(row.listed)), FLAGS, NOW);
      expect(mid.inputs.kind).toBe("binary");
      expect((mid.inputs as BinaryMidInputs).expires_at.slice(0, 10)).toBe(row.expiry);
      expect(Math.abs(mid.value - row.p_model)).toBeLessThan(1e-9);
    }
  });

  it("raises p to the near leak hazard when a scoop precedes listing", () => {
    const opensAt = utcDay("2026-05-20");
    const mid = computeMid(instrument("binary", opensAt), FLAGS, NOW);
    const inputs = mid.inputs as BinaryMidInputs;
    expect(inputs.leak).toEqual({
      flag_id: SCOOP_H.id,
      kind: "scoop",
      at: SCOOP_H.at.toISOString(),
    });
    // 2026-06-30 is 49 days after the scoop, inside the 60-day window.
    expect(mid.value).toBe(
      Math.max(
        binaryProbability(
          {
            tier: "mega",
            lastPrintAt: utcDay("2026-02-12"),
            listedAt: opensAt,
            expiresAt: binaryExpiry(opensAt),
            leakAt: null,
          },
          DEALER_PARAMS.prior,
          DEALER_PARAMS.dealer.p_floor,
        ),
        DEALER_PARAMS.prior.leak_hazard_near,
      ),
    );
  });

  it("takes the latest scoop or release on or before listing, far from expiry", () => {
    const mid = computeMid(instrument("binary", utcDay("2026-10-22")), FLAGS, NOW);
    expect((mid.inputs as BinaryMidInputs).leak?.flag_id).toBe(RELEASE_H.id);
    expect(mid.value).toBe(DEALER_PARAMS.prior.leak_hazard_far);
  });

  it("notes the labs' S-1 binary uses the round-hazard prior, and names k and λ", () => {
    const inputs = midInputs(instrument("binary", utcDay("2026-04-01")), FLAGS, NOW);
    expect(inputs).toMatchObject({
      binary_event: "public_s1",
      k: DEALER_PARAMS.prior.weibull_k,
      lambda_months: DEALER_PARAMS.prior.cadence_months.mega,
      leak: null,
      note: expect.stringContaining("README D12"),
    });
    const other = midInputs(instrument("binary", utcDay("2026-04-01"), "Modal"), FLAGS, NOW);
    expect(other).not.toHaveProperty("note");
  });
});

describe("compute-mids forward", () => {
  it("reproduces sim.py's weekly mids, re-centring on the scoop's valuation", () => {
    const rows = golden.marks.filter(
      (row) => row.company === "Anthropic" && row.last_print_date === "2026-02-12",
    );
    expect(rows.some((row) => row.date >= "2026-05-12")).toBe(true);
    for (const row of rows) {
      const mid = computeMid(instrument("forward", utcDay("2026-02-12")), FLAGS, utcDay(row.date));
      expect(Math.abs(mid.value - row.mid)).toBeLessThan(1e-9);
    }
    const inputs = midInputs(instrument("forward", utcDay("2026-02-12")), FLAGS, NOW);
    expect((inputs as ForwardMidInputs).leak).toEqual({
      flag_id: SCOOP_H.id,
      at: SCOOP_H.at.toISOString(),
      valuation_usd: 930_000_000_000,
    });
  });

  it("uses the name's own μ, or the tier fallback for a name params.json does not list", () => {
    const own = midInputs(instrument("forward", utcDay("2026-02-12")), [], NOW) as ForwardMidInputs;
    expect(own).toMatchObject({
      mu: DEALER_PARAMS.prior.mu_stepup.Anthropic!.mega,
      mu_source: "company",
    });
    const other = midInputs(
      instrument("forward", utcDay("2026-02-12"), "Unlisted"),
      [],
      NOW,
    ) as ForwardMidInputs;
    expect(other).toMatchObject({
      mu: DEALER_PARAMS.prior.mu_stepup_fallback.mega,
      mu_source: "fallback",
    });
    expect(midFromInputs(own)).toBe(Math.log(380_000_000_000) + own.mu);
  });
});

describe("compute-mids storage", () => {
  const stored = (value: number, inputs: unknown, version = "1.0.0") => ({
    model_version: version,
    rulebook_version: RULEBOOK_VERSION,
    value,
    inputs: JSON.parse(JSON.stringify(inputs)) as JsonValue,
  });

  it("recomputes exactly from inputs that went through JSON", () => {
    for (const [kind, opens] of [
      ["binary", "2026-05-20"],
      ["forward", "2026-02-12"],
    ] as const) {
      const mid = computeMid(instrument(kind, utcDay(opens)), FLAGS, NOW);
      expect(midFromInputs(JSON.parse(JSON.stringify(mid.inputs)))).toBe(mid.value);
    }
  });

  it("skips a repeat that differs only in as_of, and writes anything else", () => {
    const forward = instrument("forward", utcDay("2026-02-12"));
    const first = computeMid(forward, FLAGS, NOW);
    const later = computeMid(forward, FLAGS, new Date(NOW.getTime() + 15 * 60_000));
    const reordered = Object.fromEntries(Object.entries(first.inputs).reverse());
    expect(sameMid(stored(first.value, reordered), later)).toBe(true);
    expect(sameMid(undefined, later)).toBe(false);
    expect(sameMid(stored(first.value, first.inputs, "0.9.0"), later)).toBe(false);
    expect(sameMid(stored(first.value + 1e-12, first.inputs), later)).toBe(false);

    const beforeScoop = computeMid(forward, FLAGS, utcDay("2026-05-11"));
    expect(sameMid(stored(beforeScoop.value, beforeScoop.inputs), first)).toBe(false);
  });
});
