import { describe, expect, it } from "vitest";
import { DEALER_PARAMS } from "../../../src/lib/config/dealer.js";
import {
  binaryProbability,
  daysBetween,
  forwardMid,
  monthsBetween,
  roundProbability,
  tierOf,
  weibullSurvival,
} from "../../../src/lib/engine/dealer/prior.js";

const day = new Date("2026-01-01Z");
const invalidDate = new Date(Number.NaN);
const binary = {
  tier: "mega" as const,
  lastPrintAt: day,
  listedAt: day,
  expiresAt: new Date("2026-03-31Z"),
  leakAt: null,
};
const forward = { lastPostMoneyUsd: 1e9, mu: 0.5, asOf: day, leak: null };

describe("prior input boundaries", () => {
  it.each([Number.NaN, Infinity, -Infinity, 0, -1])(
    "rejects invalid valuations and thresholds: %s",
    (value) => {
      expect(() => tierOf(value, 1e9)).toThrow(RangeError);
      expect(() => tierOf(1e9, value)).toThrow(RangeError);
      expect(() => forwardMid({ ...forward, lastPostMoneyUsd: value })).toThrow(RangeError);
      expect(() => forwardMid({ ...forward, leak: { at: day, postMoneyUsd: value } })).toThrow(
        RangeError,
      );
    },
  );
  it.each([Number.NaN, Infinity, -Infinity])("rejects non-finite prior arithmetic: %s", (value) => {
    expect(() => roundProbability(value, 4, 1.5, 11)).toThrow(RangeError);
    expect(() => roundProbability(3, value, 1.5, 11)).toThrow(RangeError);
    expect(() => forwardMid({ ...forward, mu: value })).toThrow(RangeError);
  });
  it.each([Number.NaN, Infinity, 0, -1])("rejects invalid hazard scales: %s", (value) => {
    expect(() => weibullSurvival(3, value, 11)).toThrow(RangeError);
    expect(() => weibullSurvival(3, 1.5, value)).toThrow(RangeError);
    expect(() => monthsBetween(day, day, value)).toThrow(RangeError);
  });
  it("rejects every invalid date even on an unused leak", () => {
    expect(() => daysBetween(invalidDate, day)).toThrow(RangeError);
    expect(() => daysBetween(day, invalidDate)).toThrow(RangeError);
    for (const key of ["lastPrintAt", "listedAt", "expiresAt", "leakAt"] as const) {
      expect(() =>
        binaryProbability({ ...binary, [key]: invalidDate }, DEALER_PARAMS.prior, 0.05),
      ).toThrow(RangeError);
    }
    expect(() => forwardMid({ ...forward, asOf: invalidDate })).toThrow(RangeError);
    expect(() => forwardMid({ ...forward, leak: { at: invalidDate, postMoneyUsd: null } })).toThrow(
      RangeError,
    );
  });
  it.each([Number.NaN, Infinity, -0.1, 0, 0.5, 1])(
    "rejects invalid probability floors: %s",
    (value) => {
      expect(() => binaryProbability(binary, DEALER_PARAMS.prior, value)).toThrow(RangeError);
    },
  );
  it("validates the end time even when present survival underflows", () => {
    expect(() => roundProbability(1e6, Number.NaN, 1.5, 11)).toThrow(RangeError);
  });
});
