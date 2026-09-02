import type { Kysely } from "kysely";
import { describe, expect, it, type Mock, vi } from "vitest";

import type { Database } from "../../src/lib/db/schema.js";
import { VALUATION_BUCKET_COUNT } from "../../src/lib/engine/buckets.js";
import { getMarket } from "../../src/lib/services/get-market.js";

function queryReturning(rows: readonly unknown[]): Record<string, Mock> {
  const query: Record<string, Mock> = {};
  for (const method of ["innerJoin", "select", "where", "orderBy", "limit"]) {
    query[method] = vi.fn(() => query);
  }
  query.execute = vi.fn(async () => rows);
  query.executeTakeFirst = vi.fn(async () => rows[0]);
  query.executeTakeFirstOrThrow = vi.fn(async () => {
    if (rows[0] === undefined) throw new Error("missing row");
    return rows[0];
  });
  return query;
}

function marketRow(overrides: Record<string, unknown> = {}) {
  return {
    market_id: "market-1",
    status: "open" as const,
    n_buckets: VALUATION_BUCKET_COUNT,
    bucket_grid_version: "valuation-v1",
    metric_kind: "valuation_median" as const,
    anchor_valuation: "1000000000.00",
    anchor_date: "2025-01-01",
    anchor_description: "Public round",
    b: 100,
    q: Array.from({ length: VALUATION_BUCKET_COUNT }, () => 0),
    current_metric: 100,
    last_market_sequence: "2",
    created_at: new Date("2025-01-01T00:00:00.000Z"),
    settled_at: null,
    company_name: "Acme",
    company_slug: "acme",
    company_logo_path: "/acme.svg",
    ...overrides,
  };
}

interface ReadRows {
  readonly market: readonly unknown[];
  readonly claims: readonly unknown[];
  readonly prior: readonly unknown[];
  readonly marks: readonly unknown[];
  readonly activity: readonly unknown[];
  readonly settlement: readonly unknown[];
}

function readDatabase(rows: ReadRows): {
  readonly db: Kysely<Database>;
  readonly setIsolationLevel: Mock;
  readonly setAccessMode: Mock;
} {
  const marketQuery = queryReturning(rows.market);
  const claimsQuery = queryReturning(rows.claims);
  const priorQuery = queryReturning(rows.prior);
  const marksQuery = queryReturning(rows.marks);
  const activityQuery = queryReturning(rows.activity);
  const settlementQuery = queryReturning(rows.settlement);
  let marksCall = 0;
  const selectFrom = vi.fn((table: string) => {
    if (table === "markets") return marketQuery;
    if (table === "marks") {
      marksCall += 1;
      return marksCall === 1 ? priorQuery : marksQuery;
    }
    if (table === "trades") return activityQuery;
    return settlementQuery;
  });
  const transactionDb = {
    selectFrom,
    selectNoFrom: vi.fn(() => claimsQuery),
  };
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

describe("getMarket", () => {
  it("builds the valuation PMF and monotonic canonical ladder without mutating q", async () => {
    const q = Object.freeze(Array.from({ length: VALUATION_BUCKET_COUNT }, () => 0));
    const qBefore = [...q];
    const { db, setIsolationLevel, setAccessMode } = readDatabase({
      market: [marketRow({ q })],
      claims: [{ outstanding_claims: 123.5 }],
      prior: [
        {
          market_sequence: "0",
          ts: new Date("2026-01-01T11:00:00.000Z"),
          value: 10,
        },
      ],
      marks: [
        {
          market_sequence: "1",
          ts: new Date("2026-01-01T11:30:00.000Z"),
          value: 30,
        },
      ],
      activity: [
        {
          market_sequence: "1",
          action: "buy",
          contract_side: "yes",
          strike_index: 10,
          strike_value: "31250000000.00",
          quantity: 2,
          cash_amount_cents: "100",
          metric_before: 10,
          metric_after: 30,
          created_at: new Date("2026-01-01T11:30:00.000Z"),
        },
      ],
      settlement: [],
    });

    const detail = await getMarket(db, "acme", {
      now: new Date("2026-01-01T12:00:00.000Z"),
    });

    expect(detail.pmf).toHaveLength(VALUATION_BUCKET_COUNT);
    expect(detail.pmf.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(detail.contracts).toHaveLength(VALUATION_BUCKET_COUNT - 1);
    for (let index = 1; index < detail.contracts.length; index += 1) {
      expect(detail.contracts[index]!.yesProbability).toBeLessThanOrEqual(
        detail.contracts[index - 1]!.yesProbability,
      );
    }
    expect(detail.metric.mark60Minutes).toBeCloseTo(20);
    expect(detail.outstandingClaims).toBe(123.5);
    expect(detail.recentActivity[0]).not.toHaveProperty("userId");
    expect(detail.settlement).toBeNull();
    expect(q).toEqual(qBefore);
    expect(setIsolationLevel).toHaveBeenCalledWith("repeatable read");
    expect(setAccessMode).toHaveBeenCalledWith("read only");
  });

  it("returns the one binary contract and JSON-safe settled metadata", async () => {
    const settledAt = new Date("2026-01-02T00:00:00.000Z");
    const { db } = readDatabase({
      market: [
        marketRow({
          status: "settled",
          n_buckets: 2,
          bucket_grid_version: "binary-v1",
          metric_kind: "yes_probability",
          anchor_valuation: null,
          anchor_date: null,
          anchor_description: null,
          b: 1,
          q: [0, Math.log(3)],
          current_metric: 0.75,
          last_market_sequence: "9",
          settled_at: settledAt,
        }),
      ],
      claims: [{ outstanding_claims: 0 }],
      prior: [],
      marks: [],
      activity: [],
      settlement: [
        {
          settled_value: "1.00",
          winning_bucket: 1,
          source_url: "https://example.com/outcome",
          source_description: "Final result",
          ts: settledAt,
        },
      ],
    });

    const detail = await getMarket(db, "acme", {
      now: new Date("2026-01-03T00:00:00.000Z"),
    });

    expect(detail.anchor).toBeNull();
    expect(detail.contracts).toHaveLength(1);
    expect(detail.contracts[0]).toMatchObject({
      strikeIndex: 0,
      strikeValueUsd: null,
    });
    expect(detail.contracts[0]!.yesProbability).toBeCloseTo(0.75);
    expect(detail.contracts[0]!.noProbability).toBeCloseTo(0.25);
    expect(detail.metric.mark60Minutes).toBe(0.75);
    expect(detail.sequence).toBe("9");
    expect(detail.settlement).toEqual(
      expect.objectContaining({
        settledValueUsd: "1.00",
        timestamp: settledAt.toISOString(),
      }),
    );
    expect(detail.settledAt).toBe(settledAt.toISOString());
  });
});
