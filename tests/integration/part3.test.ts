import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { TradeInput } from "../../src/lib/api/schemas.js";
import { executeTrade } from "../../src/lib/services/execute-trade.js";
import { getActivity } from "../../src/lib/services/get-activity.js";
import { getMarks } from "../../src/lib/services/get-marks.js";
import {
  createBinaryBook,
  createPostgresTestDatabase,
  createTrader,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  settleBinaryBook,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Part 3 PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Part 3 PostgreSQL integration";

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

  async function seedBinary(slug: string) {
    return createBinaryBook(postgres.db, { slug, name: "Part Three Integration" });
  }

  function buyInput(
    marketId: string,
    quantity: number,
  ): Extract<TradeInput, { action: "buy"; quantity: number }> {
    return {
      idempotency_key: randomUUID(),
      market_id: marketId,
      action: "buy",
      side: "yes",
      strike_index: 0,
      quantity,
      max_cost_usd: "1000.00",
    };
  }

  it("reads a traded book's marks by market id", async () => {
    const seeded = await seedBinary("part-three-read");
    const user = await createTrader(postgres.db, "PartThreeReader");
    await executeTrade(postgres.db, user.id, buyInput(seeded.market.id, 3));
    const now = new Date(Date.now() + 1_000);

    const marks = await getMarks(postgres.db, seeded.market.id, "all", { now });
    const book = await postgres.db
      .selectFrom("markets")
      .select("current_metric")
      .where("id", "=", seeded.market.id)
      .executeTakeFirstOrThrow();

    expect(marks.marketId).toBe(seeded.market.id);
    expect(marks.metricKind).toBe("yes_probability");
    expect(marks.points.map((point) => point.marketSequence)).toEqual(["0", "1"]);
    expect(marks.currentMetric).toBe(book.current_metric);
    expect(marks.openValue).toBe(0.5);
  });

  it("paginates public activity without exposing private trade state", async () => {
    const seeded = await seedBinary("part-three-activity");
    const user = await createTrader(postgres.db, "ActivityReader");
    await executeTrade(postgres.db, user.id, buyInput(seeded.market.id, 1));
    await executeTrade(postgres.db, user.id, buyInput(seeded.market.id, 2));

    const first = await getActivity(postgres.db, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await getActivity(postgres.db, {
      limit: 1,
      cursor: first.nextCursor!,
    });

    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.marketSequence).not.toBe(first.items[0]?.marketSequence);
    for (const item of [...first.items, ...second.items]) {
      expect(item).not.toHaveProperty("userId");
      expect(item).not.toHaveProperty("tournamentUserId");
      expect(item).not.toHaveProperty("idempotencyKey");
      expect(item).not.toHaveProperty("requestFingerprint");
      expect(item).not.toHaveProperty("cashBalanceCents");
    }
  });

  it("keeps a settled book readable by market id and refuses trades on it", async () => {
    const seeded = await seedBinary("part-three-settled");
    const user = await createTrader(postgres.db, "SettledReader");
    await executeTrade(postgres.db, user.id, buyInput(seeded.market.id, 1));
    await settleBinaryBook(postgres.db, seeded.market.id, "yes");

    const marks = await getMarks(postgres.db, seeded.market.id, "all", {
      now: new Date(Date.now() + 1_000),
    });
    expect(marks.points).toHaveLength(2);
    await expect(
      executeTrade(postgres.db, user.id, buyInput(seeded.market.id, 1)),
    ).rejects.toMatchObject({ code: "MARKET_SETTLED" });
  });
});
