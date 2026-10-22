import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ServiceError } from "../../src/lib/api/errors.js";
import { formatCentsAsUsd } from "../../src/lib/api/money.js";
import type { TradeInput } from "../../src/lib/api/schemas.js";
import {
  deriveAdvisoryLockKey,
  type ExecutionResult,
  executeTrade,
} from "../../src/lib/services/execute-trade.js";
import { quoteMarket } from "../../src/lib/services/quote.js";
import { verifyReplay } from "../../src/lib/services/verify-replay.js";
import {
  createBinaryBook,
  createPostgresTestDatabase,
  createTrader,
  holdAdvisoryLock,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  settleBinaryBook,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

interface TradeExecution {
  readonly result: ExecutionResult;
  readonly replayed: boolean;
}

const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Part 2 PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Part 2 PostgreSQL integration";

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
  }, 30_000);

  beforeEach(async () => {
    await resetPostgresTestDatabase(postgres.db);
  });

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  }, 30_000);

  async function seedBinary(slug = "integration-market") {
    return createBinaryBook(postgres.db, { slug, name: "Integration Market" });
  }

  function buyInput(
    marketId: string,
    quantity: number,
    maxCostUsd = "1000.00",
    idempotencyKey = randomUUID(),
  ): Extract<TradeInput, { action: "buy"; quantity: number }> {
    return {
      idempotency_key: idempotencyKey,
      market_id: marketId,
      action: "buy",
      side: "yes",
      strike_index: 0,
      quantity,
      max_cost_usd: maxCostUsd,
    };
  }

  function sellInput(
    marketId: string,
    quantity: number,
    idempotencyKey = randomUUID(),
  ): Extract<TradeInput, { action: "sell" }> {
    return {
      idempotency_key: idempotencyKey,
      market_id: marketId,
      action: "sell",
      side: "yes",
      strike_index: 0,
      quantity,
      min_proceeds_usd: "0.00",
    };
  }

  async function ledgerSnapshot(marketId: string, userId: string) {
    const market = await postgres.db
      .selectFrom("markets")
      .select([
        "q",
        "current_metric",
        "last_market_sequence",
        "mm_cash_flow_cents",
        "rounding_reserve_cents",
        "status",
        "settled_at",
      ])
      .where("id", "=", marketId)
      .executeTakeFirstOrThrow();
    const user = await postgres.db
      .selectFrom("users")
      .select("cash_balance_cents")
      .where("id", "=", userId)
      .executeTakeFirstOrThrow();
    const holding = await postgres.db
      .selectFrom("holdings")
      .select(["h", "updated_at"])
      .where("market_id", "=", marketId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    const trades = await postgres.db
      .selectFrom("trades")
      .select([
        "id",
        "market_sequence",
        "idempotency_key",
        "q_before",
        "q_after",
        "delta",
        "created_at",
      ])
      .where("market_id", "=", marketId)
      .orderBy("market_sequence", "asc")
      .execute();
    const marks = await postgres.db
      .selectFrom("marks")
      .select(["market_sequence", "trade_id", "ts", "value"])
      .where("market_id", "=", marketId)
      .orderBy("market_sequence", "asc")
      .execute();

    return { market, user, holding, trades, marks };
  }

  it("serializes simultaneous same-market trades with contiguous state and mark sequences", async () => {
    const seeded = await seedBinary();
    const firstUser = await createTrader(postgres.db, "SerialOne");
    const secondUser = await createTrader(postgres.db, "SerialTwo");

    const executions = await Promise.all([
      executeTrade(postgres.db, firstUser.id, buyInput(seeded.market.id, 2)),
      executeTrade(postgres.db, secondUser.id, buyInput(seeded.market.id, 3)),
    ]);
    const orderedExecutions = [...executions].sort((left, right) =>
      Number(BigInt(left.result.market_sequence) - BigInt(right.result.market_sequence)),
    );

    expect(orderedExecutions.map(({ result }) => result.market_sequence)).toEqual(["1", "2"]);

    const trades = await postgres.db
      .selectFrom("trades")
      .select(["id", "market_sequence", "q_before", "q_after", "metric_after", "created_at"])
      .where("market_id", "=", seeded.market.id)
      .orderBy("market_sequence", "asc")
      .execute();
    expect(trades).toHaveLength(2);
    expect(trades[1]!.q_before).toEqual(trades[0]!.q_after);

    const market = await postgres.db
      .selectFrom("markets")
      .select(["q", "last_market_sequence"])
      .where("id", "=", seeded.market.id)
      .executeTakeFirstOrThrow();
    expect(market.last_market_sequence).toBe("2");
    expect(market.q).toEqual(trades[1]!.q_after);

    const marks = await postgres.db
      .selectFrom("marks")
      .select(["market_sequence", "trade_id", "ts", "value"])
      .where("market_id", "=", seeded.market.id)
      .orderBy("market_sequence", "asc")
      .execute();
    expect(marks).toHaveLength(3);
    expect(marks[0]).toMatchObject({ market_sequence: "0", trade_id: null });

    for (const trade of trades) {
      const matching = marks.filter((mark) => mark.trade_id === trade.id);
      expect(matching).toHaveLength(1);
      expect(matching[0]).toMatchObject({
        market_sequence: trade.market_sequence,
        ts: trade.created_at,
        value: trade.metric_after,
      });
    }
    for (let index = 1; index < marks.length; index += 1) {
      expect(marks[index]!.ts.getTime()).toBeGreaterThanOrEqual(marks[index - 1]!.ts.getTime());
    }
  });

  it("allocates sequence by market serialization even when transaction start order is reversed", async () => {
    const seeded = await seedBinary("reverse-start");
    const olderUser = await createTrader(postgres.db, "OlderTxn");
    const newerUser = await createTrader(postgres.db, "NewerTxn");
    const olderInput = buyInput(seeded.market.id, 1);
    const blocker = await holdAdvisoryLock(
      postgres,
      deriveAdvisoryLockKey(olderInput.idempotency_key),
    );

    const olderExecutionPromise = executeTrade(postgres.db, olderUser.id, olderInput);
    let newerExecution: TradeExecution | undefined;
    let newerError: unknown;
    try {
      await blocker.waitForWaiter();
      newerExecution = await executeTrade(postgres.db, newerUser.id, buyInput(seeded.market.id, 1));
    } catch (error) {
      newerError = error;
    } finally {
      await blocker.release();
    }
    const olderExecution = await olderExecutionPromise;
    if (newerError !== undefined) throw newerError;

    expect(newerExecution!.result.market_sequence).toBe("1");
    expect(olderExecution.result.market_sequence).toBe("2");
    const stored = await postgres.db
      .selectFrom("trades")
      .select(["user_id", "market_sequence"])
      .where("market_id", "=", seeded.market.id)
      .orderBy("market_sequence", "asc")
      .execute();
    expect(stored).toEqual([
      { user_id: newerUser.id, market_sequence: "1" },
      { user_id: olderUser.id, market_sequence: "2" },
    ]);
  }, 10_000);

  it("orders tied mark timestamps by authoritative market sequence", async () => {
    const seeded = await seedBinary("tied-marks");
    const user = await createTrader(postgres.db, "TiedMarks");
    await executeTrade(postgres.db, user.id, buyInput(seeded.market.id, 1));
    await executeTrade(postgres.db, user.id, buyInput(seeded.market.id, 1));

    const seedMark = await postgres.db
      .selectFrom("marks")
      .select("ts")
      .where("market_id", "=", seeded.market.id)
      .where("market_sequence", "=", "0")
      .executeTakeFirstOrThrow();
    await sql`
      update marks
         set ts = ${seedMark.ts}
       where market_id = ${seeded.market.id}
    `.execute(postgres.db);

    const ordered = await postgres.db
      .selectFrom("marks")
      .select(["market_sequence", "ts"])
      .where("market_id", "=", seeded.market.id)
      .orderBy("ts", "asc")
      .orderBy("market_sequence", "asc")
      .execute();
    expect(new Set(ordered.map((mark) => mark.ts.toISOString())).size).toBe(1);
    expect(ordered.map((mark) => mark.market_sequence)).toEqual(["0", "1", "2"]);
  });

  it("serializes simultaneous duplicate idempotency keys into one stored body", async () => {
    const seeded = await seedBinary("idempotency");
    const user = await createTrader(postgres.db, "Idempotent");
    const input = buyInput(seeded.market.id, 2);

    const executions = await Promise.all([
      executeTrade(postgres.db, user.id, input),
      executeTrade(postgres.db, user.id, input),
    ]);

    expect(
      executions
        .map((execution) => execution.replayed)
        .sort((left, right) => Number(left) - Number(right)),
    ).toEqual([false, true]);
    expect(executions[0]!.result).toEqual(executions[1]!.result);

    const trades = await postgres.db
      .selectFrom("trades")
      .select(["execution_result", "idempotency_key", "user_id", "request_fingerprint"])
      .where("idempotency_key", "=", input.idempotency_key)
      .execute();
    expect(trades).toHaveLength(1);
    expect(trades[0]!.execution_result).toEqual(executions[0]!.result);
    expect(trades[0]).toMatchObject({ user_id: user.id });
    expect(trades[0]!.request_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const market = await postgres.db
      .selectFrom("markets")
      .select("last_market_sequence")
      .where("id", "=", seeded.market.id)
      .executeTakeFirstOrThrow();
    expect(market.last_market_sequence).toBe("1");
  });

  it("rejects cross-user reuse of an existing idempotency key without exposing or mutating the original execution", async () => {
    const seeded = await seedBinary("cross-user-idempotency");
    const originalUser = await createTrader(postgres.db, "KeyOwner");
    const otherUser = await createTrader(postgres.db, "KeyIntruder");
    const input = buyInput(seeded.market.id, 2);
    await executeTrade(postgres.db, originalUser.id, input);
    const before = await ledgerSnapshot(seeded.market.id, otherUser.id);

    const conflict = await executeTrade(postgres.db, otherUser.id, input).catch(
      (error: unknown) => error,
    );

    expect(conflict).toBeInstanceOf(ServiceError);
    if (!(conflict instanceof ServiceError)) throw conflict;
    expect(conflict.details).toEqual({});
    expect(conflict).not.toHaveProperty("result");
    expect(await ledgerSnapshot(seeded.market.id, otherUser.id)).toEqual(before);
  });

  it("rejects changed-request reuse of an existing idempotency key without writes", async () => {
    const seeded = await seedBinary("changed-request-idempotency");
    const user = await createTrader(postgres.db, "ChangedRequest");
    const input = buyInput(seeded.market.id, 2);
    await executeTrade(postgres.db, user.id, input);
    const before = await ledgerSnapshot(seeded.market.id, user.id);
    const changedInput: TradeInput = { ...input, max_cost_usd: "999.00" };

    const conflict = await executeTrade(postgres.db, user.id, changedInput).catch(
      (error: unknown) => error,
    );

    expect(conflict).toBeInstanceOf(ServiceError);
    if (!(conflict instanceof ServiceError)) throw conflict;
    expect(conflict.details).toEqual({});
    expect(conflict).not.toHaveProperty("result");
    expect(await ledgerSnapshot(seeded.market.id, user.id)).toEqual(before);
  });

  it("rolls back every write when a stale quote fails slippage", async () => {
    const seeded = await seedBinary("slippage");
    const user = await createTrader(postgres.db, "SlippageUser");
    const mover = await createTrader(postgres.db, "SlippageMover");
    const staleQuote = await quoteMarket(postgres.db, {
      market_id: seeded.market.id,
      action: "buy",
      side: "yes",
      strike_index: 0,
      quantity: 10,
    });
    await executeTrade(postgres.db, mover.id, buyInput(seeded.market.id, 200, "1000.00"));
    const before = await ledgerSnapshot(seeded.market.id, user.id);

    await expect(
      executeTrade(
        postgres.db,
        user.id,
        buyInput(seeded.market.id, 10, formatCentsAsUsd(Number(staleQuote.cash_amount_cents))),
      ),
    ).rejects.toMatchObject({ code: "PRICE_MOVED" });

    expect(await ledgerSnapshot(seeded.market.id, user.id)).toEqual(before);
  });

  it("rolls back cash, holdings, market, trades, and marks on overdraw", async () => {
    const seeded = await seedBinary("overdraw");
    const user = await createTrader(postgres.db, "OverdrawUser");
    const before = await ledgerSnapshot(seeded.market.id, user.id);

    await expect(
      executeTrade(postgres.db, user.id, buyInput(seeded.market.id, 200_000, "999999.00")),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CASH" });

    expect(await ledgerSnapshot(seeded.market.id, user.id)).toEqual(before);
  });

  it("rolls back an oversell without leaving the provisional holdings row", async () => {
    const seeded = await seedBinary("oversell");
    const user = await createTrader(postgres.db, "OversellUser");
    const before = await ledgerSnapshot(seeded.market.id, user.id);

    await expect(
      executeTrade(postgres.db, user.id, sellInput(seeded.market.id, 1)),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_HOLDINGS" });

    expect(await ledgerSnapshot(seeded.market.id, user.id)).toEqual(before);
  });

  it("credits EPS-low settlement entitlements exactly once and freezes the market", async () => {
    const seeded = await seedBinary("settlement");
    const epsLowUser = await createTrader(postgres.db, "EpsLowUser");
    const otherUser = await createTrader(postgres.db, "OtherHolder");
    await executeTrade(postgres.db, epsLowUser.id, buyInput(seeded.market.id, 1 - 5e-10));
    await executeTrade(postgres.db, otherUser.id, buyInput(seeded.market.id, 2));

    const balancesBefore = await postgres.db
      .selectFrom("users")
      .select(["id", "cash_balance_cents"])
      .where("id", "in", [epsLowUser.id, otherUser.id])
      .execute();
    const balanceBefore = new Map(
      balancesBefore.map((user) => [user.id, BigInt(user.cash_balance_cents)]),
    );
    await settleBinaryBook(postgres.db, seeded.market.id, "yes", "https://example.com/outcome");

    const balancesAfter = await postgres.db
      .selectFrom("users")
      .select(["id", "cash_balance_cents"])
      .where("id", "in", [epsLowUser.id, otherUser.id])
      .execute();
    const balanceAfter = new Map(
      balancesAfter.map((user) => [user.id, BigInt(user.cash_balance_cents)]),
    );
    expect(balanceAfter.get(epsLowUser.id)! - balanceBefore.get(epsLowUser.id)!).toBe(100n);
    expect(balanceAfter.get(otherUser.id)! - balanceBefore.get(otherUser.id)!).toBe(200n);

    const holdings = await postgres.db
      .selectFrom("holdings")
      .select("h")
      .where("market_id", "=", seeded.market.id)
      .execute();
    expect(holdings).toHaveLength(2);
    expect(holdings.every(({ h }) => h.every((quantity) => quantity === 0))).toBe(true);

    // The book is closed: a second settlement finds no open book to close.
    await expect(
      settleBinaryBook(postgres.db, seeded.market.id, "yes", "https://example.com/outcome"),
    ).rejects.toThrow();
    await expect(
      executeTrade(postgres.db, epsLowUser.id, buyInput(seeded.market.id, 1)),
    ).rejects.toMatchObject({ code: "MARKET_SETTLED" });

    const frozen = await postgres.db
      .selectFrom("markets")
      .select(["status", "last_market_sequence"])
      .where("id", "=", seeded.market.id)
      .executeTakeFirstOrThrow();
    const settlements = await postgres.db
      .selectFrom("settlements")
      .select("market_id")
      .where("market_id", "=", seeded.market.id)
      .execute();
    const finalBalances = await postgres.db
      .selectFrom("users")
      .select(["id", "cash_balance_cents"])
      .where("id", "in", [epsLowUser.id, otherUser.id])
      .execute();
    expect(frozen).toEqual({ status: "settled", last_market_sequence: "2" });
    expect(settlements).toHaveLength(1);
    expect(new Map(finalBalances.map((user) => [user.id, user.cash_balance_cents]))).toEqual(
      new Map(balancesAfter.map((user) => [user.id, user.cash_balance_cents])),
    );
  });

  it("reports clean replay state with contiguous trade and mark sequences", async () => {
    const seeded = await seedBinary("replay");
    const firstUser = await createTrader(postgres.db, "ReplayOne");
    const secondUser = await createTrader(postgres.db, "ReplayTwo");
    await executeTrade(postgres.db, firstUser.id, buyInput(seeded.market.id, 2));
    await executeTrade(postgres.db, secondUser.id, buyInput(seeded.market.id, 3));
    await executeTrade(postgres.db, firstUser.id, sellInput(seeded.market.id, 0.5));

    const diagnostics = await verifyReplay(postgres.db);
    expect(diagnostics.passed).toBe(true);
    expect(diagnostics.cashReconciliation).toMatchObject({
      differenceCents: "0",
      passed: true,
    });
    expect(diagnostics.summary).toMatchObject({
      marketCount: 1,
      failedMarketCount: 0,
      sequenceFailureCount: 0,
      tradeMarkCardinalityFailureCount: 0,
      tradeMarkDisagreementCount: 0,
      timestampInversionCount: 0,
    });
    expect(diagnostics.markets).toHaveLength(1);
    expect(diagnostics.markets[0]).toMatchObject({
      marketId: seeded.market.id,
      passed: true,
      tradeSequences: {
        observed: ["1", "2", "3"],
        missingRanges: [],
        contiguous: true,
        passed: true,
      },
      markSequences: {
        observed: ["0", "1", "2", "3"],
        missingRanges: [],
        contiguous: true,
        passed: true,
      },
      tradeMarkCardinality: [],
      tradeMarkDisagreements: [],
      timestampInversions: [],
    });
  });
});
