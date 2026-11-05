import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { METHODOLOGY_VERSION } from "../../src/lib/engine/index/methodology.js";
import { CE_VERSION } from "../../src/lib/engine/index/waterfall.js";
import { RULEBOOK_VERSION } from "../../src/lib/engine/rulebook.js";
import { getRulebook } from "../../src/lib/services/get-rulebook.js";
import {
  ENVELOPE_KEYS,
  envelopeOf,
  LAG_NOTE,
  refEnvelope,
} from "../../src/lib/services/index/ref-envelope.js";

const NOW = new Date("2026-11-05T12:00:00Z");

describe("the reference envelope", () => {
  it("opens with the versions, the time and the lag, in that order", () => {
    const envelope = refEnvelope(NOW);
    expect(Object.keys(envelope)).toEqual([...ENVELOPE_KEYS]);
    expect(envelope).toEqual({
      methodology_version: METHODOLOGY_VERSION,
      ce_version: CE_VERSION,
      rulebook_version: RULEBOOK_VERSION,
      as_of: "2026-11-05T12:00:00.000Z",
      lag_note: LAG_NOTE,
    });
  });

  it("states the lag as METHODOLOGY.md does, in one sentence", () => {
    const methodology = readFileSync("METHODOLOGY.md", "utf8");
    expect(methodology).toContain("filed 54 to 60 days after that date");
    expect(LAG_NOTE).toContain("N-PORT-P");
    expect(LAG_NOTE).toContain("54 to 60 days");
    expect(LAG_NOTE.split(/\. /)).toHaveLength(1);
    expect(LAG_NOTE.endsWith(".")).toBe(true);
  });

  it("copies an envelope out of a payload without its other fields", () => {
    const payload = { ...refEnvelope(NOW), names: [] };
    expect(envelopeOf(payload)).toEqual(refEnvelope(NOW));
  });

  it("opens the rulebook payload too", () => {
    expect(Object.keys(getRulebook(NOW)).slice(0, ENVELOPE_KEYS.length)).toEqual([
      ...ENVELOPE_KEYS,
    ]);
  });
});
