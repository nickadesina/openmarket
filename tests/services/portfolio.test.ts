import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import type { Database } from "../../src/lib/db/schema.js";
import {
  VALUATION_BOUNDARIES_USD,
  VALUATION_BUCKET_COUNT,
} from "../../src/lib/engine/buckets.js";
import {
  calculatePortfolioExposure,
  getPortfolio,
  PORTFOLIO_MAX_TRADE_LIMIT,
} from "../../src/lib/services/portfolio.js";

function queryReturning(rows: readonly unknown[]): Record<string, Mock> {
  const query: Record<string, Mock> = {};
  for (const method of [
    "select",
    "where",
    "innerJoin",
    "orderBy",
    "offset",
    "limit",
  ]) {
    query[method] = vi.fn(() => query);
  }
  query.execute = vi.fn(async () => rows);
  query.executeTakeFirst = vi.fn(async () => rows[0]);
  return query;
}

function databaseWithReadTransaction(selectFrom: Mock): {
  db: Kysely<Database>;
  transaction: Mock;
  setIsolationLevel: Mock;
  setAccessMode: Mock;
  execute: Mock;
} {
  const transactionDb = { selectFrom };
  const execute = vi.fn(
    async (
      callback: (transaction: typeof transactionDb) => Promise<unknown>,
    ): Promise<unknown> => callback(transactionDb),
  );
  const setAccessMode = vi.fn(() => ({ execute }));
  const setIsolationLevel = vi.fn(() => ({ setAccessMode }));
  const transaction = vi.fn(() => ({ setIsolationLevel }));

  return {
    db: { transaction } as unknown as Kysely<Database>,
    transaction,
    setIsolationLevel,
    setAccessMode,
    execute,
  };
}

describe("calculatePortfolioExposure", () => {
  it("marks and deterministically decomposes a valuation holding without mutating vectors", () => {
    const q = Object.freeze(Array.from({ length: VALUATION_BUCKET_COUNT }, () => 0));
    const holdings = Array.from({ length: VALUATION_BUCKET_COUNT }, () => 0);
    for (let bucket = 0; bucket <= 10; bucket += 1) {
      holdings[bucket] = 3;
    }
    holdings[15] = 1;
    for (let bucket = 21; bucket < VALUATION_BUCKET_COUNT; bucket += 1) {
      holdings[bucket] = 2;
    }
    const frozenHoldings = Object.freeze(holdings);
    const holdingsBefore = [...frozenHoldings];
    const qBefore = [...q];

    const exposure = calculatePortfolioExposure(frozenHoldings, q, 100);

    expect(exposure.probabilities).toHaveLength(VALUATION_BUCKET_COUNT);
    expect(exposure.probabilities[0]).toBeCloseTo(1 / VALUATION_BUCKET_COUNT);
    expect(exposure.holdingsMarkedValueUsd).toBeCloseTo(74 / 41);
    expect(exposure.positions).toEqual([
      expect.objectContaining({
        side: "yes",
        strikeIndex: 20,
        quantity: 2,
        sellableQuantity: 2,
      }),
      expect.objectContaining({
        side: "no",
        strikeIndex: 10,
        quantity: 3,
        sellableQuantity: 3,
      }),
    ]);
    expect(exposure.positions[0]?.markPriceUsd).toBeCloseTo(20 / 41);
    expect(exposure.positions[1]?.markPriceUsd).toBeCloseTo(11 / 41);
    expect(exposure.residualExposure.buckets[15]).toBe(1);
    expect(exposure.residualExposure.markedValueUsd).toBeCloseTo(1 / 41);
    expect(frozenHoldings).toEqual(holdingsBefore);
    expect(q).toEqual(qBefore);
  });

  it("uses the sole binary strike and current binary PMF", () => {
    const holdings = Object.freeze([4, 2]);
    const q = Object.freeze([0, Math.log(3)]);

    const exposure = calculatePortfolioExposure(holdings, q, 1);

    expect(exposure.probabilities[0]).toBeCloseTo(0.25);
    expect(exposure.probabilities[1]).toBeCloseTo(0.75);
    expect(exposure.holdingsMarkedValueUsd).toBeCloseTo(2.5);
    expect(exposure.positions).toEqual([
      expect.objectContaining({
        side: "no",
        strikeIndex: 0,
        quantity: 4,
        sellableQuantity: 4,
      }),
      expect.objectContaining({
        side: "yes",
        strikeIndex: 0,
        quantity: 2,
        sellableQuantity: 2,
      }),
    ]);
    expect(exposure.residualExposure.buckets).toEqual([0, 0]);
  });
});

describe("getPortfolio", () => {
  it("returns an empty marked portfolio for a user with no holdings or trades", async () => {
    const userQuery = queryReturning([
      { id: "user-1", username: "Alice", cash_balance_cents: "10000000" },
    ]);
    const holdingsQuery = queryReturning([]);
    const basisQuery = queryReturning([]);
    const historyQuery = queryReturning([]);
    let tradesQueryCount = 0;
    const selectFrom = vi.fn((table: string) => {
      if (table === "users") return userQuery;
      if (table === "holdings") return holdingsQuery;
      tradesQueryCount += 1;
      return tradesQueryCount === 1 ? basisQuery : historyQuery;
    });
    const { db, transaction, setIsolationLevel, setAccessMode, execute } =
      databaseWithReadTransaction(selectFrom);

    const portfolio = await getPortfolio(db, "user-1");

    expect(portfolio).toMatchObject({
      userId: "user-1",
      username: "Alice",
      cashBalanceCents: "10000000",
      holdingsMarkedValueUsd: 0,
      accountValueUsd: 100000,
      markets: [],
      tradeHistory: {
        items: [],
        offset: 0,
        limit: 25,
        nextOffset: null,
      },
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(setIsolationLevel).toHaveBeenCalledWith("repeatable read");
    expect(setAccessMode).toHaveBeenCalledWith("read only");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(selectFrom).toHaveBeenCalledTimes(4);
  });

  it("returns valuation positions, grouped basis, and a bounded newest-first page", async () => {
    const userQuery = queryReturning([
      { id: "user-1", username: "Alice", cash_balance_cents: "12345" },
    ]);
    const q = Array.from({ length: VALUATION_BUCKET_COUNT }, () => 0);
    const h = Array.from({ length: VALUATION_BUCKET_COUNT }, (_, bucket) =>
      bucket > 20 ? 2 : 0,
    );
    const holdingsQuery = queryReturning([
      {
        market_id: "market-1",
        h,
        n_buckets: VALUATION_BUCKET_COUNT,
        bucket_grid_version: "valuation-v1",
        metric_kind: "valuation_median",
        q,
        b: 100,
        market_status: "open",
        company_name: "Acme",
        company_slug: "acme",
        company_logo_path: "/acme.svg",
      },
    ]);
    const basisQuery = queryReturning([
      {
        market_id: "market-1",
        action: "buy",
        contract_side: "yes",
        strike_index: 20,
        quantity: 3,
        cash_amount_cents: "150",
      },
      {
        market_id: "market-1",
        action: "sell",
        contract_side: "yes",
        strike_index: 20,
        quantity: 1,
        cash_amount_cents: "70",
      },
    ]);
    const trade = (id: string, sequence: string, createdAt: string) => ({
      id,
      market_id: "market-1",
      market_sequence: sequence,
      action: "buy",
      contract_side: "yes",
      strike_index: 20,
      strike_value: "1000000000000",
      quantity: 1,
      requested_spend_cents: null,
      engine_cost_usd: 0.5,
      cash_amount_cents: "50",
      redemption_quantity: 0,
      redemption_cents: "0",
      metric_before: 1_000_000_000,
      metric_after: 1_100_000_000,
      created_at: new Date(createdAt),
      company_name: "Acme",
      company_slug: "acme",
    });
    const historyQuery = queryReturning([
      trade("trade-3", "3", "2025-01-03T00:00:00.000Z"),
      trade("trade-2", "2", "2025-01-02T00:00:00.000Z"),
      trade("trade-1", "1", "2025-01-01T00:00:00.000Z"),
    ]);
    let tradesQueryCount = 0;
    const selectFrom = vi.fn((table: string) => {
      if (table === "users") return userQuery;
      if (table === "holdings") return holdingsQuery;
      tradesQueryCount += 1;
      return tradesQueryCount === 1 ? basisQuery : historyQuery;
    });
    const { db } = databaseWithReadTransaction(selectFrom);

    const portfolio = await getPortfolio(db, "user-1", { offset: 4, limit: 2 });

    expect(portfolio.holdingsMarkedValueUsd).toBeCloseTo(40 / 41);
    expect(portfolio.accountValueUsd).toBeCloseTo(123.45 + 40 / 41);
    expect(portfolio.markets[0]?.positions).toEqual([
      expect.objectContaining({
        side: "yes",
        strikeIndex: 20,
        strikeValueUsd: VALUATION_BOUNDARIES_USD[20]?.toString(),
        quantity: 2,
        sellableQuantity: 2,
        approximateCostBasis: expect.objectContaining({
          netQuantity: 2,
          approximateNetCostCents: "80",
          approximateAveragePriceUsd: 0.4,
        }),
      }),
    ]);
    expect(portfolio.markets[0]?.residualExposure.buckets).toEqual(
      Array.from({ length: VALUATION_BUCKET_COUNT }, () => 0),
    );
    expect(portfolio.tradeHistory.items.map(({ id }) => id)).toEqual([
      "trade-3",
      "trade-2",
    ]);
    expect(portfolio.tradeHistory.items[0]?.createdAt).toBe(
      "2025-01-03T00:00:00.000Z",
    );
    expect(portfolio.tradeHistory.nextOffset).toBe(6);
    expect(historyQuery.offset).toHaveBeenCalledWith(4);
    expect(historyQuery.limit).toHaveBeenCalledWith(3);
  });

  it("returns binary contracts only at strike zero", async () => {
    const userQuery = queryReturning([
      { id: "user-1", username: "Alice", cash_balance_cents: "10000" },
    ]);
    const holdingsQuery = queryReturning([
      {
        market_id: "binary-1",
        h: [1, 3],
        n_buckets: 2,
        bucket_grid_version: "binary-v1",
        metric_kind: "yes_probability",
        q: [0, Math.log(3)],
        b: 1,
        market_status: "open",
        company_name: "Binary Co",
        company_slug: "binary-co",
        company_logo_path: "/binary.svg",
      },
    ]);
    const basisQuery = queryReturning([]);
    const historyQuery = queryReturning([]);
    let tradesQueryCount = 0;
    const selectFrom = vi.fn((table: string) => {
      if (table === "users") return userQuery;
      if (table === "holdings") return holdingsQuery;
      tradesQueryCount += 1;
      return tradesQueryCount === 1 ? basisQuery : historyQuery;
    });

    const { db } = databaseWithReadTransaction(selectFrom);
    const portfolio = await getPortfolio(db, "user-1");

    expect(portfolio.markets[0]?.metricKind).toBe("yes_probability");
    expect(portfolio.markets[0]?.probabilities[1]).toBeCloseTo(0.75);
    expect(
      portfolio.markets[0]?.positions.map(({ side, strikeIndex, strikeValueUsd }) => ({
        side,
        strikeIndex,
        strikeValueUsd,
      })),
    ).toEqual([
      { side: "yes", strikeIndex: 0, strikeValueUsd: null },
      { side: "no", strikeIndex: 0, strikeValueUsd: null },
    ]);
  });

  it("rejects a missing user and invalid pagination before portfolio reads", async () => {
    const missingUserQuery = queryReturning([]);
    const missingSelectFrom = vi.fn(() => missingUserQuery);
    const { db: missingDb } = databaseWithReadTransaction(missingSelectFrom);

    await expect(getPortfolio(missingDb, "missing")).rejects.toMatchObject({
      code: "USER_REQUIRED",
    });
    expect(missingSelectFrom).toHaveBeenCalledTimes(1);

    const invalidTransaction = vi.fn();
    const invalidDb = {
      transaction: invalidTransaction,
    } as unknown as Kysely<Database>;
    await expect(
      getPortfolio(invalidDb, "user-1", {
        limit: PORTFOLIO_MAX_TRADE_LIMIT + 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(invalidTransaction).not.toHaveBeenCalled();
  });
});
