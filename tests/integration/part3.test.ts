import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { TradeInput } from "../../src/lib/api/schemas.js";
import { executeTrade } from "../../src/lib/services/execute-trade.js";
import { getActivity } from "../../src/lib/services/get-activity.js";
import { getMarket } from "../../src/lib/services/get-market.js";
import { getMarks } from "../../src/lib/services/get-marks.js";
import { listMarkets } from "../../src/lib/services/list-markets.js";
import { settleMarket } from "../../src/lib/services/settle-market.js";
import {
  createBinaryBook,
  createPostgresTestDatabase,
  createTrader,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
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
    slug: string,
    quantity: number,
  ): Extract<TradeInput, { action: "buy"; quantity: number }> {
    return {
      idempotency_key: randomUUID(),
      slug,
      action: "buy",
      side: "yes",
      strike_index: 0,
      quantity,
      max_cost_usd: "1000.00",
    };
  }

  it("reads one coherent traded market through list, detail, and marks services", async () => {
    const seeded = await seedBinary("part-three-read");
    const user = await createTrader(postgres.db, "PartThreeReader");
    await executeTrade(postgres.db, user.id, buyInput(seeded.company.slug, 3));
    const now = new Date(Date.now() + 1_000);

    const [list, detail, marks] = await Promise.all([
      listMarkets(postgres.db, { now }),
      getMarket(postgres.db, seeded.company.slug, { now }),
      getMarks(postgres.db, seeded.company.slug, "all", { now }),
    ]);

    expect(list.markets).toHaveLength(1);
    expect(list.markets[0]).toMatchObject({
      marketId: seeded.market.id,
      status: "open",
      sequence: "1",
      openInterest: 3,
    });
    expect(detail.openInterest).toBe(3);
    expect(detail.marketId).toBe(seeded.market.id);
    expect(detail.sequence).toBe("1");
    expect(detail.pmf).toHaveLength(2);
    expect(detail.pmf[0]! + detail.pmf[1]!).toBeCloseTo(1, 12);
    expect(detail.contracts).toHaveLength(1);
    expect(detail.contracts[0]?.strikeValueUsd).toBeNull();
    expect(detail.recentActivity).toHaveLength(1);
    expect(marks.points.map((point) => point.marketSequence)).toEqual(["0", "1"]);
    expect(marks.currentMetric).toBe(detail.metric.current);
    expect(Number.isFinite(marks.mark60Minutes)).toBe(true);
  });

  it("paginates public activity without exposing private trade state", async () => {
    const seeded = await seedBinary("part-three-activity");
    const user = await createTrader(postgres.db, "ActivityReader");
    await executeTrade(postgres.db, user.id, buyInput(seeded.company.slug, 1));
    await executeTrade(postgres.db, user.id, buyInput(seeded.company.slug, 2));

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

  it("returns immutable settlement metadata on a settled market", async () => {
    const seeded = await seedBinary("part-three-settled");
    await settleMarket(postgres.db, {
      slug: seeded.company.slug,
      confirm_slug: seeded.company.slug,
      settled_value_usd: "1.00",
      source_url: "https://example.com/part-three-settlement",
      source_description: "Part Three integration settlement",
    });

    const detail = await getMarket(postgres.db, seeded.company.slug);
    const list = await listMarkets(postgres.db);

    expect(detail.status).toBe("settled");
    expect(detail.settlement).toMatchObject({
      settledValueUsd: "1.00",
      winningBucket: 1,
      sourceUrl: "https://example.com/part-three-settlement",
    });
    expect(detail.settledAt).not.toBeNull();
    expect(list.markets[0]?.status).toBe("settled");
  });
});
