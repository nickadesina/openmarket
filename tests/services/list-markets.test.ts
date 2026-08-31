import type { Kysely } from "kysely";
import { describe, expect, it, vi, type Mock } from "vitest";

import type { Database } from "../../src/lib/db/schema.js";
import { listMarkets } from "../../src/lib/services/list-markets.js";

function queryReturning(rows: readonly unknown[]): Record<string, Mock> {
  const query: Record<string, Mock> = {};
  for (const method of [
    "innerJoin",
    "select",
    "where",
    "orderBy",
    "limit",
  ]) {
    query[method] = vi.fn(() => query);
  }
  query.execute = vi.fn(async () => rows);
  return query;
}

function marketRow(overrides: Record<string, unknown>) {
  return {
    market_id: "market-a",
    status: "open" as const,
    metric_kind: "valuation_median" as const,
    anchor_valuation: "1000000000.00",
    anchor_date: "2025-01-01",
    anchor_description: "Public round",
    current_metric: 120,
    last_market_sequence: "2",
    created_at: new Date("2025-01-01T00:00:00.000Z"),
    settled_at: null,
    company_name: "Acme",
    company_slug: "acme",
    company_logo_path: "/acme.svg",
    outstanding_claims: 3,
    change_baseline: 100,
    ...overrides,
  };
}

function readDatabase(
  marketRows: readonly unknown[],
  historyRows: readonly unknown[],
): {
  readonly db: Kysely<Database>;
  readonly setIsolationLevel: Mock;
  readonly setAccessMode: Mock;
} {
  const rankedQuery = queryReturning([]);
  const rankedAlias = {};
  rankedQuery.as = vi.fn(() => rankedAlias);
  const marketsQuery = queryReturning(marketRows);
  const historyQuery = queryReturning(historyRows);
  const selectFrom = vi.fn((table: unknown) => {
    if (table === "marks") return rankedQuery;
    if (table === "markets") return marketsQuery;
    return historyQuery;
  });
  const transactionDb = { selectFrom };
  const execute = vi.fn(
    async (callback: (transaction: typeof transactionDb) => Promise<unknown>) =>
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

describe("listMarkets", () => {
  it("sorts open claims first, appends settled markets deterministically, and applies change fallbacks", async () => {
    const marketRows = [
      marketRow({
        market_id: "settled-old",
        status: "settled",
        company_slug: "zeta",
        settled_at: new Date("2025-02-01T00:00:00.000Z"),
        outstanding_claims: 99,
      }),
      marketRow({
        market_id: "open-low",
        company_slug: "low",
        outstanding_claims: 3,
        current_metric: 0.7,
        change_baseline: 0.7,
        metric_kind: "yes_probability",
        anchor_valuation: null,
        anchor_date: null,
        anchor_description: null,
      }),
      marketRow({
        market_id: "settled-new",
        status: "settled",
        company_slug: "alpha",
        settled_at: new Date("2025-03-01T00:00:00.000Z"),
        outstanding_claims: 100,
      }),
      marketRow({
        market_id: "open-high",
        company_slug: "high",
        outstanding_claims: 8,
        current_metric: 150,
        change_baseline: 110,
      }),
    ];
    const historyRows = [
      {
        market_id: "open-high",
        market_sequence: "2",
        ts: new Date("2026-01-01T11:00:00.000Z"),
        value: 150,
      },
      {
        market_id: "open-high",
        market_sequence: "0",
        ts: new Date("2026-01-01T10:00:00.000Z"),
        value: 110,
      },
      {
        market_id: "open-high",
        market_sequence: "1",
        ts: new Date("2026-01-01T11:00:00.000Z"),
        value: 140,
      },
    ];
    const { db, setIsolationLevel, setAccessMode } = readDatabase(
      marketRows,
      historyRows,
    );

    const result = await listMarkets(db, {
      now: new Date("2026-01-01T12:00:00.000Z"),
    });

    expect(result.markets.map((market) => market.marketId)).toEqual([
      "open-high",
      "open-low",
      "settled-new",
      "settled-old",
    ]);
    expect(result.markets[0]?.metric.change24Hours).toBe(40);
    expect(result.markets[1]?.metric.change24Hours).toBe(0);
    expect(result.markets[1]?.anchor).toBeNull();
    expect(
      result.markets[0]?.history.map((point) => point.marketSequence),
    ).toEqual(["0", "1", "2"]);
    expect(setIsolationLevel).toHaveBeenCalledWith("repeatable read");
    expect(setAccessMode).toHaveBeenCalledWith("read only");
  });

  it("rejects an unbounded compact-history request before reading", async () => {
    const transaction = vi.fn();
    const db = { transaction } as unknown as Kysely<Database>;

    await expect(listMarkets(db, { historyLimit: 101 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
