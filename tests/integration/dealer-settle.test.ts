import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { settlementCreditCents } from "../../src/lib/engine/dealer/forward.js";
import { executeForwardTrade } from "../../src/lib/services/dealer/execute-forward-trade.js";
import { getInstrumentQuote } from "../../src/lib/services/dealer/get-instrument-quote.js";
import { runDealerJob } from "../../src/lib/services/dealer/run-dealer-job.js";
import { runSettleJob } from "../../src/lib/services/dealer/settle-instruments.js";
import { verifyDealer } from "../../src/lib/services/dealer/verify-dealer.js";
import { executeTrade } from "../../src/lib/services/execute-trade.js";
import { INITIAL_USER_BALANCE_CENTS } from "../../src/lib/services/user.js";
import { verifyReplay } from "../../src/lib/services/verify-replay.js";
import { fixtureFlagsFor } from "../services/event-flags-fixture.js";
import { insertFixtureFlags, insertUser, seedFixtureListings } from "./dealer-fixture.js";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

const runtime = vi.hoisted(() => ({ getRuntimeDatabase: vi.fn() }));
vi.mock("../../src/lib/db/runtime.js", () => runtime);

import { GET as settleRoute } from "../../src/app/api/cron/settle/route.js";

/**
 * The settle job against PostgreSQL (milestone 6 gate: a fixture print
 * settles both instruments of its name and rolls them, one transaction each).
 * Names are listed on 2026-09-01, each on its last round before that day, so
 * Instinct's anchor is its Series B and the fixture's Series C release of
 * 2026-09-28 is the first announcement after listing.
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Dealer settlement PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Dealer settlement PostgreSQL integration";

const LISTED_AT = new Date("2026-09-01T00:00:00.000Z");
const TRADE_AT = new Date("2026-09-10T12:00:00.000Z");
const SECRET = "a-long-enough-cron-secret";

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;
  let longUser: string;
  let shortUser: string;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
    runtime.getRuntimeDatabase.mockImplementation(() => postgres.db);
  }, 30_000);

  beforeEach(async () => {
    await resetPostgresTestDatabase(postgres.db);
    await seedFixtureListings(postgres.db, LISTED_AT);
    await runDealerJob(postgres.db, "settle-list", new Date("2026-09-01T00:05:00Z"));
    longUser = await insertUser(postgres.db, "long-yes");
    shortUser = await insertUser(postgres.db, "short-no");
  });

  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  async function instrumentsOf(slug: string) {
    return postgres.db
      .selectFrom("instruments")
      .innerJoin("listings", "listings.id", "instruments.listing_id")
      .innerJoin("companies", "companies.id", "listings.company_id")
      .innerJoin("markets", "markets.instrument_id", "instruments.id")
      .selectAll("instruments")
      .select([
        "markets.id as market_id",
        "markets.status as market_status",
        "markets.b",
        "markets.mm_cash_flow_cents",
      ])
      .where("companies.slug", "=", slug)
      .orderBy("instruments.kind")
      .orderBy("instruments.epoch")
      .execute();
  }

  async function cashOf(userId: string): Promise<bigint> {
    const row = await postgres.db
      .selectFrom("users")
      .select("cash_balance_cents")
      .where("id", "=", userId)
      .executeTakeFirstOrThrow();
    return BigInt(row.cash_balance_cents);
  }

  /** A long and a short on the forward, YES and NO on the binary. */
  async function tradeBoth(slug: string, longUsd: string, shortUsd: string) {
    const [binary, forward] = await instrumentsOf(slug);
    const quote = await getInstrumentQuote(postgres.db, forward!.id, {}, TRADE_AT);
    if (quote.kind !== "forward") throw new Error("expected a forward");
    const long = await executeForwardTrade(
      postgres.db,
      longUser,
      {
        idempotency_key: randomUUID(),
        instrument_id: forward!.id,
        side: "long",
        notional_usd: longUsd,
        max_entry_ln: quote.ask_ln + 1,
      },
      { now: TRADE_AT },
    );
    const short = await executeForwardTrade(
      postgres.db,
      shortUser,
      {
        idempotency_key: randomUUID(),
        instrument_id: forward!.id,
        side: "short",
        notional_usd: shortUsd,
        min_entry_ln: quote.bid_ln - 1,
      },
      { now: TRADE_AT },
    );
    for (const [userId, side] of [
      [longUser, "yes"],
      [shortUser, "no"],
    ] as const) {
      await executeTrade(
        postgres.db,
        userId,
        {
          idempotency_key: randomUUID(),
          market_id: binary!.market_id,
          action: "buy",
          side,
          strike_index: 0,
          quantity: 100,
          max_cost_usd: "100.00",
        },
        { now: TRADE_AT },
      );
    }
    return { long: long.result, short: short.result };
  }

  it("settles both of a name's instruments on a fixture print and lists their successors", async () => {
    const fills = await tradeBoth("instinct", "1000.00", "400.00");
    await insertFixtureFlags(
      postgres.db,
      "instinct",
      ["scoop", "release"],
      (flag) => flag.published_at > "2026-09-01",
    );
    await runDealerJob(postgres.db, "settle-dealer", new Date("2026-09-15T00:05:00Z"));
    const cashBefore = { long: await cashOf(longUser), short: await cashOf(shortUser) };

    vi.stubEnv("CRON_SECRET", SECRET);
    // The route runs on the wall clock; the fixture's calendar goes through the service.
    const now = new Date("2026-09-29T00:41:00.000Z");
    const outcome = await runSettleJob(postgres.db, "settle-1", now);
    expect(outcome.status).toBe("succeeded");
    if (outcome.status !== "succeeded") return;
    const summary = outcome.result;
    expect(summary).toMatchObject({ instruments: 10, resolved: 2, pending: [] });
    expect(summary.promoted).toHaveLength(1);

    // (a) The Series C release became a rank-1 print with the fixture's own key.
    const print = await postgres.db
      .selectFrom("event_flags")
      .selectAll()
      .where("id", "=", summary.promoted[0]!)
      .executeTakeFirstOrThrow();
    const fixturePrint = fixtureFlagsFor("instinct", ["print"]).find(
      (flag) => flag.published_at === "2026-09-28",
    )!;
    expect(print).toMatchObject({
      kind: "print",
      source_rank: 1,
      run_id: "settle-1",
      dedupe_key: fixturePrint.dedupe_key,
      published_at: new Date("2026-09-28T00:00:00Z"),
    });
    expect(print.source_url).toContain("businesswire.com");
    expect(print.promoted_from).not.toBeNull();

    // (b, c) Both instruments resolved; their books settled.
    const [binary, nextBinary, forward, nextForward] = await instrumentsOf("instinct");
    expect(binary).toMatchObject({ state: "resolved", market_status: "settled", closed_at: now });
    expect(binary!.resolution_json).toMatchObject({
      outcome: "yes",
      flag_kind: "release",
      source_rank: 1,
      rulebook_version: "1.0.0",
      successor_instrument_id: nextBinary!.id,
    });
    expect(forward).toMatchObject({ state: "resolved", market_status: "settled" });
    const settleLn = Math.log(10_000_000_000);
    expect(forward!.resolution_json).toMatchObject({
      outcome: "settled",
      event_id: print.id,
      settle_ln: settleLn,
      final: true,
      post_money_usd: 10_000_000_000,
      successor_instrument_id: nextForward!.id,
    });
    expect(summary.outcomes.filter((row) => row.outcome !== "open")).toEqual([
      expect.objectContaining({ instrument_id: binary!.id, outcome: "yes" }),
      expect.objectContaining({ instrument_id: forward!.id, outcome: "settled", final: true }),
    ]);

    const settlements = await postgres.db
      .selectFrom("settlements")
      .selectAll()
      .where("market_id", "in", [binary!.market_id, forward!.market_id])
      .execute();
    expect(settlements).toHaveLength(2);
    expect(settlements.find((row) => row.market_id === binary!.market_id)).toMatchObject({
      settled_value: "1.00",
      winning_bucket: 1,
    });
    expect(settlements.find((row) => row.market_id === forward!.market_id)).toMatchObject({
      settled_value: "10000000000.00",
      winning_bucket: -1,
      source_url: print.source_url,
    });

    // Payouts: $1 a YES share; each forward at collateral + N·clip(ln V − F₀, ±κ).
    const longCredit = settlementCreditCents(
      { side: "long", notionalCents: 100_000, entryLn: fills.long.entry_ln, kappa: 1 },
      settleLn,
    );
    const shortCredit = settlementCreditCents(
      { side: "short", notionalCents: 40_000, entryLn: fills.short.entry_ln, kappa: 1 },
      settleLn,
    );
    expect(await cashOf(longUser)).toBe(cashBefore.long + 10_000n + BigInt(longCredit));
    expect(await cashOf(shortUser)).toBe(cashBefore.short + BigInt(shortCredit));
    const positions = await postgres.db
      .selectFrom("forward_positions")
      .selectAll()
      .where("instrument_id", "=", forward!.id)
      .execute();
    for (const position of positions) {
      expect(position).toMatchObject({ settle_ln: settleLn, voided_at: null });
      expect(position.settled_at).toEqual(now);
    }

    // (d) Successors: the binary from the announcement, the forward from the print.
    expect(nextBinary).toMatchObject({ epoch: 2, state: "quoting", market_status: "open" });
    expect(nextBinary!.opens_at).toEqual(new Date("2026-09-28T00:00:00Z"));
    expect(nextBinary!.expires_at.toISOString()).toBe("2026-12-31T23:59:59.999Z");
    expect(nextForward).toMatchObject({ epoch: 2, state: "quoting", entry_ref_ln: settleLn });
    expect(nextForward!.opens_at).toEqual(now);
    const successorMid = await postgres.db
      .selectFrom("model_mids")
      .selectAll()
      .where("instrument_id", "=", nextForward!.id)
      .executeTakeFirstOrThrow();
    expect(successorMid.inputs_json).toMatchObject({
      anchor: { flag_id: print.id, post_money_usd: 10_000_000_000, date: "2026-09-28" },
    });

    // Nothing else moved, and a rerun under a new id settles nothing twice.
    for (const slug of ["openai", "anthropic", "anduril", "modal"]) {
      expect((await instrumentsOf(slug)).map((row) => row.state)).toEqual(["quoting", "quoting"]);
    }
    const again = await runSettleJob(postgres.db, "settle-2", new Date("2026-09-29T01:41:00Z"));
    expect(again.status === "succeeded" && again.result).toMatchObject({
      resolved: 0,
      promoted: [],
    });
    const rerun = await runSettleJob(postgres.db, "settle-1", now);
    expect(rerun.status).toBe("already_ran");

    expect((await verifyReplay(postgres.db)).passed).toBe(true);
    expect(await verifyDealer(postgres.db)).toMatchObject({ passed: true, findings: [] });
  });

  it("pays NO at the binary's expiry and voids the forward at T with a full refund", async () => {
    const opening = BigInt(INITIAL_USER_BALANCE_CENTS);
    await tradeBoth("modal", "2000.00", "1000.00");
    const binaryCosts = {
      long: opening - 200_000n - (await cashOf(longUser)),
      short: opening - 100_000n - (await cashOf(shortUser)),
    };

    // Past Sep 30's grace day: every listed binary pays NO and rolls; Modal's forward runs on.
    const october = await runSettleJob(postgres.db, "expiry-1", new Date("2026-10-02T00:41:00Z"));
    expect(october.status === "succeeded" && october.result.resolved).toBe(5);
    let [binary, nextBinary, forward] = await instrumentsOf("modal");
    expect(binary).toMatchObject({ state: "expired", market_status: "settled" });
    expect(binary!.resolution_json).toMatchObject({ outcome: "no" });
    expect(nextBinary).toMatchObject({ epoch: 2, state: "quoting" });
    expect(nextBinary!.opens_at).toEqual(new Date("2026-10-02T00:41:00Z"));
    expect(forward).toMatchObject({ state: "quoting" });
    expect(await cashOf(shortUser)).toBe(opening - 100_000n - binaryCosts.short + 10_000n);
    expect(await cashOf(longUser)).toBe(opening - 200_000n - binaryCosts.long);

    // Modal's T is 120 days from listing; a day of grace later the forward voids.
    const voidAt = new Date(forward!.expires_at.getTime() + 86_400_000 + 3_600_000);
    const lastMid = await postgres.db
      .selectFrom("model_mids")
      .select("mid_ln")
      .where("instrument_id", "=", forward!.id)
      .orderBy("computed_at", "desc")
      .executeTakeFirstOrThrow();
    const december = await runSettleJob(postgres.db, "expiry-2", voidAt);
    expect(december.status).toBe("succeeded");
    [binary, nextBinary, forward] = await instrumentsOf("modal");
    const nextForward = (await instrumentsOf("modal")).at(-1)!;
    expect(forward).toMatchObject({ state: "expired", market_status: "settled" });
    expect(forward!.resolution_json).toMatchObject({ outcome: "void", positions: 2 });
    expect(nextForward).toMatchObject({ kind: "forward", epoch: 2, entry_ref_ln: lastMid.mid_ln });
    expect(await cashOf(longUser)).toBe(opening - binaryCosts.long);
    expect(await cashOf(shortUser)).toBe(opening - binaryCosts.short + 10_000n);
    const positions = await postgres.db
      .selectFrom("forward_positions")
      .selectAll()
      .where("instrument_id", "=", forward!.id)
      .execute();
    expect(positions.every((row) => row.voided_at !== null && row.payout_cents === null)).toBe(
      true,
    );
    expect(forward!.mm_cash_flow_cents).toBe("0");

    expect((await verifyReplay(postgres.db)).passed).toBe(true);
    expect(await verifyDealer(postgres.db)).toMatchObject({ passed: true, findings: [] });
  });

  it("guards GET /api/cron/settle with the cron secret and reruns by id", async () => {
    const call = (headers: Record<string, string>) =>
      settleRoute(new Request("https://t.test/api/cron/settle", { headers }));
    expect((await call({ authorization: `Bearer ${SECRET}` })).status).toBe(401);
    vi.stubEnv("CRON_SECRET", SECRET);
    const headers = { authorization: `Bearer ${SECRET}`, "x-run-id": "settle-route-1" };
    const first = await call(headers);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "succeeded", run_id: "settle-route-1" });
    expect(await (await call(headers)).json()).toMatchObject({ status: "already_ran" });
  });
});
