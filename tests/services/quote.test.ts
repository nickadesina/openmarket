import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import type { QuoteInput } from "../../src/lib/api/schemas.js";
import type { Database, MetricKind } from "../../src/lib/db/schema.js";
import {
  VALUATION_BOUNDARIES_USD,
  VALUATION_BUCKET_COUNT,
  VALUATION_GRID_VERSION,
} from "../../src/lib/engine/buckets.js";
import { contractMask } from "../../src/lib/engine/contracts.js";
import {
  probabilities,
  solveBuyQuantityForSpend,
} from "../../src/lib/engine/lmsr.js";
import { impliedValuationMedian } from "../../src/lib/engine/median.js";
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
  readonly latestStatus?: "open" | "settled";
  readonly holdings?: number[];
}

function queryReturning(result: unknown): Record<string, Mock> {
  const query: Record<string, Mock> = {};
  query.innerJoin = vi.fn(() => query);
  query.select = vi.fn(() => query);
  query.where = vi.fn(() => query);
  query.orderBy = vi.fn(() => query);
  query.executeTakeFirst = vi.fn(async () => result);
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
  let companyQueryCount = 0;
  const selectFrom = vi.fn((table: string) => {
    if (table === "companies") {
      companyQueryCount += 1;
      return queryReturning(
        companyQueryCount === 1
          ? options.market
          : options.latestStatus === undefined
            ? undefined
            : { status: options.latestStatus },
      );
    }
    if (table === "holdings") {
      return queryReturning(
        options.holdings === undefined ? undefined : { h: options.holdings },
      );
    }
    throw new Error(`Unexpected table ${table}`);
  });
  const transactionDatabase = {
    selectFrom,
  } as unknown as Kysely<Database>;
  const transactionBuilder: Record<string, Mock> = {};
  const setIsolationLevel = vi.fn(() => transactionBuilder);
  const setAccessMode = vi.fn(() => transactionBuilder);
  const execute = vi.fn(
    async (
      callback: (transaction: Kysely<Database>) => Promise<unknown>,
    ): Promise<unknown> => callback(transactionDatabase),
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

const VALUATION_MARKET: MarketFixture = {
  market_id: "00000000-0000-4000-8000-000000000011",
  n_buckets: VALUATION_BUCKET_COUNT,
  bucket_grid_version: VALUATION_GRID_VERSION,
  metric_kind: "valuation_median",
  b: 100,
  q: new Array<number>(VALUATION_BUCKET_COUNT).fill(0),
  last_market_sequence: "12",
};

describe("quoteMarket", () => {
  it("quotes an anonymous valuation buy from zero holdings", async () => {
    const {
      db,
      selectFrom,
      transaction,
      setIsolationLevel,
      setAccessMode,
      execute,
    } = mockDatabase({
      market: VALUATION_MARKET,
    });
    const input: QuoteInput = {
      slug: "acme",
      action: "buy",
      side: "yes",
      strike_index: 10,
      quantity: 2,
    };

    const result = await quoteMarket(db, input);
    const mask = contractMask(VALUATION_BUCKET_COUNT, 10, "yes");
    const qAfter = VALUATION_MARKET.q.map((value, index) =>
      mask[index] ? value + 2 : value,
    );
    const distributionAfter = probabilities(qAfter, VALUATION_MARKET.b);

    expect(result).toMatchObject({
      market_id: VALUATION_MARKET.market_id,
      action: "buy",
      side: "yes",
      strike_index: 10,
      strike_value: VALUATION_BOUNDARIES_USD[10]!.toFixed(2),
      metric_kind: "valuation_median",
      quantity: 2,
      current_metric_after: impliedValuationMedian(
        distributionAfter,
        VALUATION_BOUNDARIES_USD,
      ),
      expected_redemption_quantity: 0,
      expected_redemption_cents: "0",
      sellable_quantity: 2,
      market_state_fingerprint: `${VALUATION_MARKET.market_id}:12`,
    });
    expect(result.price_before).toBeCloseTo(
      (VALUATION_BUCKET_COUNT - 11) / VALUATION_BUCKET_COUNT,
      15,
    );
    expect(Number.isFinite(result.average_price)).toBe(true);
    expect(Number.isSafeInteger(Number(result.cash_amount_cents))).toBe(true);
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
      slug: "acme",
      action: "buy",
      side: "yes",
      strike_index: 0,
      spend_usd: "1.00",
    };
    const expected = solveBuyQuantityForSpend(
      BINARY_MARKET.q,
      [false, true],
      BINARY_MARKET.b,
      100,
    );

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
      slug: "acme",
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
      slug: "acme",
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
      slug: "acme",
      action: "sell",
      side: "yes",
      strike_index: 0,
      quantity: 1,
    };
    const anonymous = mockDatabase({ market: BINARY_MARKET });
    await expect(quoteMarket(anonymous.db, input)).rejects.toMatchObject({
      code: "USER_REQUIRED",
    });
    expect(anonymous.selectFrom).toHaveBeenCalledWith("companies");
    expect(anonymous.selectFrom).not.toHaveBeenCalledWith("holdings");

    const authenticated = mockDatabase({
      market: BINARY_MARKET,
      holdings: [0, 0.5],
    });
    await expect(
      quoteMarket(authenticated.db, input, "user-1"),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_HOLDINGS",
      details: { requested_quantity: 1, sellable_quantity: 0.5 },
    });
  });

  it("distinguishes a settled market from a missing market", async () => {
    const input: QuoteInput = {
      slug: "acme",
      action: "buy",
      side: "yes",
      strike_index: 0,
      quantity: 1,
    };

    const settled = mockDatabase({ latestStatus: "settled" });
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
      slug: "acme",
      action: "buy",
      side: "yes",
      strike_index: 1,
      quantity: 1,
    };

    await expect(quoteMarket(db, invalidInput)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(selectFrom).not.toHaveBeenCalledWith("holdings");
  });
});
