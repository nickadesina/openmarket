import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { executeForwardTrade } from "../../src/lib/services/dealer/execute-forward-trade.js";
import { getInstrumentQuote } from "../../src/lib/services/dealer/get-instrument-quote.js";
import { runDealerJob } from "../../src/lib/services/dealer/run-dealer-job.js";
import { executeTrade } from "../../src/lib/services/execute-trade.js";
import { quoteMarket } from "../../src/lib/services/quote.js";
import { getViewer } from "../../src/lib/services/tournament/forecaster.js";
import {
  attestRestrictions,
  getRestrictions,
} from "../../src/lib/services/tournament/restrictions.js";
import { seedFixtureListings } from "./dealer-fixture.js";
import {
  createPostgresTestDatabase,
  createTrader,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  sessionCookie,
  TEST_DATABASE_SKIP_REASON,
  type TestTrader,
  testDatabaseUrl,
} from "./postgres.js";

const runtime = vi.hoisted(() => ({ getRuntimeDatabase: vi.fn() }));
vi.mock("../../src/lib/db/runtime.js", () => runtime);
vi.mock("../../src/lib/logging/server-log.js", () => ({
  logReadRequest: vi.fn(),
  logMutationRequest: vi.fn(),
  logUnexpectedError: vi.fn(),
}));

import { POST as forwardTradeRoute } from "../../src/app/api/forward/trade/route.js";
import { GET as instrumentQuoteRoute } from "../../src/app/api/instruments/[instrumentId]/quote/route.js";
import { POST as quoteRoute } from "../../src/app/api/quote/route.js";
import {
  GET as restrictionsGet,
  POST as restrictionsPost,
} from "../../src/app/api/t/me/restrictions/route.js";
import { POST as tradeRoute } from "../../src/app/api/trade/route.js";

/**
 * Restricted persons (CONTRACTS.md, README D12): a forecaster's attested
 * names are refused at every quote and trade service, for both kinds,
 * while every other name trades as before.
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Restricted persons PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Restricted persons PostgreSQL integration";

const ORIGIN = "https://restricted.openmarket.test";
// Listed two days before the wall clock's date in this suite's calendar, so the routes' clock finds them live.
const LISTED_AT = new Date("2026-10-20T00:00:00.000Z");
const RUN_AT = new Date("2026-10-20T00:05:00.000Z");
const TRADE_AT = new Date("2026-10-20T01:00:00.000Z");

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;
  let insider: TestTrader;
  let cookie: string;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
    runtime.getRuntimeDatabase.mockImplementation(() => postgres.db);
  }, 30_000);

  beforeEach(async () => {
    await resetPostgresTestDatabase(postgres.db);
    await seedFixtureListings(postgres.db, LISTED_AT);
    await runDealerJob(postgres.db, "restricted-list", RUN_AT);
    insider = await createTrader(postgres.db, "insider");
    cookie = await sessionCookie(postgres.db, insider.tournamentUserId);
    vi.stubEnv("APP_ORIGIN", ORIGIN);
  });

  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  async function instrument(slug: string, kind: "binary" | "forward") {
    return postgres.db
      .selectFrom("instruments")
      .innerJoin("listings", "listings.id", "instruments.listing_id")
      .innerJoin("companies", "companies.id", "listings.company_id")
      .innerJoin("markets", "markets.instrument_id", "instruments.id")
      .select(["instruments.id", "markets.id as market_id"])
      .where("companies.slug", "=", slug)
      .where("instruments.kind", "=", kind)
      .executeTakeFirstOrThrow();
  }

  function binaryOrder(marketId: string) {
    return {
      idempotency_key: randomUUID(),
      market_id: marketId,
      action: "buy" as const,
      side: "yes" as const,
      strike_index: 0 as const,
      quantity: 10,
      max_cost_usd: "10.00",
    };
  }

  function forwardOrder(instrumentId: string) {
    return {
      idempotency_key: randomUUID(),
      instrument_id: instrumentId,
      side: "long" as const,
      notional_usd: "100.00",
      max_entry_ln: 100,
    };
  }

  function post(route: (request: Request) => Promise<Response>, path: string, body: unknown) {
    return route(
      new Request(`${ORIGIN}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, cookie },
        body: JSON.stringify(body),
      }),
    );
  }

  async function codeOf(response: Response) {
    return { status: response.status, code: (await response.json()).error?.code };
  }

  const refused = { status: 403, code: "RESTRICTED_PERSON" };

  it("throttles repeated restriction attestations", async () => {
    for (let index = 0; index < 10; index += 1) {
      const response = await post(restrictionsPost, "/api/t/me/restrictions", {
        companies: index % 2 === 0 ? ["modal"] : [],
      });
      expect(response.status).toBe(200);
    }
    expect(
      await codeOf(
        await post(restrictionsPost, "/api/t/me/restrictions", { companies: ["modal"] }),
      ),
    ).toEqual({ status: 429, code: "RATE_LIMITED" });
  });

  it("refuses every quote and trade on an attested name, of both kinds", async () => {
    await attestRestrictions(postgres.db, insider.tournamentUserId, ["anthropic"]);
    const binary = await instrument("anthropic", "binary");
    const forward = await instrument("anthropic", "forward");

    const restricted = expect.objectContaining({
      code: "RESTRICTED_PERSON",
      details: { company: "anthropic" },
    });
    await expect(
      executeTrade(postgres.db, insider.id, binaryOrder(binary.market_id), { now: TRADE_AT }),
    ).rejects.toEqual(restricted);
    const { idempotency_key: _key, max_cost_usd: _cost, ...quote } = binaryOrder(binary.market_id);
    await expect(quoteMarket(postgres.db, quote, insider.id, TRADE_AT)).rejects.toEqual(restricted);
    await expect(
      executeForwardTrade(postgres.db, insider.id, forwardOrder(forward.id), { now: TRADE_AT }),
    ).rejects.toEqual(restricted);
    await expect(
      getInstrumentQuote(postgres.db, forward.id, {}, TRADE_AT, {
        tournamentUserId: insider.tournamentUserId,
      }),
    ).rejects.toEqual(restricted);
    // The quote itself stays public to anyone not signed in.
    expect((await getInstrumentQuote(postgres.db, forward.id, {}, TRADE_AT)).kind).toBe("forward");

    // The same refusals at the routes, as a clear error code.
    expect(
      await codeOf(await post(tradeRoute, "/api/trade", binaryOrder(binary.market_id))),
    ).toEqual(refused);
    expect(await codeOf(await post(quoteRoute, "/api/quote", quote))).toEqual(refused);
    expect(
      await codeOf(await post(forwardTradeRoute, "/api/forward/trade", forwardOrder(forward.id))),
    ).toEqual(refused);
    const signedInQuote = await instrumentQuoteRoute(
      new Request(`${ORIGIN}/api/instruments/${forward.id}/quote`, { headers: { cookie } }),
      { params: Promise.resolve({ instrumentId: forward.id }) },
    );
    expect(await codeOf(signedInQuote)).toEqual(refused);

    // Nothing was written.
    const trades = await postgres.db.selectFrom("trades").select("id").execute();
    expect(trades).toEqual([]);

    // Another name trades as before, both kinds.
    const openaiBinary = await instrument("openai", "binary");
    const openaiForward = await instrument("openai", "forward");
    expect((await post(tradeRoute, "/api/trade", binaryOrder(openaiBinary.market_id))).status).toBe(
      200,
    );
    expect(
      (await post(forwardTradeRoute, "/api/forward/trade", forwardOrder(openaiForward.id))).status,
    ).toBe(200);
  });

  it("keeps an append-only history and lifts a restriction when the attestation drops it", async () => {
    const get = () =>
      restrictionsGet(new Request(`${ORIGIN}/api/t/me/restrictions`, { headers: { cookie } }));
    const initial = await (await get()).json();
    expect(initial).toMatchObject({ attested_at: null, restricted: [] });
    expect(initial.listed.map((company: { slug: string }) => company.slug)).toEqual([
      "anduril",
      "anthropic",
      "instinct",
      "modal",
      "openai",
    ]);

    const saved = await post(restrictionsPost, "/api/t/me/restrictions", {
      companies: ["modal", "anthropic"],
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ restricted: ["anthropic", "modal"] });
    expect(
      (await getViewer(postgres.db, insider.tournamentUserId))?.restrictedCompanySlugs,
    ).toEqual(["anthropic", "modal"]);

    // An unchanged list appends nothing; unknown names are refused.
    await post(restrictionsPost, "/api/t/me/restrictions", { companies: ["anthropic", "modal"] });
    expect(
      await codeOf(
        await post(restrictionsPost, "/api/t/me/restrictions", { companies: ["stripe"] }),
      ),
    ).toEqual({ status: 400, code: "INVALID_INPUT" });
    expect(
      await codeOf(
        await post(restrictionsPost, "/api/t/me/restrictions", { companies: ["Not A Slug"] }),
      ),
    ).toEqual({ status: 400, code: "INVALID_INPUT" });

    const cleared = await attestRestrictions(postgres.db, insider.tournamentUserId, []);
    expect(cleared.restricted).toEqual([]);
    const history = await postgres.db
      .selectFrom("tournament_restriction_attestations")
      .select("id")
      .where("user_id", "=", insider.tournamentUserId)
      .execute();
    expect(history).toHaveLength(2);
    await expect(
      postgres.db
        .deleteFrom("tournament_restriction_attestations")
        .where("user_id", "=", insider.tournamentUserId)
        .execute(),
    ).rejects.toThrow(/append-only/);

    const binary = await instrument("anthropic", "binary");
    expect((await post(tradeRoute, "/api/trade", binaryOrder(binary.market_id))).status).toBe(200);
    expect((await getRestrictions(postgres.db, insider.tournamentUserId)).attested_at).not.toBe(
      null,
    );

    const anonymous = await restrictionsGet(new Request(`${ORIGIN}/api/t/me/restrictions`));
    expect(await codeOf(anonymous)).toEqual({ status: 401, code: "USER_REQUIRED" });
  });
});
