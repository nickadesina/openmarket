import { describe, expect, it } from "vitest";

import { ServiceError } from "../../src/lib/api/errors.js";
import { parseRefInstant } from "../../src/lib/api/ref-route.js";
import { BLEND_SCHEDULE } from "../../src/lib/engine/dealer/blend.js";
import {
  cursorAfter,
  decodeCursor,
  encodeCursor,
  takePage,
} from "../../src/lib/services/dealer/ref-common.js";
import {
  binaryYesPrice,
  blendFromComponents,
  crowdValue,
  type ReferenceComponents,
  tradedAverage,
} from "../../src/lib/services/dealer/reference-prices.js";

describe("reference components", () => {
  it("weights the traded average by cents and reports volume in dollars", () => {
    expect(tradedAverage([])).toEqual({ volumeUsd: 0, value: null });
    expect(
      tradedAverage([
        { weightCents: 100_000, value: 24 },
        { weightCents: 300_000, value: 25 },
      ]),
    ).toEqual({ volumeUsd: 4_000, value: 24.75 });
    expect(tradedAverage([{ weightCents: 0, value: 0.4 }])).toEqual({ volumeUsd: 0, value: null });
  });

  it("reads a binary fill as a YES price, a NO fill as its complement, clamped", () => {
    expect(binaryYesPrice("yes", 4_000, 100)).toBeCloseTo(0.4, 15);
    expect(binaryYesPrice("no", 4_000, 100)).toBeCloseTo(0.6, 15);
    expect(binaryYesPrice("yes", 1, 0.001)).toBe(1);
    expect(binaryYesPrice("no", 1, 0.001)).toBe(0);
  });

  it("takes the crowd in the model's unit and refuses a mismatched one", () => {
    expect(crowdValue("forward", "USD_B", { median_value: "400", p_yes: null })).toEqual({
      reported: 400,
      value: Math.log(400e9),
    });
    expect(crowdValue("forward", "USD_T", { median_value: "1.2", p_yes: null }).value).toBe(
      Math.log(1.2e12),
    );
    expect(crowdValue("binary", "bool", { median_value: null, p_yes: "0.7" })).toEqual({
      reported: 0.7,
      value: 0.7,
    });
    expect(crowdValue("binary", "USD_B", { median_value: "400", p_yes: null }).value).toBeNull();
    expect(crowdValue("forward", "bool", { median_value: null, p_yes: "0.7" }).value).toBeNull();
  });

  it("blends stored components back to the model mid with no flow or crowd", () => {
    const components: ReferenceComponents = {
      instrument_id: "00000000-0000-4000-8000-000000000000",
      kind: "forward",
      model: { model_mid_id: "m", computed_at: "2026-10-20T00:05:00.000Z", value: 24.5 },
      traded: {
        weighting: "notional_entry_ln",
        window_days: 30,
        from: "2026-09-20T00:05:00.000Z",
        to: "2026-10-20T00:05:00.000Z",
        through_sequence: "0",
        trades: 0,
        volume_usd: 0,
        value: null,
      },
      crowd: {
        question_id: "q",
        aggregate_id: "a",
        computed_at: "2026-10-20T00:00:00.000Z",
        n_forecasters: 9,
        unit: "USD_B",
        reported: 400,
        value: Math.log(400e9),
      },
      schedule: BLEND_SCHEDULE,
    };
    expect(blendFromComponents(components)).toMatchObject({ value: 24.5, modelOnly: true });
    const crowded = blendFromComponents({
      ...components,
      crowd: { ...components.crowd!, n_forecasters: 10 },
    });
    expect(crowded.weights.crowd).toBe(0.3);
    expect(crowded.value).toBeCloseTo(0.7 * 24.5 + 0.3 * Math.log(400e9), 12);
  });
});

describe("ref cursors", () => {
  const position = { at: "2026-10-20T00:05:00.123456Z", key: "42" };

  it("round-trips each stream's position and ends once every stream has", () => {
    const cursor = encodeCursor({ references: position, quotes: "end" });
    expect(decodeCursor(cursor, ["references", "quotes"])).toEqual({
      references: position,
      quotes: "end",
    });
    expect(decodeCursor(undefined, ["mids"])).toEqual({ mids: null });
    expect(cursorAfter({ mids: "end" })).toBeNull();
  });

  it("refuses a cursor it did not issue", () => {
    for (const cursor of [
      "not base64 json",
      encodeCursor({ other: position }),
      Buffer.from(JSON.stringify({ mids: { at: "yesterday", key: "1" } })).toString("base64url"),
      Buffer.from(JSON.stringify({ mids: { at: position.at, key: "1; drop" } })).toString(
        "base64url",
      ),
    ]) {
      expect(() => decodeCursor(cursor, ["mids"])).toThrow(ServiceError);
    }
  });

  it("pages from limit + 1 rows", () => {
    const rows = [1, 2, 3].map((n) => ({ n }));
    const key = (row: { n: number }) => ({ at: position.at, key: String(row.n) });
    expect(takePage(rows, 2, key)).toEqual({ items: rows.slice(0, 2), next: key(rows[1]!) });
    expect(takePage(rows, 3, key)).toEqual({ items: rows, next: "end" });
  });

  it("reads from and to as ISO instants only", () => {
    const params = (value: string) => new URLSearchParams({ from: value });
    expect(parseRefInstant(params("2026-10-20"), "from")).toEqual(new Date("2026-10-20"));
    expect(parseRefInstant(params("2026-10-20T01:02:03Z"), "from")).toEqual(
      new Date("2026-10-20T01:02:03Z"),
    );
    expect(parseRefInstant(new URLSearchParams(), "from")).toBeUndefined();
    for (const value of ["yesterday", "1729382400", "2026-13-40"]) {
      expect(() => parseRefInstant(params(value), "from")).toThrow(ServiceError);
    }
  });
});
