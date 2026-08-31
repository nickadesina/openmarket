import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import type { SettlementInput } from "../../src/lib/api/schemas.js";
import type { Database, MetricKind } from "../../src/lib/db/schema.js";
import { VALUATION_BOUNDARIES_USD } from "../../src/lib/engine/buckets.js";
import { settleMarket } from "../../src/lib/services/settle-market.js";

const MARKET_ID = "00000000-0000-4000-8000-000000000010";
const SETTLEMENT_TS = new Date("2026-08-30T12:34:56.789Z");

interface MockMarket {
  market_id: string;
  status: "open" | "settled";
  n_buckets: number;
  metric_kind: MetricKind;
  mm_cash_flow_cents: string;
  rounding_reserve_cents: string;
}

interface MockHolding {
  user_id: string;
  h: number[];
  cash_balance_cents: string;
  updated_at?: Date;
}

interface QueryCall {
  readonly table: string;
  readonly values: Record<string, unknown>;
  readonly where: readonly unknown[][];
}

interface MockRecords {
  readonly operationLog: string[];
  readonly locks: Array<{ table: string; tables: unknown }>;
  readonly orderBy: unknown[][];
  readonly userUpdates: QueryCall[];
  readonly holdingUpdates: QueryCall[];
  readonly marketUpdates: QueryCall[];
  readonly settlementInserts: Record<string, unknown>[];
}

function queryBuilder(methods: Partial<Record<string, Mock>> = {}): Record<string, Mock> {
  const builder: Record<string, Mock> = {};
  for (const method of [
    "innerJoin",
    "select",
    "where",
    "limit",
    "orderBy",
    "forUpdate",
    "set",
    "values",
  ]) {
    builder[method] = methods[method] ?? vi.fn(() => builder);
  }
  Object.assign(builder, methods);
  return builder;
}

function createSettlementDb(options: {
  market?: Partial<MockMarket> | null;
  holdings?: MockHolding[];
} = {}): {
  db: Kysely<Database>;
  market: MockMarket | null;
  holdings: MockHolding[];
  records: MockRecords;
} {
  const market =
    options.market === null
      ? null
      : {
          market_id: MARKET_ID,
          status: "open" as const,
          n_buckets: 2,
          metric_kind: "yes_probability" as const,
          mm_cash_flow_cents: "50000",
          rounding_reserve_cents: "7",
          ...options.market,
        };
  const holdings = options.holdings ?? [];
  const records: MockRecords = {
    operationLog: [],
    locks: [],
    orderBy: [],
    userUpdates: [],
    holdingUpdates: [],
    marketUpdates: [],
    settlementInserts: [],
  };

  const transaction: Record<string, Mock> = {};

  transaction.selectFrom = vi.fn((table: string) => {
    const where: unknown[][] = [];
    const builder = queryBuilder();
    builder.where = vi.fn((...args: unknown[]) => {
      where.push(args);
      return builder;
    });
    builder.innerJoin = vi.fn(() => builder);
    builder.select = vi.fn(() => builder);
    builder.limit = vi.fn(() => builder);
    builder.orderBy = vi.fn((...args: unknown[]) => {
      records.orderBy.push(args);
      records.operationLog.push(`${table}:orderBy`);
      return builder;
    });
    builder.forUpdate = vi.fn((tables: unknown) => {
      records.locks.push({ table, tables });
      records.operationLog.push(`${table}:forUpdate`);
      return builder;
    });
    builder.executeTakeFirst = vi.fn(async () => {
      const requiresOpen = where.some(
        ([column, operator, value]) =>
          column === "markets.status" && operator === "=" && value === "open",
      );
      if (table !== "markets" || market === null) {
        return undefined;
      }
      if (requiresOpen) {
        return market.status === "open" ? { ...market } : undefined;
      }
      return { id: market.market_id };
    });
    builder.execute = vi.fn(async () => {
      if (table !== "holdings") {
        return [];
      }
      records.operationLog.push("holdings:execute");
      return holdings.map((holding) => ({
        user_id: holding.user_id,
        h: [...holding.h],
        cash_balance_cents: holding.cash_balance_cents,
      }));
    });
    return builder;
  });

  transaction.selectNoFrom = vi.fn(() => {
    const builder = queryBuilder();
    builder.executeTakeFirstOrThrow = vi.fn(async () => {
      records.operationLog.push("timestamp:read");
      return { settlement_ts: SETTLEMENT_TS };
    });
    return builder;
  });

  transaction.updateTable = vi.fn((table: string) => {
    let values: Record<string, unknown> = {};
    const where: unknown[][] = [];
    const builder = queryBuilder();
    builder.set = vi.fn((nextValues: Record<string, unknown>) => {
      values = nextValues;
      return builder;
    });
    builder.where = vi.fn((...args: unknown[]) => {
      where.push(args);
      return builder;
    });
    builder.executeTakeFirstOrThrow = vi.fn(async () => {
      const call = { table, values, where };
      records.operationLog.push(`${table}:update`);
      const id = where.find(([column]) => column === "id")?.[2];
      const userId = where.find(([column]) => column === "user_id")?.[2];

      if (table === "users") {
        records.userUpdates.push(call);
        const holding = holdings.find((candidate) => candidate.user_id === id);
        if (holding !== undefined) {
          holding.cash_balance_cents = String(values.cash_balance_cents);
        }
      } else if (table === "holdings") {
        records.holdingUpdates.push(call);
        const holding = holdings.find(
          (candidate) => candidate.user_id === userId,
        );
        if (holding !== undefined) {
          holding.h = [...(values.h as number[])];
          holding.updated_at = values.updated_at as Date;
        }
      } else if (table === "markets" && market !== null) {
        records.marketUpdates.push(call);
        market.status = values.status as "open" | "settled";
        market.mm_cash_flow_cents = String(values.mm_cash_flow_cents);
        market.rounding_reserve_cents = String(values.rounding_reserve_cents);
      }
      return { numUpdatedRows: 1n };
    });
    return builder;
  });

  transaction.insertInto = vi.fn((table: string) => {
    let values: Record<string, unknown> = {};
    const builder = queryBuilder();
    builder.values = vi.fn((nextValues: Record<string, unknown>) => {
      values = nextValues;
      return builder;
    });
    builder.executeTakeFirstOrThrow = vi.fn(async () => {
      records.operationLog.push(`${table}:insert`);
      if (table === "settlements") {
        records.settlementInserts.push(values);
      }
      return { numInsertedOrUpdatedRows: 1n };
    });
    return builder;
  });

  const db = {
    transaction: vi.fn(() => ({
      execute: async <T>(
        callback: (trx: Record<string, Mock>) => Promise<T>,
      ): Promise<T> => callback(transaction),
    })),
  } as unknown as Kysely<Database>;

  return { db, market, holdings, records };
}

const binaryInput: SettlementInput = {
  slug: "acme",
  confirm_slug: "acme",
  settled_value_usd: "1",
  source_url: "https://example.com/outcome",
  source_description: "Official result",
};

describe("settleMarket", () => {
  it("locks in stable order, pays EPS-low cents once, tracks reserve, and freezes atomically", async () => {
    const firstUserId = "00000000-0000-4000-8000-000000000001";
    const secondUserId = "00000000-0000-4000-8000-000000000002";
    const thirdUserId = "00000000-0000-4000-8000-000000000003";
    const { db, holdings, market, records } = createSettlementDb({
      holdings: [
        {
          user_id: firstUserId,
          h: [0, 99.9999999997],
          cash_balance_cents: "100",
        },
        {
          user_id: secondUserId,
          h: [0, 0.006],
          cash_balance_cents: "200",
        },
        {
          user_id: thirdUserId,
          h: [0, 0.006],
          cash_balance_cents: "300",
        },
      ],
    });

    const result = await settleMarket(db, binaryInput);

    expect(result).toEqual({
      market_id: MARKET_ID,
      slug: "acme",
      settled_value_usd: "1",
      winning_bucket: 1,
      credited_users: 3,
      total_payout_cents: "10000",
      rounding_reserve_delta_cents: "1",
      settled_at: SETTLEMENT_TS.toISOString(),
    });
    expect(holdings.map((holding) => holding.cash_balance_cents)).toEqual([
      "10100",
      "200",
      "300",
    ]);
    expect(holdings.map((holding) => holding.h)).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    expect(holdings.map((holding) => holding.updated_at)).toEqual([
      SETTLEMENT_TS,
      SETTLEMENT_TS,
      SETTLEMENT_TS,
    ]);
    expect(records.userUpdates.map((call) => call.where[0]?.[2])).toEqual([
      firstUserId,
      secondUserId,
      thirdUserId,
    ]);
    expect(records.locks).toEqual([
      { table: "markets", tables: ["markets", "companies"] },
      { table: "holdings", tables: ["holdings", "users"] },
    ]);
    expect(records.orderBy).toEqual([["users.id", "asc"]]);
    expect(records.operationLog.indexOf("markets:forUpdate")).toBeLessThan(
      records.operationLog.indexOf("holdings:forUpdate"),
    );
    expect(market).toMatchObject({
      status: "settled",
      mm_cash_flow_cents: "40000",
      rounding_reserve_cents: "8",
    });
    expect(records.marketUpdates).toHaveLength(1);
    expect(records.marketUpdates[0]?.values).toMatchObject({
      status: "settled",
      settled_at: SETTLEMENT_TS,
      mm_cash_flow_cents: "40000",
      rounding_reserve_cents: "8",
    });
    expect(records.settlementInserts).toEqual([
      {
        market_id: MARKET_ID,
        settled_value: "1",
        winning_bucket: 1,
        source_url: "https://example.com/outcome",
        source_description: "Official result",
        ts: SETTLEMENT_TS,
      },
    ]);

    await expect(settleMarket(db, binaryInput)).rejects.toMatchObject({
      code: "MARKET_SETTLED",
    });
    expect(records.userUpdates).toHaveLength(3);
    expect(records.holdingUpdates).toHaveLength(3);
    expect(records.marketUpdates).toHaveLength(1);
    expect(records.settlementInserts).toHaveLength(1);
  });

  it("uses inclusive canonical valuation boundaries", async () => {
    const boundary = VALUATION_BOUNDARIES_USD.indexOf(1_000_000_000_000);
    expect(boundary).toBeGreaterThanOrEqual(0);
    const { db, records } = createSettlementDb({
      market: {
        n_buckets: VALUATION_BOUNDARIES_USD.length + 1,
        metric_kind: "valuation_median",
      },
    });

    const result = await settleMarket(db, {
      ...binaryInput,
      settled_value_usd: "1000000000000",
    });

    expect(result.winning_bucket).toBe(boundary);
    expect(records.settlementInserts[0]?.winning_bucket).toBe(boundary);
  });

  it("maps binary 0 and 1 outcomes to the sole strike's NO and YES buckets", async () => {
    const noMarket = createSettlementDb();
    const noResult = await settleMarket(noMarket.db, {
      ...binaryInput,
      settled_value_usd: "0",
    });
    const yesMarket = createSettlementDb();
    const yesResult = await settleMarket(yesMarket.db, binaryInput);

    expect(noResult.winning_bucket).toBe(0);
    expect(yesResult.winning_bucket).toBe(1);
  });

  it("distinguishes a missing company from an already-settled market", async () => {
    const missing = createSettlementDb({ market: null });
    await expect(settleMarket(missing.db, binaryInput)).rejects.toMatchObject({
      code: "MARKET_NOT_FOUND",
    });

    const settled = createSettlementDb({ market: { status: "settled" } });
    await expect(settleMarket(settled.db, binaryInput)).rejects.toMatchObject({
      code: "MARKET_SETTLED",
    });
    expect(settled.records.userUpdates).toHaveLength(0);
    expect(settled.records.settlementInserts).toHaveLength(0);
  });
});
