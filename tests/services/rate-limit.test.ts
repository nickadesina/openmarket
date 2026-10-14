import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "../../src/lib/db/schema.js";
import {
  consumeRateLimit,
  evaluateRateLimitWindow,
  rateLimitNetworkKey,
} from "../../src/lib/services/rate-limit.js";

const MINUTE = 60_000;

describe("evaluateRateLimitWindow", () => {
  it("allows requests under the limit and increments the count", () => {
    const decision = evaluateRateLimitWindow({ windowStartedAtMs: 1_000, count: 2 }, 2_000, {
      limit: 5,
      windowMs: MINUTE,
    });
    expect(decision).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
      nextWindowStartedAtMs: 1_000,
      nextCount: 3,
    });
  });

  it("rejects at the limit with a retry-after inside the window", () => {
    const decision = evaluateRateLimitWindow({ windowStartedAtMs: 1_000, count: 5 }, 31_000, {
      limit: 5,
      windowMs: MINUTE,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBe(30);
  });

  it("starts a fresh window once the old one expires", () => {
    const decision = evaluateRateLimitWindow({ windowStartedAtMs: 1_000, count: 5 }, 61_000, {
      limit: 5,
      windowMs: MINUTE,
    });
    expect(decision).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
      nextWindowStartedAtMs: 61_000,
      nextCount: 1,
    });
  });
});

function mockDatabase(counter: { window_started_at: Date; request_count: number }, now: Date) {
  const updates: unknown[] = [];
  const insertQuery: Record<string, unknown> = {};
  insertQuery.values = vi.fn(() => insertQuery);
  insertQuery.onConflict = vi.fn((callback: (builder: unknown) => unknown) => {
    callback({ columns: vi.fn(() => ({ doNothing: vi.fn(() => ({})) })) });
    return insertQuery;
  });
  insertQuery.execute = vi.fn(async () => []);
  const selectQuery: Record<string, unknown> = {};
  selectQuery.selectAll = vi.fn(() => selectQuery);
  selectQuery.where = vi.fn(() => selectQuery);
  selectQuery.forUpdate = vi.fn(() => selectQuery);
  selectQuery.execute = vi.fn(async () => [counter]);
  const updateQuery: Record<string, unknown> = {};
  updateQuery.set = vi.fn((set: unknown) => {
    updates.push(set);
    return updateQuery;
  });
  updateQuery.where = vi.fn(() => updateQuery);
  updateQuery.execute = vi.fn(async () => []);
  const transaction = {
    insertInto: vi.fn(() => insertQuery),
    selectFrom: vi.fn(() => selectQuery),
    selectNoFrom: vi.fn(() => ({ executeTakeFirstOrThrow: async () => ({ now }) })),
    updateTable: vi.fn(() => updateQuery),
  };
  const db = {
    transaction: vi.fn(() => ({
      execute: async (callback: (tx: unknown) => Promise<unknown>) => callback(transaction),
    })),
  } as unknown as Kysely<Database>;
  return { db, updates };
}

describe("consumeRateLimit", () => {
  it("throws RATE_LIMITED with retryAfterSeconds when the window is exhausted", async () => {
    const now = new Date("2026-01-01T00:00:30.000Z");
    const { db, updates } = mockDatabase(
      { window_started_at: new Date("2026-01-01T00:00:00.000Z"), request_count: 3 },
      now,
    );
    await expect(
      consumeRateLimit(db, "quote", "user-1", { limit: 3, windowMs: MINUTE }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", details: { retryAfterSeconds: 30 } });
    expect(updates).toEqual([]);
  });

  it("increments the counter when allowed", async () => {
    const now = new Date("2026-01-01T00:00:30.000Z");
    const { db, updates } = mockDatabase(
      { window_started_at: new Date("2026-01-01T00:00:00.000Z"), request_count: 1 },
      now,
    );
    await consumeRateLimit(db, "trade", "user-1", { limit: 3, windowMs: MINUTE });
    expect(updates).toEqual([
      { window_started_at: new Date("2026-01-01T00:00:00.000Z"), request_count: 2 },
    ]);
  });
});

describe("rateLimitNetworkKey", () => {
  it("is stable for one address and distinct across addresses", () => {
    const environment = { VERCEL: "1", NODE_ENV: "production" };
    const first = rateLimitNetworkKey(
      new Request("https://example.test/", { headers: { "x-vercel-forwarded-for": "192.0.2.1" } }),
      environment,
    );
    const again = rateLimitNetworkKey(
      new Request("https://example.test/", { headers: { "x-vercel-forwarded-for": "192.0.2.1" } }),
      environment,
    );
    const other = rateLimitNetworkKey(
      new Request("https://example.test/", { headers: { "x-vercel-forwarded-for": "192.0.2.2" } }),
      environment,
    );
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(again).toBe(first);
    expect(other).not.toBe(first);
  });

  it("falls back to one shared bucket when no trusted address exists", () => {
    const key = rateLimitNetworkKey(new Request("https://example.test/"), {
      NODE_ENV: "production",
    });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});
