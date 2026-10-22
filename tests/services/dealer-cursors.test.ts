import { describe, expect, it } from "vitest";
import {
  afterPosition,
  decodeCursor,
  encodeCursor,
} from "../../src/lib/services/dealer/ref-common.js";

describe("reference cursor validation", () => {
  const at = "2026-10-20T00:00:00.000000Z";
  it.each(["2026-99-20T00:00:00.000000Z", "2026-02-30T00:00:00.000000Z"])(
    "rejects invalid timestamp %s before SQL",
    (value) => {
      expect(() => decodeCursor(encodeCursor({ rows: { at: value, key: "1" } }), ["rows"])).toThrow(
        "Invalid cursor",
      );
    },
  );
  it.each(["abc", "0-0", "ffffffff-ffff-ffff-ffff-fffffffffff"])(
    "rejects invalid UUID %s before SQL",
    (key) => {
      expect(() => afterPosition("at", "id", { at, key }, "uuid")).toThrow("Invalid cursor");
    },
  );
  it.each(["abc", "9223372036854775808", "1-2"])("rejects invalid bigint %s before SQL", (key) => {
    expect(() => afterPosition("at", "id", { at, key }, "bigint")).toThrow("Invalid cursor");
  });
  it("accepts exact microseconds, UUIDs and bigint maximum", () => {
    const key = "9223372036854775807";
    expect(() => afterPosition("at", "id", { at, key }, "bigint")).not.toThrow();
    expect(decodeCursor(encodeCursor({ rows: { at, key } }), ["rows"]).rows).toEqual({ at, key });
  });
});
