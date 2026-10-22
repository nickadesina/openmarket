import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TradeInput } from "../../src/lib/api/schemas.js";
import type { Database, MarketRow, UserRow } from "../../src/lib/db/schema.js";

const rawSql = vi.hoisted(() => ({ execute: vi.fn(), tag: vi.fn() }));

vi.mock("kysely", () => {
  rawSql.tag.mockImplementation(() => ({
    execute: rawSql.execute,
    as: vi.fn(() => ({})),
  }));
  return { sql: rawSql.tag };
});

import {
  deriveAdvisoryLockKey,
  deriveTradeRequestFingerprint,
  type ExecutionResult,
  executeTrade,
} from "../../src/lib/services/execute-trade.js";

const MARKET_ID = "00000000-0000-4000-8000-000000000010";
const USER_ID = "00000000-0000-4000-8000-000000000020";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000021";
const IDEMPOTENCY_KEY = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const EXECUTION_TS = new Date("2026-01-02T03:04:05.678Z");

interface RecordedQuery {
  readonly table: string;
  values?: unknown;
  set?: unknown;
  where?: unknown[][];
}

function queryReturning(
  first: unknown,
  events: string[],
  label: string,
  record?: RecordedQuery,
): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  const fluent = () => query;
  query.select = vi.fn(fluent);
  query.selectAll = vi.fn(fluent);
  query.innerJoin = vi.fn(fluent);
  query.where = vi.fn((...conditions: unknown[]) => {
    if (record !== undefined) {
      record.where ??= [];
      record.where.push(conditions);
    }
    return query;
  });
  query.orderBy = vi.fn(fluent);
  query.limit = vi.fn(fluent);
  query.forUpdate = vi.fn(fluent);
  query.returning = vi.fn(fluent);
  query.values = vi.fn((values: unknown) => {
    if (record !== undefined) record.values = values;
    return query;
  });
  query.set = vi.fn((set: unknown) => {
    if (record !== undefined) record.set = set;
    return query;
  });
  query.onConflict = vi.fn((callback: (builder: unknown) => unknown) => {
    const doNothing = vi.fn(() => ({}));
    callback({
      column: vi.fn(() => ({ doNothing })),
      columns: vi.fn(() => ({ doNothing })),
    });
    return query;
  });
  query.execute = vi.fn(async () => {
    events.push(label);
    return [];
  });
  query.executeTakeFirst = vi.fn(async () => {
    events.push(label);
    return first;
  });
  query.executeTakeFirstOrThrow = vi.fn(async () => {
    events.push(label);
    if (first === undefined) throw new Error(`Missing mock result for ${label}`);
    return first;
  });
  return query;
}

function createTransactionHarness(options?: {
  replay?: {
    readonly user_id: string;
    readonly request_fingerprint: string;
    readonly execution_result: ExecutionResult;
  };
  insertConflict?: boolean;
  holdingVector?: number[];
}) {
  const events: string[] = [];
  const replayLookup: RecordedQuery = { table: "trades" };
  const writes: RecordedQuery[] = [];
  const market: MarketRow = {
    id: MARKET_ID,
    company_id: "00000000-0000-4000-8000-000000000011",
    status: "open",
    n_buckets: 2,
    bucket_grid_version: "binary-v1",
    metric_kind: "yes_probability",
    anchor_valuation: null,
    anchor_date: null,
    anchor_description: null,
    b: 100,
    sigma: null,
    initial_q: [0, 0],
    q: [0, 0],
    current_metric: 0.5,
    last_market_sequence: "41",
    mm_cash_flow_cents: "900",
    rounding_reserve_cents: "7",
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    settled_at: null,
    instrument_id: null,
  };
  const user: UserRow = {
    id: USER_ID,
    tournament_user_id: "00000000-0000-4000-8000-0000000000aa",
    cash_balance_cents: "10000",
    created_at: new Date("2026-01-01T00:00:00.000Z"),
  };
  const holdings = {
    user_id: USER_ID,
    market_id: MARKET_ID,
    h: options?.holdingVector ?? [0, 0],
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
  };

  const transaction = {
    selectFrom: vi.fn((table: string) => {
      if (table === "trades") {
        return queryReturning(options?.replay, events, "replay lookup", replayLookup);
      }
      if (table === "markets") {
        return queryReturning(market, events, "market lock");
      }
      if (table === "users") {
        return queryReturning(user, events, "user lock");
      }
      if (table === "holdings") {
        return queryReturning(holdings, events, "holdings lock");
      }
      if (table === "tournament_restriction_attestations") {
        // No attestation: the user is restricted from nothing.
        return queryReturning(undefined, events, "restriction lookup");
      }
      throw new Error(`Unexpected select: ${table}`);
    }),
    selectNoFrom: vi.fn(() =>
      queryReturning({ execution_ts: EXECUTION_TS }, events, "execution timestamp"),
    ),
    insertInto: vi.fn((table: string) => {
      const record: RecordedQuery = { table };
      writes.push(record);
      if (table === "holdings") {
        return queryReturning([], events, "holdings upsert", record);
      }
      if (table === "trades") {
        return queryReturning(
          options?.insertConflict === true ? undefined : { id: "generated" },
          events,
          "trade insert",
          record,
        );
      }
      if (table === "marks") {
        return queryReturning({}, events, "mark insert", record);
      }
      throw new Error(`Unexpected insert: ${table}`);
    }),
    updateTable: vi.fn((table: string) => {
      const record: RecordedQuery = { table };
      writes.push(record);
      return queryReturning({}, events, `${table} update`, record);
    }),
  };
  // The harness intentionally implements only the Kysely surface exercised here.
  const db = {
    transaction: vi.fn(() => ({
      execute: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    })),
  } as unknown as Kysely<Database>;

  return { db, events, writes, market, replayLookup };
}

beforeEach(() => {
  rawSql.execute.mockReset();
  rawSql.execute.mockImplementation(async () => ({ rows: [] }));
  rawSql.tag.mockClear();
});

describe("deriveAdvisoryLockKey", () => {
  it("is stable, canonical-case insensitive, and always a signed int64", () => {
    const lower = deriveAdvisoryLockKey(IDEMPOTENCY_KEY);
    const upper = deriveAdvisoryLockKey(IDEMPOTENCY_KEY.toUpperCase());

    expect(lower).toBe(upper);
    expect(deriveAdvisoryLockKey("10000000-0000-4000-8000-000000000030")).not.toBe(lower);
    expect(lower).toBeGreaterThanOrEqual(-(1n << 63n));
    expect(lower).toBeLessThanOrEqual((1n << 63n) - 1n);
  });
});

describe("executeTrade", () => {
  const buy: TradeInput = {
    idempotency_key: IDEMPOTENCY_KEY,
    market_id: MARKET_ID,
    action: "buy",
    side: "yes",
    strike_index: 0,
    quantity: 1,
    max_cost_usd: "1.00",
  };

  const stored: ExecutionResult = {
    trade_id: "00000000-0000-4000-8000-000000000040",
    idempotency_key: IDEMPOTENCY_KEY,
    market_sequence: "8",
    action: "buy",
    side: "yes",
    strike_index: 0,
    shares: 2,
    engine_cost_usd: 1.1,
    cash_amount_cents: "110",
    average_price: 0.55,
    price_before: 0.5,
    price_after: 0.6,
    current_metric: 0.6,
    metric_kind: "yes_probability",
    redemption_quantity: 0,
    redemption_cents: "0",
    cash_balance_cents: "9890",
    sellable_quantity: 2,
  };

  it("canonicalizes equivalent money strings into a deterministic SHA-256 fingerprint", () => {
    const fingerprint = deriveTradeRequestFingerprint(USER_ID, buy);
    const equivalentInput: TradeInput = {
      ...buy,
      max_cost_usd: "1",
    };

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveTradeRequestFingerprint(USER_ID, equivalentInput)).toBe(fingerprint);
    expect(deriveTradeRequestFingerprint(OTHER_USER_ID, buy)).not.toBe(fingerprint);
    expect(deriveTradeRequestFingerprint(USER_ID, { ...buy, quantity: 2 })).not.toBe(fingerprint);
    expect(
      deriveTradeRequestFingerprint(USER_ID, {
        ...buy,
        max_cost_usd: "2.00",
      }),
    ).not.toBe(fingerprint);
  });

  it("returns a stored replay immediately after the advisory lock without writes", async () => {
    const harness = createTransactionHarness({
      replay: {
        user_id: USER_ID,
        request_fingerprint: deriveTradeRequestFingerprint(USER_ID, buy),
        execution_result: stored,
      },
    });
    rawSql.execute.mockImplementationOnce(async () => {
      harness.events.push("advisory lock");
      return { rows: [] };
    });

    await expect(executeTrade(harness.db, USER_ID, buy)).resolves.toEqual({
      result: stored,
      replayed: true,
    });
    expect(harness.events).toEqual(["advisory lock", "replay lookup"]);
    expect(harness.writes).toEqual([]);
  });

  it("replays twin-case keys through the canonical database lookup", async () => {
    const uppercaseBuy: TradeInput = {
      ...buy,
      idempotency_key: IDEMPOTENCY_KEY.toUpperCase(),
    };
    const harness = createTransactionHarness({
      replay: {
        user_id: USER_ID,
        request_fingerprint: deriveTradeRequestFingerprint(USER_ID, uppercaseBuy),
        execution_result: stored,
      },
    });

    await expect(executeTrade(harness.db, USER_ID, uppercaseBuy)).resolves.toEqual({
      result: stored,
      replayed: true,
    });
    expect(harness.replayLookup.where).toContainEqual(["idempotency_key", "=", IDEMPOTENCY_KEY]);
    expect(harness.writes).toEqual([]);
  });

  it("rejects cross-user key reuse before exposing the stored body or writing", async () => {
    const harness = createTransactionHarness({
      replay: {
        user_id: USER_ID,
        request_fingerprint: deriveTradeRequestFingerprint(USER_ID, buy),
        execution_result: stored,
      },
    });

    await expect(executeTrade(harness.db, OTHER_USER_ID, buy)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      details: {},
    });
    expect(harness.events).toEqual(["replay lookup"]);
    expect(harness.writes).toEqual([]);
  });

  it("rejects changed-request key reuse before exposing the stored body or writing", async () => {
    const harness = createTransactionHarness({
      replay: {
        user_id: USER_ID,
        request_fingerprint: deriveTradeRequestFingerprint(USER_ID, buy),
        execution_result: stored,
      },
    });
    const changedRequest: TradeInput = { ...buy, quantity: 2 };

    await expect(executeTrade(harness.db, USER_ID, changedRequest)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      details: {},
    });
    expect(harness.events).toEqual(["replay lookup"]);
    expect(harness.writes).toEqual([]);
  });

  it("locks in canonical order and persists one trade and matching mark", async () => {
    const harness = createTransactionHarness();
    rawSql.execute.mockImplementationOnce(async () => {
      harness.events.push("advisory lock");
      return { rows: [] };
    });

    const executed = await executeTrade(harness.db, USER_ID, buy);

    expect(executed.replayed).toBe(false);
    expect(executed.result).toMatchObject({
      idempotency_key: IDEMPOTENCY_KEY,
      market_sequence: "42",
      shares: 1,
      cash_amount_cents: "51",
      metric_kind: "yes_probability",
      redemption_quantity: 0,
      redemption_cents: "0",
      cash_balance_cents: "9949",
      sellable_quantity: 1,
    });
    expect(executed.result.engine_cost_usd).toBeCloseTo(0.5012499948, 8);
    expect(executed.result.average_price).toBe(0.51);
    expect(executed.result.price_before).toBeCloseTo(0.5, 12);
    expect(executed.result.price_after).toBeCloseTo(0.5024999791, 8);

    // A book by id: its instrument reference is read, then the book is locked.
    expect(harness.events.slice(0, 9)).toEqual([
      "advisory lock",
      "replay lookup",
      "market lock",
      "market lock",
      "execution timestamp",
      "user lock",
      "restriction lookup",
      "holdings upsert",
      "holdings lock",
    ]);
    const userUpdate = harness.writes.find(
      (write) => write.table === "users" && write.set !== undefined,
    );
    const marketUpdate = harness.writes.find(
      (write) => write.table === "markets" && write.set !== undefined,
    );
    const holdingsUpdate = harness.writes.find(
      (write) => write.table === "holdings" && write.set !== undefined,
    );
    const tradeInsert = harness.writes.find((write) => write.table === "trades");
    const markInsert = harness.writes.find((write) => write.table === "marks");

    expect(userUpdate?.set).toEqual({ cash_balance_cents: "9949" });
    expect(marketUpdate?.set).toMatchObject({
      last_market_sequence: "42",
      mm_cash_flow_cents: "951",
    });
    expect(marketUpdate?.set).not.toHaveProperty("rounding_reserve_cents");
    expect(holdingsUpdate?.set).toEqual({ h: [0, 1], updated_at: EXECUTION_TS });
    expect(tradeInsert?.values).toMatchObject({
      request_fingerprint: deriveTradeRequestFingerprint(USER_ID, buy),
      market_sequence: "42",
      cash_amount_cents: "51",
      created_at: EXECUTION_TS,
      execution_result: executed.result,
    });
    expect(markInsert?.values).toEqual({
      market_id: MARKET_ID,
      market_sequence: "42",
      trade_id: executed.result.trade_id,
      ts: EXECUTION_TS,
      value: executed.result.current_metric,
    });
    expect(harness.events.filter((event) => event === "mark insert")).toHaveLength(1);
  });

  it("reports the quantized ledger average in PRICE_MOVED details", async () => {
    const harness = createTransactionHarness();

    await expect(
      executeTrade(harness.db, USER_ID, { ...buy, max_cost_usd: "0.50" }),
    ).rejects.toMatchObject({
      code: "PRICE_MOVED",
      details: {
        cash_amount_cents: "51",
        shares: 1,
        average_price: 0.51,
      },
    });
  });

  it("redeems a complete set using the tolerated entitlement and actual MM cash flow", async () => {
    const harness = createTransactionHarness({
      holdingVector: [0, 0.999999999997],
    });
    const buyNo: TradeInput = {
      ...buy,
      side: "no",
    };

    const executed = await executeTrade(harness.db, USER_ID, buyNo);

    expect(executed.result).toMatchObject({
      shares: 1,
      cash_amount_cents: "51",
      redemption_cents: "100",
      cash_balance_cents: "10049",
      sellable_quantity: 0,
    });
    expect(executed.result.redemption_quantity).toBeCloseTo(1, 10);
    const marketUpdate = harness.writes.find(
      (write) => write.table === "markets" && write.set !== undefined,
    );
    const holdingsUpdate = harness.writes.find(
      (write) => write.table === "holdings" && write.set !== undefined,
    );
    expect(marketUpdate?.set).toMatchObject({ mm_cash_flow_cents: "851" });
    expect(marketUpdate?.set).not.toHaveProperty("rounding_reserve_cents");
    expect(holdingsUpdate?.set).toEqual({ h: [0, 0], updated_at: EXECUTION_TS });
  });

  it("rejects a vector-level oversell before any ledger update or audit insert", async () => {
    const harness = createTransactionHarness();
    const sell: TradeInput = {
      idempotency_key: IDEMPOTENCY_KEY,
      market_id: MARKET_ID,
      action: "sell",
      side: "yes",
      strike_index: 0,
      quantity: 1,
      min_proceeds_usd: "0.00",
    };

    await expect(executeTrade(harness.db, USER_ID, sell)).rejects.toMatchObject({
      code: "INSUFFICIENT_HOLDINGS",
      details: { sellable_quantity: 0 },
    });
    expect(
      harness.writes.some(
        (write) => write.set !== undefined || write.table === "trades" || write.table === "marks",
      ),
    ).toBe(false);
  });

  it("turns an impossible post-lock idempotency insert race into a stable error", async () => {
    const harness = createTransactionHarness({ insertConflict: true });

    await expect(executeTrade(harness.db, USER_ID, buy)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect(harness.writes.some((write) => write.table === "marks")).toBe(false);
  });
});
