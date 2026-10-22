import type { Kysely } from "kysely";
import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";

import type { QuoteInput } from "../../src/lib/api/schemas.js";
import type { Database, MetricKind } from "../../src/lib/db/schema.js";
import { probabilities, solveBuyQuantityForSpend } from "../../src/lib/engine/lmsr.js";
import { quoteMarket } from "../../src/lib/services/quote.js";

interface MarketFixture {
  readonly market_id: string;
  readonly n_buckets: number;
  readonly bucket_grid_version: string;
  readonly metric_kind: MetricKind;
  readonly b: number;
  readonly q: number[];
  readonly last_market_sequence: string;
}

interface MockDatabaseOptions {
  readonly market?: MarketFixture;
  readonly status?: "open" | "settled";
  readonly holdings?: number[];
}

function queryReturning(result: unknown): Record<string, Mock> {
  const query: Record<string, Mock> = {};
  query.innerJoin = vi.fn(() => query);
  query.select = vi.fn(() => query);
  query.selectAll = vi.fn(() => query);
  query.where = vi.fn(() => query);
  query.orderBy = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.executeTakeFirst = vi.fn(async () => result);
  query.executeTakeFirstOrThrow = vi.fn(async () => {
    if (result === undefined) throw new Error("no result");
    return result;
  });
  return query;
}

function mockDatabase(options: MockDatabaseOptions): {
  readonly db: Kysely<Database>;
  readonly selectFrom: Mock;
  readonly transaction: Mock;
  readonly setIsolationLevel: Mock;
  readonly setAccessMode: Mock;
  readonly execute: Mock;
} {
  const selectFrom = vi.fn((table: string) => {
    // A market id resolves the book's instrument (none in this fixture), then the book.
    if (table === "markets") {
      return queryReturning(
        options.market && {
          ...options.market,
          id: options.market.market_id,
          instrument_id: null,
          status: options.status ?? "open",
        },
      );
    }
    if (table === "holdings") {
      return queryReturning(options.holdings === undefined ? undefined : { h: options.holdings });
    }
    // A signed-in quote checks the restricted-person attestation: none here.
    if (table === "users") {
      return queryReturning({ tournament_user_id: "00000000-0000-4000-8000-0000000000aa" });
    }
    if (table === "tournament_restriction_attestations") return queryReturning(undefined);
    throw new Error(`Unexpected table ${table}`);
  });
  const transactionDatabase = {
    selectFrom,
  } as unknown as Kysely<Database>;
  const transactionBuilder: Record<string, Mock> = {};
  const setIsolationLevel = vi.fn(() => transactionBuilder);
  const setAccessMode = vi.fn(() => transactionBuilder);
  const execute = vi.fn(
    async (callback: (transaction: Kysely<Database>) => Promise<unknown>): Promise<unknown> =>
      callback(transactionDatabase),
  );
  transactionBuilder.setIsolationLevel = setIsolationLevel;
  transactionBuilder.setAccessMode = setAccessMode;
  transactionBuilder.execute = execute;
  const transaction = vi.fn(() => transactionBuilder);

  return {
    db: { transaction } as unknown as Kysely<Database>,
    selectFrom,
    transaction,
    setIsolationLevel,
    setAccessMode,
    execute,
  };
}

const BINARY_MARKET: MarketFixture = {
  market_id: "00000000-0000-4000-8000-000000000010",
  n_buckets: 2,
  bucket_grid_version: "binary-v1",
  metric_kind: "yes_probability",
  b: 10,
  q: [0, 0],
  last_market_sequence: "7",
};

describe("quoteMarket", () => {
  it("quotes an anonymous binary buy from zero holdings", async () => {
    const { db, selectFrom, transaction, setIsolationLevel, setAccessMode, execute } = mockDatabase(
      { market: BINARY_MARKET },
    );
    const input: QuoteInput = {
      market_id: BINARY_MARKET.market_id,
      action: "buy",
      side: "yes",
      strike_index: 0,
      quantity: 2,
    };

    const result = await quoteMarket(db, input);
    const distributionAfter = probabilities([0, 2], BINARY_MARKET.b);

    expect(result).toMatchObject({
      market_id: BINARY_MARKET.market_id,
      action: "buy",
      side: "yes",
      strike_index: 0,
      strike_value: null,
      metric_kind: "yes_probability",
      quantity: 2,
      price_before: 0.5,
      expected_redemption_quantity: 0,
      expected_redemption_cents: "0",
      sellable_quantity: 2,
      market_state_fingerprint: `${BINARY_MARKET.market_id}:7`,
    });
    expect(result.current_metric_after).toBeCloseTo(distributionAfter[1]!, 15);
    expect(result.average_price).toBe(Number(result.cash_amount_cents) / 100 / result.quantity);
    expect(new Date(result.quoted_at).toISOString()).toBe(result.quoted_at);
    expect(selectFrom).not.toHaveBeenCalledWith("holdings");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(setIsolationLevel).toHaveBeenCalledWith("repeatable read");
    expect(setAccessMode).toHaveBeenCalledWith("read only");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("solves a spend buy and reports the resulting full-set redemption", async () => {
    const { db } = mockDatabase({
      market: BINARY_MARKET,
      holdings: [1, 0],
    });
    const input: QuoteInput = {
      market_id: BINARY_MARKET.market_id,
      action: "buy",
      side: "yes",
      strike_index: 0,
      spend_usd: "1.00",
    };
    const expected = solveBuyQuantityForSpend(BINARY_MARKET.q, [false, true], BINARY_MARKET.b, 100);

    const result = await quoteMarket(db, input, "user-1");

    expect(result.quantity).toBe(expected.quantity);
    expect(result.engine_cost_usd).toBe(expected.costUsd);
    expect(result.cash_amount_cents).toBe(String(expected.cashAmountCents));
    expect(result.expected_redemption_quantity).toBe(1);
    expect(result.expected_redemption_cents).toBe("100");
    expect(result.sellable_quantity).toBeCloseTo(expected.quantity - 1, 12);
    expect(result.strike_value).toBeNull();
  });

  it("rejects a quantity buy whose conservative debit is zero cents", async () => {
    const { db } = mockDatabase({
      market: {
        ...BINARY_MARKET,
        q: [10_000, 0],
      },
    });
    const input: QuoteInput = {
      market_id: BINARY_MARKET.market_id,
      action: "buy",
      side: "yes",
      strike_index: 0,
      quantity: 1,
    };

    await expect(quoteMarket(db, input)).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: "Trade produces no transferable quantity.",
    });
  });

  it("rejects a sell whose conservative proceeds are zero cents", async () => {
    const { db } = mockDatabase({
      market: BINARY_MARKET,
      holdings: [0, 1],
    });
    const input: QuoteInput = {
      market_id: BINARY_MARKET.market_id,
      action: "sell",
      side: "yes",
      strike_index: 0,
      quantity: 0.000001,
    };

    await expect(quoteMarket(db, input, "user-1")).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: "Trade produces no transferable quantity.",
    });
  });

  it("requires a user and sufficient vector holdings for sells", async () => {
    const input: QuoteInput = {
      market_id: BINARY_MARKET.market_id,
      action: "sell",
      side: "yes",
      strike_index: 0,
      quantity: 1,
    };
    const anonymous = mockDatabase({ market: BINARY_MARKET });
    await expect(quoteMarket(anonymous.db, input)).rejects.toMatchObject({
      code: "USER_REQUIRED",
    });
    expect(anonymous.selectFrom).toHaveBeenCalledWith("markets");
    expect(anonymous.selectFrom).not.toHaveBeenCalledWith("holdings");

    const authenticated = mockDatabase({
      market: BINARY_MARKET,
      holdings: [0, 0.5],
    });
    await expect(quoteMarket(authenticated.db, input, "user-1")).rejects.toMatchObject({
      code: "INSUFFICIENT_HOLDINGS",
      details: { requested_quantity: 1, sellable_quantity: 0.5 },
    });
  });

  it("distinguishes a settled market from a missing market", async () => {
    const input: QuoteInput = {
      market_id: BINARY_MARKET.market_id,
      action: "buy",
      side: "yes",
      strike_index: 0,
      quantity: 1,
    };

    const settled = mockDatabase({ market: BINARY_MARKET, status: "settled" });
    await expect(quoteMarket(settled.db, input)).rejects.toMatchObject({
      code: "MARKET_SETTLED",
    });

    const missing = mockDatabase({});
    await expect(quoteMarket(missing.db, input)).rejects.toMatchObject({
      code: "MARKET_NOT_FOUND",
    });
  });

  it("rejects a non-canonical binary strike before loading holdings", async () => {
    const { db, selectFrom } = mockDatabase({ market: BINARY_MARKET });
    const invalidInput: QuoteInput = {
      market_id: BINARY_MARKET.market_id,
      action: "buy",
      side: "yes",
      strike_index: 1 as 0,
      quantity: 1,
    };

    await expect(quoteMarket(db, invalidInput)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(selectFrom).not.toHaveBeenCalledWith("holdings");
  });
});
