import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceError } from "../../src/lib/api/errors.js";
import type { ForwardTradeInput } from "../../src/lib/api/schemas.js";
import { DEALER_PARAMS } from "../../src/lib/config/dealer.js";
import { executeForwardTrade } from "../../src/lib/services/dealer/execute-forward-trade.js";
import {
  type ForwardInstrumentQuote,
  getInstrumentQuote,
} from "../../src/lib/services/dealer/get-instrument-quote.js";
import { runDealerJob } from "../../src/lib/services/dealer/run-dealer-job.js";
import { verifyDealer } from "../../src/lib/services/dealer/verify-dealer.js";
import { executeTrade } from "../../src/lib/services/execute-trade.js";
import { quoteMarket } from "../../src/lib/services/quote.js";
import { verifyReplay } from "../../src/lib/services/verify-replay.js";
import { insertUser, seedFixtureListings } from "./dealer-fixture.js";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

const runtime = vi.hoisted(() => ({ getRuntimeDatabase: vi.fn() }));
vi.mock("../../src/lib/db/runtime.js", () => runtime);

import { GET as quoteRoute } from "../../src/app/api/instruments/[instrumentId]/quote/route.js";

/**
 * Trading the dealer's books: forward fills at the live quote, and the
 * binary's LMSR addressed by market id with its price clamp.
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Dealer trading PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Dealer trading PostgreSQL integration";

const LISTED_AT = new Date("2026-10-20T00:00:00.000Z");
const RUN_AT = new Date("2026-10-20T00:05:00.000Z");
const TRADE_AT = new Date("2026-10-20T01:00:00.000Z");

async function expectServiceError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ServiceError);
  expect((error as ServiceError).code).toBe(code);
  return error as ServiceError;
}

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;
  let userId: string;
  let forwardId: string;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
    runtime.getRuntimeDatabase.mockImplementation(() => postgres.db);
  }, 30_000);

  beforeEach(async () => {
    await resetPostgresTestDatabase(postgres.db);
    await seedFixtureListings(postgres.db, LISTED_AT);
    await runDealerJob(postgres.db, "trading-1", RUN_AT);
    userId = await insertUser(postgres.db, "dealer-trader");
    const forward = await instrumentOf("modal", "forward");
    forwardId = forward.id;
  });

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  async function instrumentOf(slug: string, kind: "binary" | "forward") {
    return postgres.db
      .selectFrom("instruments")
      .innerJoin("listings", "listings.id", "instruments.listing_id")
      .innerJoin("companies", "companies.id", "listings.company_id")
      .innerJoin("markets", "markets.instrument_id", "instruments.id")
      .selectAll("instruments")
      .select(["markets.id as market_id"])
      .where("companies.slug", "=", slug)
      .where("instruments.kind", "=", kind)
      .orderBy("instruments.epoch", "desc")
      .executeTakeFirstOrThrow();
  }

  async function forwardQuote(
    query: Parameters<typeof getInstrumentQuote>[2] = {},
  ): Promise<ForwardInstrumentQuote> {
    const quote = await getInstrumentQuote(postgres.db, forwardId, query, TRADE_AT);
    if (quote.kind !== "forward") throw new Error("expected a forward quote");
    return quote;
  }

  function longInput(notionalUsd: string, maxEntryLn: number, key = randomUUID()) {
    return {
      idempotency_key: key,
      instrument_id: forwardId,
      side: "long",
      notional_usd: notionalUsd,
      max_entry_ln: maxEntryLn,
    } satisfies ForwardTradeInput;
  }

  function shortInput(notionalUsd: string, minEntryLn: number, key = randomUUID()) {
    return {
      idempotency_key: key,
      instrument_id: forwardId,
      side: "short",
      notional_usd: notionalUsd,
      min_entry_ln: minEntryLn,
    } satisfies ForwardTradeInput;
  }

  it("fills a long at the ask, writes the ledger rows and replays the key verbatim", async () => {
    const quote = await forwardQuote({ side: "long", notional_usd: "1000.00" });
    expect(quote.fill).toMatchObject({
      allowed: true,
      entry_ln: quote.ask_ln,
      collateral_cents: "100000",
      max_notional_cents: "2500000",
    });

    const input = longInput("1000.00", quote.ask_ln);
    const first = await executeForwardTrade(postgres.db, userId, input, { now: TRADE_AT });
    expect(first.replayed).toBe(false);
    expect(first.result).toMatchObject({
      kind: "forward",
      side: "long",
      notional_cents: "100000",
      entry_ln: quote.ask_ln,
      collateral_cents: "100000",
      inventory_before_cents: "0",
      inventory_after_cents: "-100000",
      cash_balance_cents: "9900000",
      market_sequence: "1",
    });

    const db = postgres.db;
    const trade = await db
      .selectFrom("trades")
      .selectAll()
      .where("id", "=", first.result.trade_id)
      .executeTakeFirstOrThrow();
    expect(trade).toMatchObject({
      contract_side: "long",
      strike_index: -1,
      quantity: 1000,
      cash_amount_cents: "100000",
      delta: [1000, 0],
      q_before: [0, 0],
      q_after: [1000, 0],
    });
    expect(trade.metric_after).toBe(quote.mid_usd);
    const position = await db
      .selectFrom("forward_positions")
      .selectAll()
      .where("trade_id", "=", trade.id)
      .executeTakeFirstOrThrow();
    expect(position).toMatchObject({
      user_id: userId,
      side: "long",
      notional_cents: "100000",
      entry_ln: quote.ask_ln,
      collateral_cents: "100000",
      settled_at: null,
      voided_at: null,
    });
    const market = await db
      .selectFrom("markets")
      .selectAll()
      .where("instrument_id", "=", forwardId)
      .executeTakeFirstOrThrow();
    expect(market).toMatchObject({
      q: [1000, 0],
      mm_cash_flow_cents: "100000",
      last_market_sequence: "1",
    });
    const fillQuote = await db
      .selectFrom("quotes")
      .selectAll()
      .where("trade_id", "=", trade.id)
      .executeTakeFirstOrThrow();
    expect(fillQuote).toMatchObject({ reason: "fill", ask_ln: quote.ask_ln, inventory_cents: "0" });

    // The dealer is now short the user's long (I < 0), so its quote skews up by γ·κ·|I|/Q.
    const after = await forwardQuote();
    expect(after.inventory_cents).toBe("-100000");
    expect(after.ask_ln).toBeGreaterThan(quote.ask_ln);
    expect(after.max_long_notional_cents).toBe("2400000");
    expect(after.max_short_notional_cents).toBe("2600000");

    const replay = await executeForwardTrade(postgres.db, userId, input, { now: TRADE_AT });
    expect(replay).toEqual({ result: first.result, replayed: true });
    await expectServiceError(
      executeForwardTrade(postgres.db, userId, { ...input, notional_usd: "999.00" }),
      "IDEMPOTENCY_CONFLICT",
    );

    const short = await executeForwardTrade(
      postgres.db,
      userId,
      shortInput("400.00", after.bid_ln),
      { now: TRADE_AT },
    );
    expect(short.result).toMatchObject({ entry_ln: after.bid_ln, inventory_after_cents: "-60000" });

    // dealer_pnl marks the open positions at the mid, from the dealer's side.
    const pnl = await db
      .selectFrom("dealer_pnl")
      .selectAll()
      .where("instrument_id", "=", forwardId)
      .executeTakeFirstOrThrow();
    const clip = (move: number) => Math.max(-1, Math.min(1, move));
    expect(pnl).toMatchObject({
      kind: "forward",
      market_status: "open",
      realised_cents: "0",
      open_collateral_cents: "140000",
      bound_cents: 2_500_000,
    });
    expect(pnl.unrealised_cents).toBeCloseTo(
      -100_000 * clip(quote.mid_ln - quote.ask_ln) + 40_000 * clip(quote.mid_ln - after.bid_ln),
      6,
    );

    // The dealer job requotes the moved inventory.
    const run = await runDealerJob(postgres.db, "trading-2", new Date("2026-10-20T01:05:00Z"));
    expect(run.status === "succeeded" && run.result.steps.requote.requoted).toEqual([
      expect.objectContaining({ instrument_id: forwardId }),
    ]);

    expect((await verifyReplay(db)).passed).toBe(true);
    expect(await verifyDealer(db)).toMatchObject({ passed: true, findings: [] });
  });

  it("refuses a moved price with the new quote", async () => {
    const quote = await forwardQuote();
    const long = await expectServiceError(
      executeForwardTrade(postgres.db, userId, longInput("100.00", quote.ask_ln - 1e-9), {
        now: TRADE_AT,
      }),
      "PRICE_MOVED",
    );
    expect(long.details).toMatchObject({ entry_ln: quote.ask_ln, ask_ln: quote.ask_ln });
    const short = await expectServiceError(
      executeForwardTrade(postgres.db, userId, shortInput("100.00", quote.bid_ln + 1e-9), {
        now: TRADE_AT,
      }),
      "PRICE_MOVED",
    );
    expect(short.details).toMatchObject({ entry_ln: quote.bid_ln });
    expect(await postgres.db.selectFrom("trades").select("id").execute()).toEqual([]);
  });

  it("refuses notional past the cap and says how much the side still takes", async () => {
    const quote = await forwardQuote({ side: "long", notional_usd: "25000.01" });
    expect(quote.fill).toMatchObject({ allowed: false, refusal: "exceeds_cap" });
    const refused = await expectServiceError(
      executeForwardTrade(postgres.db, userId, longInput("25000.01", quote.ask_ln + 1), {
        now: TRADE_AT,
      }),
      "CAP_EXCEEDED",
    );
    expect(refused.details).toMatchObject({
      side: "long",
      max_notional_cents: String(DEALER_PARAMS.dealer.cap_usd * 100),
      max_notional_usd: "25000.00",
    });
    const filled = await executeForwardTrade(
      postgres.db,
      userId,
      longInput("25000.00", quote.ask_ln + 1),
      { now: TRADE_AT },
    );
    expect(filled.result.inventory_after_cents).toBe("-2500000");
    const pulled = await expectServiceError(
      executeForwardTrade(postgres.db, userId, longInput("1.00", quote.ask_ln + 1), {
        now: TRADE_AT,
      }),
      "CAP_EXCEEDED",
    );
    expect(pulled.details).toMatchObject({ max_notional_cents: "0" });
  });

  it("refuses a position the user cannot collateralise", async () => {
    await postgres.db
      .updateTable("users")
      .set({ cash_balance_cents: "50000" })
      .where("id", "=", userId)
      .execute();
    const quote = await forwardQuote();
    const refused = await expectServiceError(
      executeForwardTrade(postgres.db, userId, longInput("500.01", quote.ask_ln), {
        now: TRADE_AT,
      }),
      "INSUFFICIENT_CASH",
    );
    expect(refused.details).toEqual({ cash_balance_cents: "50000", required_cents: "50001" });
  });

  it("refuses a forward after T", async () => {
    const forward = await instrumentOf("modal", "forward");
    const quote = await forwardQuote();
    await expectServiceError(
      executeForwardTrade(postgres.db, userId, longInput("1.00", quote.ask_ln), {
        now: new Date(forward.expires_at.getTime() + 1),
      }),
      "INSTRUMENT_CLOSED",
    );
  });

  it("serves the live quote at GET /api/instruments/[instrumentId]/quote", async () => {
    const call = (id: string, search = "") =>
      quoteRoute(new Request(`https://t.test/api/instruments/${id}/quote${search}`), {
        params: Promise.resolve({ instrumentId: id }),
      });
    const response = await call(forwardId, "?side=short&notional_usd=250.00");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      instrument_id: forwardId,
      kind: "forward",
      state: "quoting",
      flag_state: "normal",
      fill: { side: "short", allowed: true, collateral_cents: "25000" },
    });
    expect(body.fill.entry_ln).toBe(body.bid_ln);

    const binary = await instrumentOf("modal", "binary");
    const binaryResponse = await call(binary.id);
    expect(await binaryResponse.json()).toMatchObject({
      kind: "binary",
      market_id: binary.market_id,
      p_floor: DEALER_PARAMS.dealer.p_floor,
    });
    expect((await call(binary.id, "?side=long&notional_usd=1.00")).status).toBe(400);
    expect((await call(forwardId, "?side=long")).status).toBe(400);
    expect((await call("not-a-uuid")).status).toBe(400);
    expect((await call(randomUUID())).status).toBe(404);
  });

  it("trades the binary's LMSR by market id and refuses a trade past the clamp", async () => {
    const binary = await instrumentOf("modal", "binary");
    const buy = {
      market_id: binary.market_id,
      action: "buy",
      side: "yes",
      strike_index: 0,
      quantity: 100,
    } as const;
    const quote = await quoteMarket(postgres.db, buy, userId, TRADE_AT);
    expect(quote).toMatchObject({ market_id: binary.market_id, metric_kind: "yes_probability" });

    const traded = await executeTrade(
      postgres.db,
      userId,
      { ...buy, idempotency_key: randomUUID(), max_cost_usd: "100.00" },
      { now: TRADE_AT },
    );
    expect(traded.result).toMatchObject({
      side: "yes",
      shares: 100,
      cash_amount_cents: quote.cash_amount_cents,
      price_after: quote.price_after,
    });
    const fill = await postgres.db
      .selectFrom("quotes")
      .selectAll()
      .where("trade_id", "=", traded.result.trade_id)
      .executeTakeFirstOrThrow();
    expect(fill).toMatchObject({ reason: "fill", price: traded.result.current_metric });

    // Buying NO hard enough would push YES under p_floor: refused whole, at quote and at trade.
    const dump = { ...buy, side: "no", quantity: 10_000 } as const;
    const clamped = await expectServiceError(
      quoteMarket(postgres.db, dump, userId, TRADE_AT),
      "PRICE_CLAMPED",
    );
    expect(clamped.details).toMatchObject({ p_floor: DEALER_PARAMS.dealer.p_floor });
    await expectServiceError(
      executeTrade(
        postgres.db,
        userId,
        { ...dump, idempotency_key: randomUUID(), max_cost_usd: "100000.00" },
        { now: TRADE_AT },
      ),
      "PRICE_CLAMPED",
    );

    // The slug names a company's ladder book; a dealer book is reached by id only.
    await expectServiceError(
      quoteMarket(postgres.db, { ...buy, market_id: undefined, slug: "modal" }, userId, TRADE_AT),
      "MARKET_NOT_FOUND",
    );
    const forward = await instrumentOf("modal", "forward");
    await expectServiceError(
      quoteMarket(postgres.db, { ...buy, market_id: forward.market_id }, userId, TRADE_AT),
      "INVALID_INPUT",
    );
    await expectServiceError(
      quoteMarket(postgres.db, buy, userId, new Date(binary.expires_at.getTime() + 1)),
      "INSTRUMENT_CLOSED",
    );

    expect((await verifyReplay(postgres.db)).passed).toBe(true);
    expect(await verifyDealer(postgres.db)).toMatchObject({ passed: true, findings: [] });
  });
});
