import type { Kysely } from "kysely";
import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "../../src/lib/db/schema.js";
import {
  calculateBinaryExposure,
  getPortfolio,
  PORTFOLIO_MAX_TRADE_LIMIT,
} from "../../src/lib/services/portfolio.js";

function queryReturning(rows: readonly unknown[]): Record<string, Mock> {
  const query: Record<string, Mock> = {};
  for (const method of ["select", "where", "innerJoin", "orderBy", "offset", "limit"]) {
    query[method] = vi.fn(() => query);
  }
  query.execute = vi.fn(async () => rows);
  query.executeTakeFirst = vi.fn(async () => rows[0]);
  return query;
}

function databaseWithReadTransaction(selectFrom: Mock): Kysely<Database> {
  const transactionDb = { selectFrom };
  const execute = vi.fn(
    async (callback: (transaction: typeof transactionDb) => Promise<unknown>): Promise<unknown> =>
      callback(transactionDb),
  );
  const setAccessMode = vi.fn(() => ({ execute }));
  const setIsolationLevel = vi.fn(() => ({ setAccessMode }));
  return { transaction: vi.fn(() => ({ setIsolationLevel })) } as unknown as Kysely<Database>;
}

describe("calculateBinaryExposure", () => {
  it("marks each held side at the book's probability without mutating vectors", () => {
    const holdings = Object.freeze([4, 2]);
    const q = Object.freeze([0, Math.log(3)]);

    const exposure = calculateBinaryExposure(holdings, q, 1);

    expect(exposure.yesProbability).toBeCloseTo(0.75);
    expect(exposure.holdingsMarkedValueUsd).toBeCloseTo(2.5);
    expect(exposure.positions).toEqual([
      expect.objectContaining({ side: "yes", quantity: 2, sellableQuantity: 2 }),
      expect.objectContaining({ side: "no", quantity: 4, sellableQuantity: 4 }),
    ]);
    expect(exposure.positions[0]!.markPriceUsd).toBeCloseTo(0.75);
    expect(holdings).toEqual([4, 2]);
  });

  it("omits an empty side and rejects a book that is not binary", () => {
    expect(calculateBinaryExposure([0, 3], [0, 0], 10).positions).toEqual([
      expect.objectContaining({ side: "yes", quantity: 3 }),
    ]);
    expect(() => calculateBinaryExposure([1, 2, 3], [0, 0, 0], 10)).toThrow(RangeError);
    expect(() => calculateBinaryExposure([-1, 0], [0, 0], 10)).toThrow(RangeError);
  });
});

describe("getPortfolio", () => {
  it("rejects a missing user and invalid pagination before portfolio reads", async () => {
    const missingUserQuery = queryReturning([]);
    const missingSelectFrom = vi.fn(() => missingUserQuery);

    await expect(
      getPortfolio(databaseWithReadTransaction(missingSelectFrom), "missing"),
    ).rejects.toMatchObject({ code: "USER_REQUIRED" });
    expect(missingSelectFrom).toHaveBeenCalledTimes(1);

    const invalidTransaction = vi.fn();
    const invalidDb = { transaction: invalidTransaction } as unknown as Kysely<Database>;
    await expect(
      getPortfolio(invalidDb, "user-1", { limit: PORTFOLIO_MAX_TRADE_LIMIT + 1 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(invalidTransaction).not.toHaveBeenCalled();
  });
});
