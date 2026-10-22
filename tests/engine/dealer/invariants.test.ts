import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEALER_PARAMS } from "../../../src/lib/config/dealer.js";
import {
  FLAG_KINDS,
  type FlagKind,
  type InstrumentSnapshot,
  type LifecycleEvent,
  transition,
} from "../../../src/lib/engine/dealer/lifecycle.js";
import { binaryProbability, TIERS } from "../../../src/lib/engine/dealer/prior.js";
import { binaryExpiry } from "../../../src/lib/engine/dealer/rulebook.js";

const DAY_MS = 86_400_000;
const OPTIONS = { numRuns: 256, seed: 0xc1 };
const date = fc
  .integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2090, 11, 31) })
  .map((time) => new Date(time));
const action = fc.record({
  kind: fc.constantFrom(...FLAG_KINDS),
  step: fc.integer({ min: 0, max: 400 }),
  type: fc.constantFrom("flag", "tick", "remid", "resolve"),
});

function eventFor(
  step: { type: string; kind: FlagKind },
  at: Date,
  kind: "binary" | "forward",
): LifecycleEvent {
  if (step.type === "flag") return { type: "flag", at, kind: step.kind };
  if (step.type === "tick") return { type: "tick", now: at };
  if (step.type === "remid") return { type: "remid", at };
  return {
    type: "resolve",
    at,
    resolution:
      kind === "binary"
        ? { status: "yes", eventId: "print", at }
        : { status: "settled", eventId: "print", at, rank: 1, settleLn: 20, final: true },
  };
}

describe("documented dealer invariants", () => {
  it("only follows lifecycle edges, never reopens, and rolls exactly once", () => {
    fc.assert(
      fc.property(
        date,
        fc.constantFrom("binary" as const, "forward" as const),
        fc.array(action, { minLength: 1, maxLength: 40 }),
        (opens, kind, actions) => {
          let current: InstrumentSnapshot = {
            kind,
            state: "quoting",
            expiresAt: new Date(opens.getTime() + 180 * DAY_MS),
            widenedAt: null,
            widenedUntil: null,
          };
          const allowed = {
            quoting: ["quoting", "widened", "resolved", "expired"],
            widened: ["widened", "quoting", "resolved", "expired"],
            resolved: ["resolved"],
            expired: ["expired"],
          };
          let successors = 0;
          let time = opens.getTime();
          for (const action of actions) {
            time += action.step * DAY_MS;
            const result = transition(current, eventFor(action, new Date(time), kind), {
              flagHours: DEALER_PARAMS.dealer.flag_hours,
            });
            expect(allowed[current.state]).toContain(result.instrument.state);
            if (kind === "binary") expect(result.instrument.state).not.toBe("widened");
            if (["resolved", "expired"].includes(current.state)) expect(result.effects).toEqual([]);
            successors += result.effects.filter(
              (effect) => effect.type === "list_successor",
            ).length;
            expect(successors).toBeLessThanOrEqual(1);
            current = result.instrument;
          }
          expect(successors).toBe(["resolved", "expired"].includes(current.state) ? 1 : 0);
        },
      ),
      OPTIONS,
    );
  });
  it("always expires at a UTC quarter end at least 21 days after listing", () => {
    fc.assert(
      fc.property(date, (listedAt) => {
        const expiry = binaryExpiry(listedAt);
        expect(expiry.getTime() - listedAt.getTime()).toBeGreaterThanOrEqual(21 * DAY_MS);
        expect([2, 5, 8, 11]).toContain(expiry.getUTCMonth());
        expect(expiry.toISOString().slice(11)).toBe("23:59:59.999Z");
        const nextDay = new Date(expiry.getTime() + 1);
        expect(nextDay.getUTCDate()).toBe(1);
        expect(nextDay.getUTCMonth()).toBe((expiry.getUTCMonth() + 1) % 12);
      }),
      OPTIONS,
    );
  });
  it("has non-decreasing hazard as time since the last print increases, over the same horizon", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TIERS),
        fc.integer({ min: 0, max: 3650 }),
        fc.integer({ min: 0, max: 3650 }),
        fc.integer({ min: 1, max: 365 }),
        (tier, age, later, horizon) => {
          const listedAt = new Date("2026-01-01Z");
          const base = {
            tier,
            listedAt,
            lastPrintAt: new Date(listedAt.getTime() - age * DAY_MS),
            expiresAt: new Date(listedAt.getTime() + horizon * DAY_MS),
            leakAt: null,
          };
          const initial = binaryProbability(
            base,
            DEALER_PARAMS.prior,
            DEALER_PARAMS.dealer.p_floor,
          );
          const older = binaryProbability(
            { ...base, lastPrintAt: new Date(base.lastPrintAt.getTime() - later * DAY_MS) },
            DEALER_PARAMS.prior,
            DEALER_PARAMS.dealer.p_floor,
          );
          expect(older + 1e-12).toBeGreaterThanOrEqual(initial);
          const leaked = binaryProbability(
            { ...base, leakAt: listedAt },
            DEALER_PARAMS.prior,
            DEALER_PARAMS.dealer.p_floor,
          );
          expect(leaked).toBeGreaterThanOrEqual(initial);
        },
      ),
      OPTIONS,
    );
  });
});
