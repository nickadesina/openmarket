import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import type { SeedInput } from "../../src/lib/api/schemas.js";
import { DEVELOPMENT_DRAFT_SEED_MARKETS } from "../../src/lib/config/seed-markets.js";
import type {
  CompanyRow,
  Database,
  MarketRow,
} from "../../src/lib/db/schema.js";
import {
  VALUATION_BOUNDARIES_USD,
  VALUATION_BUCKET_COUNT,
  VALUATION_GRID_VERSION,
} from "../../src/lib/engine/buckets.js";
import {
  seedBinaryMarket,
  seedValuationMarket,
} from "../../src/lib/engine/seed.js";
import {
  BINARY_GRID_VERSION,
  seedMarket,
} from "../../src/lib/services/seed-market.js";

const CREATED_AT = new Date("2025-01-01T00:00:00.000Z");

interface StoredMark {
  market_id: string;
  market_sequence: string;
  trade_id: string | null;
  ts: Date;
  value: number;
}

interface FakeState {
  company?: CompanyRow;
  market?: MarketRow;
  marks: StoredMark[];
  trades: string[];
  holdings: string[];
  settled: boolean;
  nextMarketId: number;
  events: string[];
}

function valuationInput(
  overrides: Partial<Extract<SeedInput, { metric_kind: "valuation_median" }>> = {},
): Extract<SeedInput, { metric_kind: "valuation_median" }> {
  return {
    name: "Example Corp",
    slug: "example-corp",
    logo_path: "/logos/example.svg",
    metric_kind: "valuation_median",
    anchor_valuation_usd: "65000000000",
    anchor_date: "2025-01-15",
    anchor_description: "Verified public report",
    b: 15_000,
    sigma: 0.5,
    ...overrides,
  };
}

function binaryInput(
  overrides: Partial<Extract<SeedInput, { metric_kind: "yes_probability" }>> = {},
): Extract<SeedInput, { metric_kind: "yes_probability" }> {
  return {
    name: "Binary Corp",
    slug: "binary-corp",
    logo_path: "/logos/binary.svg",
    metric_kind: "yes_probability",
    yes_probability: 0.7,
    b: 1_000,
    ...overrides,
  };
}

function createFakeDatabase(): { db: Kysely<Database>; state: FakeState } {
  const state: FakeState = {
    marks: [],
    trades: [],
    holdings: [],
    settled: false,
    nextMarketId: 1,
    events: [],
  };

  const insertInto = vi.fn((table: keyof Database) => {
    const query: Record<string, Mock> = {};
    let values: Record<string, unknown> = {};
    query.values = vi.fn((nextValues: Record<string, unknown>) => {
      values = nextValues;
      return query;
    });
    query.onConflict = vi.fn(
      (callback: (builder: { column: Mock }) => unknown) => {
        const doUpdateSet = vi.fn(() => query);
        callback({ column: vi.fn(() => ({ doUpdateSet })) });
        return query;
      },
    );
    query.returningAll = vi.fn(() => query);
    query.executeTakeFirstOrThrow = vi.fn(async () => {
      if (table === "companies") {
        state.events.push("upsert-company");
        if (state.company === undefined) {
          state.company = {
            id: "00000000-0000-4000-8000-000000000001",
            name: values.name as string,
            slug: values.slug as string,
            logo_path: values.logo_path as string,
            created_at: CREATED_AT,
          };
        } else {
          state.company = {
            ...state.company,
            name: values.name as string,
            logo_path: values.logo_path as string,
          };
        }
        return state.company;
      }

      if (table === "markets") {
        state.events.push("insert-market");
        const market: MarketRow = {
          id: `00000000-0000-4000-8000-${String(state.nextMarketId).padStart(12, "0")}`,
          company_id: values.company_id as string,
          status: values.status as MarketRow["status"],
          n_buckets: values.n_buckets as number,
          bucket_grid_version: values.bucket_grid_version as string,
          metric_kind: values.metric_kind as MarketRow["metric_kind"],
          anchor_valuation: values.anchor_valuation as string | null,
          anchor_date: values.anchor_date as string | null,
          anchor_description: values.anchor_description as string | null,
          b: values.b as number,
          sigma: values.sigma as number | null,
          initial_q: values.initial_q as number[],
          q: values.q as number[],
          current_metric: values.current_metric as number,
          last_market_sequence: values.last_market_sequence as string,
          mm_cash_flow_cents: values.mm_cash_flow_cents as string,
          rounding_reserve_cents: values.rounding_reserve_cents as string,
          created_at: CREATED_AT,
          settled_at: values.settled_at as Date | null,
        };
        state.nextMarketId += 1;
        state.market = market;
        return market;
      }

      if (table === "marks") {
        state.events.push("insert-mark");
        state.marks.push({
          market_id: values.market_id as string,
          market_sequence: values.market_sequence as string,
          trade_id: values.trade_id as string | null,
          ts: CREATED_AT,
          value: values.value as number,
        });
        return {};
      }

      throw new Error(`Unexpected insert into ${table}`);
    });
    return query;
  });

  const selectFrom = vi.fn((table: keyof Database) => {
    const query: Record<string, Mock> = {};
    query.selectAll = vi.fn(() => query);
    query.select = vi.fn(() => query);
    query.where = vi.fn(() => query);
    query.limit = vi.fn(() => query);
    query.forUpdate = vi.fn(() => {
      state.events.push("lock-market");
      return query;
    });
    query.execute = vi.fn(async () => {
      if (table !== "marks") {
        throw new Error(`Unexpected execute on ${table}`);
      }
      state.events.push("read-marks");
      return state.marks.map(({ market_sequence, trade_id, value }) => ({
        market_sequence,
        trade_id,
        value,
      }));
    });
    query.executeTakeFirst = vi.fn(async () => {
      if (table === "markets") {
        return state.market;
      }
      if (table === "trades") {
        state.events.push("read-trades");
        return state.trades[0] === undefined ? undefined : { id: state.trades[0] };
      }
      if (table === "holdings") {
        state.events.push("read-holdings");
        return state.holdings[0] === undefined
          ? undefined
          : { user_id: state.holdings[0] };
      }
      if (table === "settlements") {
        state.events.push("read-settlement");
        return state.settled && state.market !== undefined
          ? { market_id: state.market.id }
          : undefined;
      }
      throw new Error(`Unexpected first row read from ${table}`);
    });
    return query;
  });

  const deleteFrom = vi.fn((table: keyof Database) => {
    const query: Record<string, Mock> = {};
    query.where = vi.fn(() => query);
    query.execute = vi.fn(async () => {
      if (table === "marks") {
        state.events.push("delete-mark");
        state.marks = [];
        return [];
      }
      if (table === "markets") {
        state.events.push("delete-market");
        delete state.market;
        return [];
      }
      throw new Error(`Unexpected delete from ${table}`);
    });
    return query;
  });

  const transaction = vi.fn(() => ({
    execute: vi.fn(
      async (callback: (transactionDb: unknown) => Promise<unknown>) =>
        callback({ insertInto, selectFrom, deleteFrom }),
    ),
  }));

  return {
    db: { transaction } as unknown as Kysely<Database>,
    state,
  };
}

describe("seedMarket", () => {
  it("creates a canonical valuation seed and exactly one sequence-zero mark", async () => {
    const { db, state } = createFakeDatabase();
    const input = valuationInput();
    const expected = seedValuationMarket(
      Number(input.anchor_valuation_usd),
      input.sigma,
      input.b,
      VALUATION_BOUNDARIES_USD,
    );

    const result = await seedMarket(db, input);

    expect(result.outcome).toBe("created");
    expect(result.market).toMatchObject({
      n_buckets: VALUATION_BUCKET_COUNT,
      bucket_grid_version: VALUATION_GRID_VERSION,
      metric_kind: "valuation_median",
      anchor_valuation: "65000000000.00",
      anchor_date: input.anchor_date,
      anchor_description: input.anchor_description,
      b: input.b,
      sigma: input.sigma,
      current_metric: expected.currentMetric,
      last_market_sequence: "0",
      mm_cash_flow_cents: "0",
      rounding_reserve_cents: "0",
      settled_at: null,
    });
    expect(result.market.initial_q).toEqual(expected.q);
    expect(result.market.q).toEqual(expected.q);
    expect(result.market.initial_q).not.toBe(result.market.q);
    expect(state.marks).toEqual([
      expect.objectContaining({
        market_id: result.market.id,
        market_sequence: "0",
        trade_id: null,
        value: expected.currentMetric,
      }),
    ]);
    expect(state.events.indexOf("lock-market")).toBeLessThan(
      state.events.indexOf("insert-market"),
    );
  });

  it("creates binary state in canonical NO, YES order", async () => {
    const { db, state } = createFakeDatabase();
    const input = binaryInput();
    const expected = seedBinaryMarket(input.yes_probability, input.b);

    const result = await seedMarket(db, input);

    expect(result.market).toMatchObject({
      n_buckets: 2,
      bucket_grid_version: BINARY_GRID_VERSION,
      metric_kind: "yes_probability",
      anchor_valuation: null,
      anchor_date: null,
      anchor_description: null,
      sigma: null,
      current_metric: input.yes_probability,
    });
    expect(result.market.q).toEqual(expected.q);
    expect(expected.probabilities).toEqual([0.3, 0.7]);
    expect(state.marks).toHaveLength(1);
    expect(state.marks[0]?.value).toBe(input.yes_probability);
  });

  it("returns an equivalent seed without touching its market or mark", async () => {
    const { db, state } = createFakeDatabase();
    const input = valuationInput();
    await seedMarket(db, input);
    const originalMarket = state.market;
    const originalMark = state.marks[0];
    state.events = [];

    const result = await seedMarket(db, {
      ...input,
      name: "Renamed Example Corp",
      logo_path: "/logos/example-new.svg",
    });

    expect(result.outcome).toBe("unchanged");
    expect(result.market).toBe(originalMarket);
    expect(state.marks[0]).toBe(originalMark);
    expect(result.company).toMatchObject({
      name: "Renamed Example Corp",
      logo_path: "/logos/example-new.svg",
    });
    expect(state.events).not.toContain("delete-mark");
    expect(state.events).not.toContain("delete-market");
    expect(state.events).not.toContain("insert-market");
    expect(state.events).not.toContain("insert-mark");
  });

  it("replaces only a pristine non-equivalent market", async () => {
    const { db, state } = createFakeDatabase();
    await seedMarket(db, valuationInput());
    const originalMarketId = state.market?.id;
    state.events = [];

    const result = await seedMarket(
      db,
      valuationInput({
        anchor_valuation_usd: "70000000000.00",
        anchor_description: "New verified report",
      }),
    );

    expect(result.outcome).toBe("reseeded");
    expect(result.market.id).not.toBe(originalMarketId);
    expect(state.marks).toHaveLength(1);
    expect(state.marks[0]?.market_id).toBe(result.market.id);
    expect(state.events.indexOf("delete-mark")).toBeLessThan(
      state.events.indexOf("delete-market"),
    );
    expect(state.events.indexOf("delete-market")).toBeLessThan(
      state.events.indexOf("insert-market"),
    );
  });

  it("refuses to replace a market with a trade", async () => {
    const { db, state } = createFakeDatabase();
    await seedMarket(db, valuationInput());
    state.trades.push("00000000-0000-4000-8000-000000000099");
    state.events = [];

    await expect(
      seedMarket(db, valuationInput({ b: 20_000 })),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(state.events).not.toContain("delete-mark");
    expect(state.events).not.toContain("delete-market");
    expect(state.events).not.toContain("insert-market");
  });

  it.each(["holding", "settlement"] as const)(
    "refuses replacement when a defensive %s reference exists",
    async (reference) => {
      const { db, state } = createFakeDatabase();
      await seedMarket(db, valuationInput());
      if (reference === "holding") {
        state.holdings.push("00000000-0000-4000-8000-000000000077");
      } else {
        state.settled = true;
      }
      state.events = [];

      await expect(
        seedMarket(db, valuationInput({ b: 20_000 })),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(state.events).not.toContain("delete-market");
    },
  );
});

describe("development seed configuration", () => {
  it("marks every draft anchor as unverified and deployment-blocking", () => {
    expect(DEVELOPMENT_DRAFT_SEED_MARKETS.map((seed) => seed.slug)).toEqual([
      "stripe",
      "anthropic",
    ]);
    for (const seed of DEVELOPMENT_DRAFT_SEED_MARKETS) {
      expect(seed.anchor_description).toMatch(/DEVELOPMENT DRAFT/i);
      expect(seed.anchor_description).toMatch(/not source-verified/i);
      expect(seed.anchor_description).toMatch(/before deployment/i);
    }
  });
});
