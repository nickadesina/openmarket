import type { Kysely } from "kysely";
import { describe, expect, it, type Mock, vi } from "vitest";

import type { Database } from "../../src/lib/db/schema.js";
import { getMarks } from "../../src/lib/services/get-marks.js";

function queryReturning(rows: readonly unknown[]): Record<string, Mock> {
  const query: Record<string, Mock> = {};
  for (const method of ["innerJoin", "select", "where", "orderBy", "limit"]) {
    query[method] = vi.fn(() => query);
  }
  query.execute = vi.fn(async () => rows);
  query.executeTakeFirst = vi.fn(async () => rows[0]);
  return query;
}

function readDatabase(selectFrom: Mock): {
  readonly db: Kysely<Database>;
  readonly setIsolationLevel: Mock;
  readonly setAccessMode: Mock;
} {
  const transactionDb = { selectFrom };
  const execute = vi.fn(async (callback: (transaction: typeof transactionDb) => Promise<unknown>) =>
    callback(transactionDb),
  );
  const setAccessMode = vi.fn(() => ({ execute }));
  const setIsolationLevel = vi.fn(() => ({ setAccessMode }));
  return {
    db: {
      transaction: vi.fn(() => ({ setIsolationLevel })),
    } as unknown as Kysely<Database>,
    setIsolationLevel,
    setAccessMode,
  };
}

describe("getMarks", () => {
  it("returns tied raw points in sequence order from the window-start baseline", async () => {
    const now = new Date("2026-01-01T12:00:00.000Z");
    const marketQuery = queryReturning([
      {
        id: "market-1",
        metric_kind: "yes_probability",
        current_metric: 0.4,
        created_at: new Date("2025-01-01T00:00:00.000Z"),
        instrument_id: null,
      },
    ]);
    const priorQuery = queryReturning([
      {
        market_sequence: "0",
        ts: new Date("2026-01-01T11:00:00.000Z"),
        value: 10,
      },
    ]);
    const rowsQuery = queryReturning([
      {
        market_sequence: "1",
        ts: new Date("2026-01-01T11:15:00.000Z"),
        value: 20,
      },
      {
        market_sequence: "2",
        ts: new Date("2026-01-01T11:15:00.000Z"),
        value: 30,
      },
      {
        market_sequence: "3",
        ts: new Date("2026-01-01T11:45:00.000Z"),
        value: 40,
      },
    ]);
    let markQuery = 0;
    const selectFrom = vi.fn((table: string) => {
      if (table === "markets") return marketQuery;
      markQuery += 1;
      return markQuery === 1 ? priorQuery : rowsQuery;
    });
    const { db, setIsolationLevel, setAccessMode } = readDatabase(selectFrom);

    const history = await getMarks(db, "market-1", "1h", { now });

    expect(history.points.map((point) => point.marketSequence)).toEqual(["1", "2", "3"]);
    expect(history.currentMetric).toBe(0.4);
    expect(history.openValue).toBe(10);
    expect(history.windowStart).toBe("2026-01-01T11:00:00.000Z");
    expect(setIsolationLevel).toHaveBeenCalledWith("repeatable read");
    expect(setAccessMode).toHaveBeenCalledWith("read only");
  });

  it("opens at the current metric when the book has no marks in range", async () => {
    const marketQuery = queryReturning([
      {
        id: "market-2",
        metric_kind: "yes_probability",
        current_metric: 0.72,
        created_at: new Date("2025-01-01T00:00:00.000Z"),
        instrument_id: null,
      },
    ]);
    const selectFrom = vi
      .fn()
      .mockReturnValueOnce(marketQuery)
      .mockReturnValueOnce(queryReturning([]))
      .mockReturnValueOnce(queryReturning([]));
    const { db } = readDatabase(selectFrom);

    const history = await getMarks(db, "market-2", "1d", {
      now: new Date("2026-01-01T12:00:00.000Z"),
    });

    expect(history.openValue).toBe(0.72);
    expect(history.points).toEqual([]);
  });

  it("rejects an invalid range before opening a transaction", async () => {
    const transaction = vi.fn();
    const db = { transaction } as unknown as Kysely<Database>;

    await expect(getMarks(db, "market-1", "month" as never)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
