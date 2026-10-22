import { describe, expect, it } from "vitest";

import { ServiceError } from "../../src/lib/api/errors.js";
import { parseRefInstant } from "../../src/lib/api/ref-route.js";
import {
  BLEND_SCHEDULE,
  BLEND_SCHEDULES_BY_VERSION,
  BLEND_VERSION,
} from "../../src/lib/engine/dealer/blend.js";
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

  it("takes the crowd in the model's unit and refuses a question of the other kind", () => {
    const binary = { kind: "binary" as const, unit: null };
    const forwardB = { kind: "forward" as const, unit: "USD_B" as const };
    const forwardT = { kind: "forward" as const, unit: "USD_T" as const };
    expect(crowdValue("forward", forwardB, { p: null, value: "400" })).toEqual({
      reported: 400,
      value: Math.log(400e9),
    });
    expect(crowdValue("forward", forwardT, { p: null, value: "1.2" }).value).toBe(Math.log(1.2e12));
    expect(crowdValue("binary", binary, { p: "0.7", value: null })).toEqual({
      reported: 0.7,
      value: 0.7,
    });
    expect(crowdValue("binary", forwardB, { p: null, value: "400" }).value).toBeNull();
    expect(crowdValue("forward", binary, { p: "0.7", value: null }).value).toBeNull();
    expect(crowdValue("forward", forwardB, { p: null, value: null })).toEqual({
      reported: null,
      value: null,
    });
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
        kind: "forward",
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

  it("keeps the published 1.0.0 schedule beside the current one", () => {
    expect(BLEND_VERSION).not.toBe("1.0.0");
    expect(BLEND_SCHEDULES_BY_VERSION[BLEND_VERSION]).toBe(BLEND_SCHEDULE);
    expect(BLEND_SCHEDULES_BY_VERSION["1.0.0"]).toEqual({
      version: "1.0.0",
      traded: { max_weight: 0.6, v0_usd: 50_000, window_days: 30 },
      crowd: { max_weight: 0.3, n0: 20, n_min: 10 },
    });
    expect(Object.isFrozen(BLEND_SCHEDULES_BY_VERSION["1.0.0"])).toBe(true);
    // A 1.0.0 row's stored binary crowd (unit "bool", no kind) still blends under its own schedule.
    const legacy = {
      instrument_id: "00000000-0000-4000-8000-000000000000",
      kind: "binary",
      model: { model_mid_id: "m", computed_at: "2026-10-20T00:05:00.000Z", value: 0.2 },
      traded: {
        weighting: "cash_yes_price",
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
        n_forecasters: 10,
        unit: "bool",
        reported: 0.6,
        value: 0.6,
      },
      schedule: BLEND_SCHEDULES_BY_VERSION["1.0.0"],
    } as unknown as ReferenceComponents;
    const result = blendFromComponents(legacy, BLEND_SCHEDULES_BY_VERSION["1.0.0"]);
    expect(result.weights.crowd).toBe(0.3);
    expect(result.value).toBeCloseTo(0.7 * 0.2 + 0.3 * 0.6, 15);
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
