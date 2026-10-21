import { describe, expect, it } from "vitest";

import {
  isPrint,
  postMoneyUsd,
  pressRank,
  quarterEndCutoff,
  type RulebookEvent,
  resolveBinary,
  resolveForward,
} from "../../../src/lib/engine/dealer/rulebook.js";

const at = (iso: string) => new Date(iso);

function event(overrides: Partial<RulebookEvent> & Pick<RulebookEvent, "id">): RulebookEvent {
  return {
    eventType: "priced_round",
    announcedAt: at("2026-11-10T12:00:00Z"),
    rank: 1,
    postMoneyUsd: 20e9,
    ...overrides,
  };
}

const forward = {
  binaryEvent: "priced_round" as const,
  opensAt: at("2026-10-01T00:00:00Z"),
  expiresAt: at("2027-01-29T00:00:00Z"),
};
const binary = {
  binaryEvent: "priced_round" as const,
  opensAt: at("2026-10-01T00:00:00Z"),
  cutoff: quarterEndCutoff(at("2026-10-01T00:00:00Z")),
};

describe("postMoneyUsd", () => {
  it("takes a post-money as stated and converts pre-money plus the amount raised", () => {
    expect(postMoneyUsd({ valuation_usd: 10e9, valuation_basis: "post" })).toBe(10e9);
    expect(postMoneyUsd({ valuation_usd: 10e9, amount_usd: 2e9, valuation_basis: "pre" })).toBe(
      12e9,
    );
  });

  it("treats a missing amount, an unknown basis, or no valuation as undisclosed", () => {
    expect(postMoneyUsd({ valuation_usd: 10e9, valuation_basis: "pre" })).toBeNull();
    expect(postMoneyUsd({ valuation_usd: 10e9, valuation_basis: "unknown" })).toBeNull();
    expect(postMoneyUsd({ amount_usd: 2e9, valuation_basis: "post" })).toBeNull();
  });

  it("refuses non-finite figures rather than settling at infinity", () => {
    expect(
      postMoneyUsd({
        valuation_usd: 1e9,
        amount_usd: Number.POSITIVE_INFINITY,
        valuation_basis: "pre",
      }),
    ).toBeNull();
    expect(
      postMoneyUsd({ valuation_usd: 1e308, amount_usd: 1e308, valuation_basis: "pre" }),
    ).toBeNull();
  });
});

describe("pressRank", () => {
  it("counts distinct Tier-1 outlets, syndications once, others not at all", () => {
    expect(pressRank(["Bloomberg", "Bloomberg News"])).toBe(4);
    expect(pressRank(["WSJ", "The Information"])).toBe(3);
    expect(pressRank(["Some Blog"])).toBeNull();
    expect(pressRank([" the  Financial Times ", "Wall St. Journal"])).toBe(3);
  });
});

describe("what counts as a print", () => {
  it("is a priced round, plus an IPO for the labs; never a tender or an S-1", () => {
    expect(isPrint("priced_round", "priced_round")).toBe(true);
    expect(isPrint("ipo", "public_s1")).toBe(true);
    expect(isPrint("ipo", "priced_round")).toBe(false);
    expect(isPrint("tender_or_secondary", "priced_round")).toBe(false);
    expect(isPrint("public_s1", "public_s1")).toBe(false);
  });
});

describe("quarterEndCutoff", () => {
  it("is the last millisecond of the quarter's last day, UTC", () => {
    expect(quarterEndCutoff(at("2026-10-21T08:00:00Z")).toISOString()).toBe(
      "2026-12-31T23:59:59.999Z",
    );
    expect(quarterEndCutoff(at("2026-02-01T00:00:00Z")).toISOString()).toBe(
      "2026-03-31T23:59:59.999Z",
    );
  });
});

describe("resolveBinary", () => {
  it("resolves YES on a round with an undisclosed valuation", () => {
    const round = event({ id: "a", postMoneyUsd: null });
    expect(resolveBinary(binary, [round], at("2026-11-11T00:00:00Z"))).toMatchObject({
      status: "yes",
      eventId: "a",
    });
  });

  it("ignores tenders, and stays open until a day after quarter-end", () => {
    const tender = event({ id: "t", eventType: "tender_or_secondary" });
    expect(resolveBinary(binary, [tender], at("2027-01-01T12:00:00Z")).status).toBe("open");
    expect(resolveBinary(binary, [tender], at("2027-01-02T00:00:00Z")).status).toBe("no");
  });

  it("resolves a lab's binary on a public S-1, not on a round", () => {
    const lab = { ...binary, binaryEvent: "public_s1" as const };
    const round = event({ id: "r" });
    const s1 = event({ id: "s1", eventType: "public_s1", announcedAt: at("2026-12-15T00:00:00Z") });
    expect(resolveBinary(lab, [round], at("2027-01-05T00:00:00Z")).status).toBe("no");
    expect(resolveBinary(lab, [round, s1], at("2027-01-05T00:00:00Z"))).toMatchObject({
      status: "yes",
      eventId: "s1",
    });
  });
});

describe("resolveForward", () => {
  it("settles on the first print at ln(post-money)", () => {
    const resolution = resolveForward(forward, [event({ id: "a" })], at("2026-11-30T00:00:00Z"));
    expect(resolution).toMatchObject({ status: "settled", eventId: "a", final: true });
    expect(resolution.status === "settled" && resolution.settleLn).toBe(Math.log(20e9));
  });

  it("waits through an undisclosed valuation and voids at expiry", () => {
    const undisclosed = event({ id: "u", postMoneyUsd: null });
    expect(resolveForward(forward, [undisclosed], at("2027-01-29T12:00:00Z")).status).toBe("open");
    expect(resolveForward(forward, [undisclosed], at("2027-01-30T00:00:01Z")).status).toBe("void");
  });

  it("lets a higher-ranked source inside seven days supersede, and nothing after", () => {
    const scoop = event({ id: "press", rank: 4, postMoneyUsd: 18e9 });
    const release = event({ id: "release", rank: 1, announcedAt: at("2026-11-15T00:00:00Z") });
    const late = event({ id: "late", rank: 1, announcedAt: at("2026-11-20T00:00:00Z") });
    expect(resolveForward(forward, [scoop], at("2026-11-11T00:00:00Z"))).toMatchObject({
      eventId: "press",
      final: false,
    });
    expect(resolveForward(forward, [scoop, release], at("2026-11-30T00:00:00Z"))).toMatchObject({
      eventId: "release",
      final: true,
    });
    expect(resolveForward(forward, [scoop, late], at("2026-11-30T00:00:00Z"))).toMatchObject({
      eventId: "press",
    });
  });

  it("is final at once on a rank-1 source, and otherwise only after window and grace", () => {
    const release = event({ id: "release", rank: 1 });
    expect(resolveForward(forward, [release], at("2026-11-11T00:00:00Z"))).toMatchObject({
      final: true,
    });
    const press = event({ id: "press", rank: 4 });
    // First print 11-10 12:00: the window closes 11-17 12:00, the grace a day later.
    expect(resolveForward(forward, [press], at("2026-11-18T00:00:00Z"))).toMatchObject({
      final: false,
    });
    expect(resolveForward(forward, [press], at("2026-11-18T12:00:01Z"))).toMatchObject({
      final: true,
    });
  });

  it("accepts a higher-ranked revision dated after expiry", () => {
    const press = event({ id: "press", rank: 4, announcedAt: at("2027-01-28T00:00:00Z") });
    const release = event({ id: "release", rank: 1, announcedAt: at("2027-01-30T00:00:00Z") });
    expect(resolveForward(forward, [press, release], at("2027-02-10T00:00:00Z"))).toMatchObject({
      status: "settled",
      eventId: "release",
    });
  });

  it("settles on an acquisition's disclosed equity value and voids on an undisclosed one", () => {
    const disclosed = event({ id: "acq", eventType: "acquisition", postMoneyUsd: 30e9 });
    expect(resolveForward(forward, [disclosed], at("2026-11-11T00:00:00Z"))).toMatchObject({
      status: "settled",
      eventId: "acq",
    });
    const blind = event({ id: "acq", eventType: "acquisition", postMoneyUsd: null });
    expect(resolveForward(forward, [blind], at("2026-11-11T00:00:00Z")).status).toBe("void");
  });

  it("never settles on the print it was anchored on", () => {
    const anchor = event({ id: "anchor", announcedAt: forward.opensAt });
    expect(resolveForward(forward, [anchor], at("2026-11-30T00:00:00Z")).status).toBe("open");
  });
});
