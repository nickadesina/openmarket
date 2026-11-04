import { describe, expect, it } from "vitest";

import {
  isPrint,
  isRepricing,
  isSourceClass,
  lastPrint,
  observationDate,
  observedQuarterEnd,
  postMoneyUsd,
  pressRank,
  quarterEndCutoff,
  RULEBOOK,
  type RulebookEvent,
  resolveNextRound,
  resolvePrints,
  resolveRepricing,
  SOURCE_CLASSES,
  SOURCE_PURPOSES,
  sourceRank,
} from "../../src/lib/engine/rulebook.js";

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

/**
 * `source_documents.source_class` as docs/prompts/v2/README.md (the shared
 * contract for migration 020_marks_index) lists it. A class added to the
 * migration is added here and to the rulebook in the same commit.
 */
const MIGRATION_SOURCE_CLASSES = [
  "ncsr",
  "nport",
  "fund_holdings_page",
  "closed_end_nav",
  "delaware_coi",
  "form_d",
  "spv_quote_page",
  "company_statement",
  "press",
];

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

  it("refuses non-finite figures rather than recording infinity", () => {
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
    expect(isPrint("priced_round", "company")).toBe(true);
    expect(isPrint("ipo", "lab")).toBe(true);
    expect(isPrint("ipo", "company")).toBe(false);
    expect(isPrint("tender_or_secondary", "company")).toBe(false);
    expect(isPrint("public_s1", "lab")).toBe(false);
  });

  it("is narrower than what reprices a name", () => {
    for (const type of ["priced_round", "tender_or_secondary", "public_s1", "ipo", "acquisition"]) {
      expect(isRepricing(type as RulebookEvent["eventType"])).toBe(true);
    }
    for (const type of ["same_price_extension", "safe_or_note", "debt"] as const) {
      expect(isRepricing(type)).toBe(false);
    }
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

describe("observedQuarterEnd and observationDate", () => {
  it("observes this quarter with at least 21 days left, otherwise the next", () => {
    expect(observedQuarterEnd(at("2026-12-10T15:00:00Z")).toISOString()).toBe(
      "2026-12-31T23:59:59.999Z",
    );
    expect(observedQuarterEnd(at("2026-12-11T00:00:00Z")).toISOString()).toBe(
      "2027-03-31T23:59:59.999Z",
    );
    expect(observedQuarterEnd(at("2026-09-30T23:59:59.999Z")).toISOString()).toBe(
      "2026-12-31T23:59:59.999Z",
    );
  });

  it("reads the index at 00:00 UTC on the 75th day after the quarter's last day", () => {
    expect(RULEBOOK.contracts.observation_lag_days).toBe(75);
    expect(observationDate(at("2026-12-31T23:59:59.999Z")).toISOString()).toBe(
      "2027-03-16T00:00:00.000Z",
    );
  });
});

describe("resolveRepricing", () => {
  const window = {
    opensAt: at("2026-10-01T00:00:00Z"),
    cutoff: quarterEndCutoff(at("2026-10-01T00:00:00Z")),
  };

  it("voids on a round with an undisclosed valuation, and on a tender", () => {
    const round = event({ id: "a", postMoneyUsd: null });
    expect(resolveRepricing(window, [round], at("2026-11-11T00:00:00Z"))).toMatchObject({
      status: "void",
      eventId: "a",
    });
    const tender = event({ id: "t", eventType: "tender_or_secondary" });
    expect(resolveRepricing(window, [tender], at("2026-11-11T00:00:00Z")).status).toBe("void");
  });

  it("ignores debt and notes, and stays open until a day after quarter-end", () => {
    const debt = event({ id: "d", eventType: "debt" });
    const note = event({ id: "n", eventType: "safe_or_note" });
    expect(resolveRepricing(window, [debt, note], at("2027-01-01T12:00:00Z")).status).toBe("open");
    expect(resolveRepricing(window, [debt, note], at("2027-01-02T00:00:00Z")).status).toBe("clear");
  });

  it("counts nothing at the listing instant or after the cutoff", () => {
    const atListing = event({ id: "l", announcedAt: window.opensAt });
    const after = event({ id: "x", announcedAt: at("2027-01-01T00:00:00Z") });
    expect(resolveRepricing(window, [atListing, after], at("2027-02-01T00:00:00Z")).status).toBe(
      "clear",
    );
  });
});

describe("resolveNextRound", () => {
  const window = { opensAt: at("2026-10-01T00:00:00Z"), cutoff: at("2027-06-30T23:59:59.999Z") };

  it("settles on the first priced round, valuation disclosed or not, and a tender does not void", () => {
    const tender = event({ id: "t", eventType: "tender_or_secondary" });
    const round = event({ id: "r", postMoneyUsd: null, announcedAt: at("2026-12-01T00:00:00Z") });
    expect(resolveNextRound(window, [tender, round], at("2026-12-02T00:00:00Z"))).toEqual({
      status: "round",
      eventId: "r",
      at: round.announcedAt,
    });
  });

  it("voids on an exit before the round, and on no print by the deadline and grace", () => {
    const acquisition = event({ id: "acq", eventType: "acquisition" });
    const later = event({ id: "r", announcedAt: at("2026-12-01T00:00:00Z") });
    expect(resolveNextRound(window, [later, acquisition], at("2027-01-01T00:00:00Z"))).toEqual({
      status: "void",
      reason: "exit",
      eventId: "acq",
    });
    expect(resolveNextRound(window, [], at("2027-07-01T12:00:00Z")).status).toBe("open");
    expect(resolveNextRound(window, [], at("2027-07-02T00:00:00Z"))).toEqual({
      status: "void",
      reason: "no_print",
    });
  });

  it("ignores a round at the listing instant or after the deadline", () => {
    const atListing = event({ id: "l", announcedAt: window.opensAt });
    const late = event({ id: "x", announcedAt: at("2027-07-01T00:00:00Z") });
    expect(resolveNextRound(window, [atListing, late], at("2027-08-01T00:00:00Z"))).toEqual({
      status: "void",
      reason: "no_print",
    });
  });
});

describe("resolvePrints and lastPrint", () => {
  it("records a print at its post-money, final at once on a rank-1 source", () => {
    const prints = resolvePrints("company", [event({ id: "a" })], at("2026-11-30T00:00:00Z"));
    expect(prints).toEqual([
      {
        eventId: "a",
        at: at("2026-11-10T12:00:00Z"),
        firstAt: at("2026-11-10T12:00:00Z"),
        rank: 1,
        postMoneyUsd: 20e9,
        final: true,
      },
    ]);
  });

  it("skips a round whose valuation is undisclosed: no print, so lastPrint is null", () => {
    const undisclosed = event({ id: "u", postMoneyUsd: null });
    expect(lastPrint("company", [undisclosed], at("2027-01-30T00:00:00Z"))).toBeNull();
  });

  it("lets a higher-ranked source inside seven days supersede, and nothing after", () => {
    const scoop = event({ id: "press", rank: 4, postMoneyUsd: 18e9 });
    const release = event({ id: "release", rank: 1, announcedAt: at("2026-11-15T00:00:00Z") });
    const late = event({ id: "late", rank: 1, announcedAt: at("2026-11-20T00:00:00Z") });
    expect(lastPrint("company", [scoop], at("2026-11-11T00:00:00Z"))).toMatchObject({
      eventId: "press",
      final: false,
    });
    expect(lastPrint("company", [scoop, release], at("2026-11-30T00:00:00Z"))).toMatchObject({
      eventId: "release",
      firstAt: scoop.announcedAt,
      postMoneyUsd: 20e9,
      final: true,
    });
    // A report after the window is the next print, not a revision of this one.
    expect(
      resolvePrints("company", [scoop, late], at("2026-11-30T00:00:00Z")).map((p) => p.eventId),
    ).toEqual(["press", "late"]);
  });

  it("is final, below rank 1, only after the window and the grace", () => {
    const press = event({ id: "press", rank: 4 });
    // First report 11-10 12:00: the window closes 11-17 12:00, the grace a day later.
    expect(lastPrint("company", [press], at("2026-11-18T00:00:00Z"))).toMatchObject({
      final: false,
    });
    expect(lastPrint("company", [press], at("2026-11-18T12:00:01Z"))).toMatchObject({
      final: true,
    });
  });

  it("keeps the first among equal ranks, and ignores reports after asOf", () => {
    const first = event({ id: "first", rank: 3 });
    const second = event({ id: "second", rank: 3, announcedAt: at("2026-11-12T00:00:00Z") });
    expect(lastPrint("company", [second, first], at("2026-11-30T00:00:00Z"))?.eventId).toBe(
      "first",
    );
    expect(lastPrint("company", [first], at("2026-11-01T00:00:00Z"))).toBeNull();
  });

  it("never counts an acquisition, and counts an IPO for a lab only", () => {
    const acquisition = event({ id: "acq", eventType: "acquisition", postMoneyUsd: 30e9 });
    const ipo = event({ id: "ipo", eventType: "ipo", postMoneyUsd: 900e9 });
    expect(lastPrint("company", [acquisition, ipo], at("2026-12-01T00:00:00Z"))).toBeNull();
    expect(lastPrint("lab", [acquisition, ipo], at("2026-12-01T00:00:00Z"))?.eventId).toBe("ipo");
  });

  it("refuses an invalid date", () => {
    const bad = event({ id: "bad", announcedAt: new Date(Number.NaN) });
    expect(() => resolvePrints("company", [bad], at("2026-12-01T00:00:00Z"))).toThrow(RangeError);
  });
});

describe("the mark-side source classes", () => {
  it("covers every source_class in the migration enum, each once", () => {
    expect([...SOURCE_CLASSES]).toEqual(MIGRATION_SOURCE_CLASSES);
    const tabled = RULEBOOK.source_classes.map((row) => row.source_class);
    expect(tabled).toEqual(MIGRATION_SOURCE_CLASSES);
    for (const row of RULEBOOK.source_classes) {
      expect(row.document.length).toBeGreaterThan(0);
      expect(row.cadence.length).toBeGreaterThan(0);
      expect(row.lag.length).toBeGreaterThan(0);
      expect(["free", "paid_per_document", "public_page"]).toContain(row.access);
    }
  });

  it("states every purpose once, with ranks unique within it", () => {
    expect(RULEBOOK.source_purposes.map((row) => row.purpose)).toEqual([...SOURCE_PURPOSES]);
    for (const { ranks } of RULEBOOK.source_purposes) {
      const numbers = ranks.map((row) => row.rank);
      const classes = ranks.map((row) => row.source_class);
      expect(new Set(numbers).size).toBe(numbers.length);
      expect(new Set(classes).size).toBe(classes.length);
      expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
      expect(numbers[0]).toBe(1);
    }
  });

  it("ranks every class in its own purpose, which sourceRank answers by default", () => {
    for (const row of RULEBOOK.source_classes) {
      const purpose = RULEBOOK.source_purposes.find((entry) => entry.purpose === row.purpose);
      const ranked = purpose?.ranks.find((entry) => entry.source_class === row.source_class);
      expect(ranked).toBeDefined();
      expect(sourceRank(row.source_class)).toBe(ranked!.rank);
      expect(sourceRank(row.source_class, row.purpose)).toBe(ranked!.rank);
    }
  });

  it("puts the audited N-CSR above the N-PORT and the certificate first for price", () => {
    expect(sourceRank("ncsr")).toBe(1);
    expect(sourceRank("nport")).toBe(2);
    expect(sourceRank("ncsr", "filer_mark")).toBeLessThan(sourceRank("nport", "filer_mark"));
    expect(sourceRank("delaware_coi")).toBe(1);
    expect(sourceRank("delaware_coi", "print_price_and_terms")).toBe(1);
  });

  it("answers another purpose when asked, and refuses one the class cannot establish", () => {
    expect(sourceRank("form_d")).toBe(1);
    expect(sourceRank("form_d", "round_size_and_date")).toBe(2);
    expect(sourceRank("spv_quote_page", "spv_existence_and_terms")).toBe(2);
    expect(() => sourceRank("press", "filer_mark")).toThrow(RangeError);
    expect(() => sourceRank("nport", "unit_quote")).toThrow(RangeError);
    expect(() => sourceRank("vendor" as never)).toThrow(RangeError);
  });

  it("restates the print-side ranks for a round's size and date", () => {
    const bySource = new Map(RULEBOOK.source_ranks.map((row) => [row.source, row.rank]));
    expect(sourceRank("company_statement", "round_size_and_date")).toBe(
      bySource.get("Company or lead-investor release"),
    );
    expect(sourceRank("form_d", "round_size_and_date")).toBe(bySource.get("SEC filing"));
    expect(sourceRank("press")).toBe(pressRank(["Reuters"]));
  });

  it("recognises a stored class string", () => {
    expect(isSourceClass("nport")).toBe(true);
    expect(isSourceClass("forge")).toBe(false);
  });
});
