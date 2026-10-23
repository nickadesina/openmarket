import { describe, expect, it } from "vitest";
import {
  type ForwardQuote,
  fill,
  maxFillCents,
  quote,
} from "../../src/lib/engine/dealer/forward.js";
import {
  binaryExpiry,
  quarterEndCutoff,
  type RulebookEvent,
  resolveBinary,
  resolveForward,
} from "../../src/lib/engine/dealer/rulebook.js";
import { probabilitiesAbove } from "../../src/lib/engine/distribution.js";
import { binaryScore, forwardScore, pointLogScore } from "../../src/lib/engine/tournament/score.js";

const invalidDate = new Date(Number.NaN);
const day = new Date("2026-01-01Z");
const end = new Date("2026-03-31Z");
const terms = { binaryEvent: "priced_round" as const, opensAt: day, expiresAt: end, cutoff: end };
const event: RulebookEvent = {
  id: "event",
  eventType: "priced_round",
  announcedAt: day,
  rank: 1,
  postMoneyUsd: 1e9,
};
const validQuote = quote({
  midLn: 20,
  inventoryCents: 0,
  capCents: 10000,
  kappa: 1,
  gamma: 0.5,
  sFloor: 0.05,
  sigmaTier: 0.35,
  widened: false,
  flagSpreadMult: 3,
  flagCapMult: 0.5,
});

describe("public engine boundaries", () => {
  it.each([NaN, Infinity, -Infinity, -0.1, 1.1])("rejects invalid probabilities %s", (p) => {
    expect(() => pointLogScore(p, 2)).toThrow(RangeError);
    expect(() => binaryScore(p, "yes")).toThrow(RangeError);
    expect(() => binaryScore(p, "no")).toThrow(RangeError);
  });
  it.each([NaN, Infinity, 0, 1, -1, 2.5])("rejects invalid outcome counts %s", (count) => {
    expect(() => pointLogScore(0.5, count)).toThrow(RangeError);
  });
  it("rejects infinite forward levels", () => {
    expect(() => forwardScore(Infinity, 1)).toThrow(RangeError);
    expect(() => forwardScore(1, Infinity)).toThrow(RangeError);
  });
  it("rejects invalid expiry dates", () => {
    expect(() => binaryExpiry(invalidDate)).toThrow(RangeError);
    expect(() => quarterEndCutoff(invalidDate)).toThrow(RangeError);
  });
  it("rejects invalid dates anywhere in binary resolution inputs", () => {
    for (const key of ["opensAt", "cutoff"] as const)
      expect(() => resolveBinary({ ...terms, [key]: invalidDate }, [], day)).toThrow(RangeError);
    expect(() => resolveBinary(terms, [], invalidDate)).toThrow(RangeError);
    expect(() => resolveBinary(terms, [{ ...event, announcedAt: invalidDate }], day)).toThrow(
      RangeError,
    );
  });
  it("rejects invalid dates anywhere in forward resolution inputs", () => {
    for (const key of ["opensAt", "expiresAt"] as const)
      expect(() => resolveForward({ ...terms, [key]: invalidDate }, [], day)).toThrow(RangeError);
    expect(() => resolveForward(terms, [], invalidDate)).toThrow(RangeError);
    expect(() => resolveForward(terms, [{ ...event, announcedAt: invalidDate }], day)).toThrow(
      RangeError,
    );
  });
  it.each([NaN, Infinity, -0.1])("validates the first bucket mass %s", (mass) => {
    expect(() => probabilitiesAbove([mass, 0.5])).toThrow(RangeError);
  });
  it.each<[keyof ForwardQuote, number]>([
    ["mid", NaN],
    ["adjustedMid", Infinity],
    ["halfSpread", -1],
    ["bid", NaN],
    ["ask", Infinity],
    ["maxLongCents", NaN],
    ["maxShortCents", -1],
    ["effectiveCapCents", 1.5],
    ["inventoryCents", Infinity],
  ])("rejects malformed quote field %s", (field, value) => {
    const invalid = { ...validQuote, [field]: value };
    expect(() => maxFillCents("long", invalid)).toThrow(RangeError);
    expect(() => fill("short", 100, invalid)).toThrow(RangeError);
  });
  it("rejects crossed quotes and cap availability inconsistent with inventory", () => {
    expect(() => fill("long", 100, { ...validQuote, bid: validQuote.ask + 1 })).toThrow(RangeError);
    expect(() => maxFillCents("long", { ...validQuote, maxLongCents: 10001 })).toThrow(RangeError);
  });
});
