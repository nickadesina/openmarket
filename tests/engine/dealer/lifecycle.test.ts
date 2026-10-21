import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEALER_PARAMS } from "../../../src/lib/config/dealer.js";
import {
  FLAG_KINDS,
  type FlagKind,
  flagWidens,
  type InstrumentSnapshot,
  type LifecycleEvent,
  transition,
} from "../../../src/lib/engine/dealer/lifecycle.js";
import {
  binaryExpiry,
  RULEBOOK,
  type RulebookEvent,
  resolveBinary,
  resolveForward,
} from "../../../src/lib/engine/dealer/rulebook.js";

/**
 * One fixture test per transition row of TECHNICAL_DESIGN.md §6. Every flag
 * comes from tests/fixtures/event-flags.json (decision 0001: no test invents
 * a flag); resolutions come from the rulebook over the fixture's prints.
 */
interface FixtureFlag {
  readonly company_slug: string;
  readonly kind: FlagKind;
  readonly published_at: string;
  readonly source_rank: 1 | 2 | 3 | 4 | null;
  readonly dedupe_key: string;
  readonly terms: { readonly valuation_usd?: number | null };
}

const FLAGS: readonly FixtureFlag[] = JSON.parse(
  readFileSync(new URL("../../fixtures/event-flags.json", import.meta.url), "utf8"),
).flags;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const PARAMS = { flagHours: DEALER_PARAMS.dealer.flag_hours };
const at = (flag: FixtureFlag) => new Date(`${flag.published_at}T00:00:00Z`);

function flag(company: string, kind: FlagKind, publishedAt: string): FixtureFlag {
  const found = FLAGS.find(
    (row) => row.company_slug === company && row.kind === kind && row.published_at === publishedAt,
  );
  if (found === undefined) throw new Error(`fixture has no ${company} ${kind} ${publishedAt}`);
  return found;
}

function flagEvent(row: FixtureFlag): LifecycleEvent {
  return { type: "flag", at: at(row), kind: row.kind };
}

/** The fixture's prints for a company, as the settle job will hand them to the rulebook. */
function printEvents(company: string): RulebookEvent[] {
  return FLAGS.filter((row) => row.company_slug === company && row.kind === "print").map((row) => ({
    id: row.dedupe_key,
    eventType: "priced_round",
    announcedAt: at(row),
    rank: row.source_rank ?? 1,
    postMoneyUsd: row.terms.valuation_usd ?? null,
  }));
}

function instrument(
  kind: "binary" | "forward",
  opensAt: Date,
  overrides: Partial<InstrumentSnapshot> = {},
): InstrumentSnapshot {
  const expiresAt =
    kind === "binary"
      ? binaryExpiry(opensAt)
      : new Date(opensAt.getTime() + DEALER_PARAMS.forward_t_days.Instinct! * DAY_MS);
  return { kind, state: "quoting", expiresAt, widenedAt: null, widenedUntil: null, ...overrides };
}

// Instinct's forward and binary, both listed at its Series B print (2026-08-26).
const INSTINCT_B = at(flag("instinct", "print", "2026-08-26"));
const INSTINCT_SCOOP = flag("instinct", "scoop", "2026-09-15");
const INSTINCT_C = flag("instinct", "print", "2026-09-28");

function widenedForward(): InstrumentSnapshot {
  return transition(instrument("forward", INSTINCT_B), flagEvent(INSTINCT_SCOOP), PARAMS)
    .instrument;
}

describe("flag kinds", () => {
  it("widens on scoop, form_d, form_d_amend, charter and release only", () => {
    const widening = FLAG_KINDS.filter(flagWidens);
    expect(widening).toEqual(["form_d", "form_d_amend", "charter", "scoop", "release"]);
    expect(FLAG_KINDS.filter((kind) => !flagWidens(kind))).toEqual([
      "s1_public",
      "print",
      "user_submitted",
    ]);
  });
});

describe("instrument lifecycle (TECHNICAL_DESIGN.md §6)", () => {
  it("quoting → widened: a scoop widens the forward for flag_hours; the binary is unchanged", () => {
    const flagAt = at(INSTINCT_SCOOP);
    const until = new Date(flagAt.getTime() + DEALER_PARAMS.dealer.flag_hours * HOUR_MS);

    const forward = transition(
      instrument("forward", INSTINCT_B),
      flagEvent(INSTINCT_SCOOP),
      PARAMS,
    );
    expect(forward.instrument).toMatchObject({
      state: "widened",
      widenedAt: flagAt,
      widenedUntil: until,
    });
    expect(forward.effects).toEqual([{ type: "widen", widenedUntil: until }]);

    // README D12: the binary's b is fixed for the quarter, so a flag changes nothing on it.
    const binary = transition(instrument("binary", INSTINCT_B), flagEvent(INSTINCT_SCOOP), PARAMS);
    expect(binary.instrument.state).toBe("quoting");
    expect(binary.effects).toEqual([]);

    // A print is not a widening: it resolves through the rulebook.
    const print = transition(instrument("forward", INSTINCT_B), flagEvent(INSTINCT_C), PARAMS);
    expect(print.instrument.state).toBe("quoting");
    expect(print.effects).toEqual([]);
  });

  it("widened → quoting: a newer mid or widened_until passing restores", () => {
    const widened = widenedForward();

    const staleMid = transition(widened, { type: "remid", at: widened.widenedAt! }, PARAMS);
    expect(staleMid.instrument.state).toBe("widened");
    expect(staleMid.effects).toEqual([]);

    const remid = new Date(widened.widenedAt!.getTime() + HOUR_MS);
    const repriced = transition(widened, { type: "remid", at: remid }, PARAMS);
    expect(repriced.instrument).toMatchObject({
      state: "quoting",
      widenedAt: null,
      widenedUntil: null,
    });
    expect(repriced.effects).toEqual([{ type: "restore" }]);

    const early = new Date(widened.widenedUntil!.getTime() - 1);
    expect(transition(widened, { type: "tick", now: early }, PARAMS).instrument.state).toBe(
      "widened",
    );
    const lapsed = transition(widened, { type: "tick", now: widened.widenedUntil! }, PARAMS);
    expect(lapsed.instrument.state).toBe("quoting");
    expect(lapsed.effects).toEqual([{ type: "restore" }]);
  });

  it("quoting/widened → resolved: a print dated ≤ expiry settles the forward and YES-resolves the binary", () => {
    const asOf = at(INSTINCT_C);
    const events = printEvents("instinct");

    const forward = widenedForward();
    const forwardResolution = resolveForward(
      { binaryEvent: "priced_round", opensAt: INSTINCT_B, expiresAt: forward.expiresAt },
      events,
      asOf,
    );
    const settledLn = Math.log(10e9);
    const settled = transition(
      forward,
      { type: "resolve", at: asOf, resolution: forwardResolution },
      PARAMS,
    );
    expect(settled.instrument).toMatchObject({
      state: "resolved",
      widenedAt: null,
      widenedUntil: null,
    });
    expect(settled.effects).toEqual([
      {
        type: "settle",
        instrument: "forward",
        eventId: INSTINCT_C.dedupe_key,
        at: asOf,
        rank: 1,
        settleLn: settledLn,
        final: true,
      },
      { type: "list_successor", instrument: "forward", listedAt: asOf, anchorLn: settledLn },
    ]);

    const binary = instrument("binary", INSTINCT_B);
    const binaryResolution = resolveBinary(
      { binaryEvent: "priced_round", opensAt: INSTINCT_B, cutoff: binary.expiresAt },
      events,
      asOf,
    );
    const yes = transition(
      binary,
      { type: "resolve", at: asOf, resolution: binaryResolution },
      PARAMS,
    );
    expect(yes.instrument.state).toBe("resolved");
    expect(yes.effects).toEqual([
      {
        type: "settle",
        instrument: "binary",
        outcome: "yes",
        eventId: INSTINCT_C.dedupe_key,
        at: asOf,
      },
      { type: "list_successor", instrument: "binary", listedAt: asOf, anchorLn: null },
    ]);
  });

  it("quoting/widened → expired: no print by expiry voids the forward and pays the binary NO", () => {
    // Anduril after its Series E (2022-12-02): no print until 2024-08-07, past both expiries.
    const listed = at(flag("anduril", "print", "2022-12-02"));
    const events = printEvents("anduril");
    const forward: InstrumentSnapshot = {
      kind: "forward",
      state: "quoting",
      expiresAt: new Date(listed.getTime() + DEALER_PARAMS.forward_t_days.Anduril! * DAY_MS),
      widenedAt: null,
      widenedUntil: null,
    };
    const binary = instrument("binary", listed);
    const graceMs = RULEBOOK.observation_grace_days * DAY_MS;

    // Inside the grace day an announcement dated ≤ T may still arrive: nothing happens yet.
    const inGrace = new Date(forward.expiresAt.getTime() + graceMs);
    expect(transition(forward, { type: "tick", now: inGrace }, PARAMS).effects).toEqual([]);

    const forwardNow = new Date(forward.expiresAt.getTime() + graceMs + 1);
    const voided = transition(forward, { type: "tick", now: forwardNow }, PARAMS);
    expect(voided.instrument.state).toBe("expired");
    expect(voided.effects).toEqual([
      { type: "void" },
      { type: "list_successor", instrument: "forward", listedAt: forwardNow, anchorLn: null },
    ]);
    const forwardResolution = resolveForward(
      { binaryEvent: "priced_round", opensAt: listed, expiresAt: forward.expiresAt },
      events,
      forwardNow,
    );
    expect(
      transition(
        forward,
        { type: "resolve", at: forwardNow, resolution: forwardResolution },
        PARAMS,
      ),
    ).toEqual(voided);

    const binaryNow = new Date(binary.expiresAt.getTime() + graceMs + 1);
    const no = transition(binary, { type: "tick", now: binaryNow }, PARAMS);
    expect(no.instrument.state).toBe("expired");
    expect(no.effects).toEqual([
      { type: "pay_no" },
      { type: "list_successor", instrument: "binary", listedAt: binaryNow, anchorLn: null },
    ]);
    const binaryResolution = resolveBinary(
      { binaryEvent: "priced_round", opensAt: listed, cutoff: binary.expiresAt },
      events,
      binaryNow,
    );
    expect(
      transition(binary, { type: "resolve", at: binaryNow, resolution: binaryResolution }, PARAMS),
    ).toEqual(no);
  });

  it("resolved/expired → new instrument: every terminal transition lists a successor", () => {
    const asOf = at(INSTINCT_C);
    const resolution = resolveForward(
      { binaryEvent: "priced_round", opensAt: INSTINCT_B, expiresAt: widenedForward().expiresAt },
      printEvents("instinct"),
      asOf,
    );
    const terminals = [
      transition(widenedForward(), { type: "resolve", at: asOf, resolution }, PARAMS),
      transition(
        instrument("binary", INSTINCT_B),
        { type: "tick", now: new Date("2027-01-01T00:00:00.001Z") },
        PARAMS,
      ),
    ];
    for (const result of terminals) {
      expect(["resolved", "expired"]).toContain(result.instrument.state);
      expect(result.effects.at(-1)).toMatchObject({
        type: "list_successor",
        instrument: result.instrument.kind,
      });
    }
  });
});

describe("terminal states", () => {
  const terminal = (state: "resolved" | "expired") => instrument("forward", INSTINCT_B, { state });
  const later = new Date("2030-01-01T00:00:00Z");
  const events: LifecycleEvent[] = [
    flagEvent(INSTINCT_SCOOP),
    { type: "remid", at: later },
    { type: "tick", now: later },
    {
      type: "resolve",
      at: later,
      resolution: { status: "settled", eventId: "x", at: later, rank: 1, settleLn: 1, final: true },
    },
  ];

  for (const state of ["resolved", "expired"] as const) {
    it(`${state} ignores every later event, so a replayed job cannot settle or roll twice`, () => {
      for (const event of events) {
        const result = transition(terminal(state), event, PARAMS);
        expect(result.instrument).toEqual(terminal(state));
        expect(result.effects).toEqual([]);
      }
    });
  }
});

describe("lifecycle guards", () => {
  it("extends the window on a later flag and keeps it on an earlier one", () => {
    const widened = widenedForward();
    const second = flag("instinct", "release", "2026-09-28");
    const extended = transition(widened, flagEvent(second), PARAMS);
    expect(extended.instrument.widenedUntil!.getTime()).toBe(
      at(second).getTime() + DEALER_PARAMS.dealer.flag_hours * HOUR_MS,
    );
    expect(extended.effects).toHaveLength(1);

    const earlier = flag("instinct", "scoop", "2026-08-26");
    const kept = transition(widened, flagEvent(earlier), PARAMS);
    expect(kept.instrument).toEqual(widened);
    expect(kept.effects).toEqual([]);
  });

  it("rejects inconsistent snapshots and resolutions of the wrong instrument", () => {
    const binary = instrument("binary", INSTINCT_B);
    expect(() =>
      transition(
        { ...binary, state: "widened", widenedAt: INSTINCT_B, widenedUntil: INSTINCT_B },
        {
          type: "tick",
          now: INSTINCT_B,
        },
        PARAMS,
      ),
    ).toThrow(RangeError);
    expect(() =>
      transition(
        instrument("forward", INSTINCT_B, { state: "widened" }),
        {
          type: "tick",
          now: INSTINCT_B,
        },
        PARAMS,
      ),
    ).toThrow(RangeError);
    expect(() =>
      transition(
        binary,
        { type: "resolve", at: INSTINCT_B, resolution: { status: "void" } },
        PARAMS,
      ),
    ).toThrow(RangeError);
    expect(() => transition(binary, { type: "tick", now: new Date(Number.NaN) }, PARAMS)).toThrow(
      RangeError,
    );
  });
});
