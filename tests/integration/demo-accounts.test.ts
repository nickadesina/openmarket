import { randomUUID } from "node:crypto";

import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { seedDemo } from "../../scripts/seed-demo.js";
import { questionInputSchema } from "../../src/lib/api/tournament-schemas.js";
import { createTournamentSession } from "../../src/lib/auth/tournament-session.js";
import { DEMO_ACCOUNTS } from "../../src/lib/config/demo-accounts.js";
import type { Database } from "../../src/lib/db/schema.js";
import { runDealerJob } from "../../src/lib/services/dealer/run-dealer-job.js";
import { executeTrade } from "../../src/lib/services/execute-trade.js";
import { getActivity } from "../../src/lib/services/get-activity.js";
import { getMarket } from "../../src/lib/services/get-market.js";
import { listMarkets } from "../../src/lib/services/list-markets.js";
import {
  closeQuestion,
  openQuestion,
  resolveQuestion,
  saveDraftQuestion,
} from "../../src/lib/services/tournament/admin.js";
import { getForecaster } from "../../src/lib/services/tournament/forecaster.js";
import { getLeaderboard } from "../../src/lib/services/tournament/leaderboard.js";
import {
  registerPasswordAccount,
  verifyPasswordAccount,
} from "../../src/lib/services/tournament/password-account.js";
import { upsertIdentity } from "../../src/lib/services/tournament/sign-in.js";
import { submitForecast } from "../../src/lib/services/tournament/submit-forecast.js";
import { verifyReplay } from "../../src/lib/services/verify-replay.js";
import { seedFixtureListings } from "./dealer-fixture.js";
import {
  createPostgresTestDatabase,
  createTrader,
  migrateTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

/**
 * Decision 0005: `seed:demo` creates five labelled demo accounts that trade
 * the listed names through the real services, once, and nothing else; they
 * never sign in, forecast or reach the leaderboard. Migration 015 holds the
 * flag and the database's refusals.
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Demo accounts PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Demo accounts PostgreSQL integration";

const LISTED_AT = new Date("2026-10-20T00:00:00.000Z");
const RUN_AT = new Date("2026-10-20T00:05:00.000Z");
/** The seed runs two weeks after the dealer first quoted, so the history window is the whole fortnight. */
const SEED_NOW = new Date("2026-11-03T00:05:00.000Z");
const TRADE_AT = SEED_NOW.getTime();
const HOUR = 60 * 60 * 1000;

async function listAndQuote(db: Kysely<Database>): Promise<void> {
  await seedFixtureListings(db, LISTED_AT);
  await runDealerJob(db, `demo-${randomUUID()}`, RUN_AT);
}

async function demoUserIds(db: Kysely<Database>): Promise<string[]> {
  const rows = await db
    .selectFrom("tournament_users")
    .select("id")
    .where("demo", "=", true)
    .execute();
  return rows.map((row) => row.id);
}

/** Every demo fill in tape order, by name and contract rather than by row id. */
async function demoBook(db: Kysely<Database>) {
  return db
    .selectFrom("trades")
    .innerJoin("markets", "markets.id", "trades.market_id")
    .innerJoin("companies", "companies.id", "markets.company_id")
    .innerJoin("users", "users.id", "trades.user_id")
    .innerJoin(
      "tournament_identities as identities",
      "identities.user_id",
      "users.tournament_user_id",
    )
    .select([
      "companies.slug",
      "markets.metric_kind",
      "identities.handle",
      "trades.action",
      "trades.contract_side",
      "trades.quantity",
      "trades.cash_amount_cents",
      "trades.metric_after",
      "trades.created_at",
    ])
    .orderBy("trades.created_at")
    .orderBy("trades.market_sequence")
    .execute();
}

async function count(db: Kysely<Database>, table: keyof Database): Promise<number> {
  const { rows } = await sql<{ count: string }>`select count(*) from ${sql.table(table)}`.execute(
    db,
  );
  return Number(rows[0]!.count);
}

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
  });

  it("seeds five demo accounts with trades on both contracts, once, and replay verifies", async () => {
    const db = postgres.db;
    await listAndQuote(db);

    const seeded = await seedDemo(db, { now: SEED_NOW });
    expect(seeded).toMatchObject({ outcome: "seeded", accounts: 5 });
    if (seeded.outcome !== "seeded") throw new Error("not seeded");
    expect(seeded.filled).toBeGreaterThan(50);

    const ids = await demoUserIds(db);
    expect(ids).toHaveLength(5);
    const identities = await db
      .selectFrom("tournament_identities")
      .select(["provider", "handle", "display_name", "avatar_url", "user_id"])
      .where("user_id", "in", ids)
      .orderBy("handle")
      .execute();
    expect(
      identities.map(({ provider, handle, display_name, avatar_url }) => ({
        provider,
        handle,
        display_name,
        avatar_url,
      })),
    ).toEqual(
      DEMO_ACCOUNTS.map((account) => ({
        provider: "password",
        handle: account.handle,
        display_name: account.displayName,
        avatar_url: null,
      })),
    );
    const affiliations = await db
      .selectFrom("tournament_users")
      .select("affiliation")
      .where("id", "in", ids)
      .execute();
    expect(affiliations.every((row) => row.affiliation === null)).toBe(true);

    const book = await demoBook(db);
    expect(book).toHaveLength(seeded.filled);
    expect(new Set(book.map((trade) => trade.handle))).toEqual(
      new Set(DEMO_ACCOUNTS.map((account) => account.handle)),
    );
    expect(new Set(book.map((trade) => trade.slug)).size).toBe(5);
    expect(new Set(book.map((trade) => trade.contract_side))).toEqual(
      new Set(["long", "short", "yes", "no"]),
    );
    const binaryActions = book
      .filter((trade) => trade.metric_kind === "yes_probability")
      .map((trade) => trade.action);
    expect(new Set(binaryActions)).toEqual(new Set(["buy", "sell"]));

    const modal = await getMarket(db, "modal", { now: new Date(TRADE_AT + HOUR) });
    expect(modal.openInterest.forwardNotionalUsd).toBeGreaterThan(0);
    expect(modal.openInterest.binaryUsd).toBeGreaterThan(0);

    // The flow nets out: quotes stay near the model, not pushed to a level.
    for (const listing of (await listMarkets(db, { now: new Date(TRADE_AT + HOUR) })).listings) {
      const forward = listing.forward!;
      expect(Math.abs((forward.bid_ln + forward.ask_ln) / 2 - forward.mid_ln)).toBeLessThan(0.03);
      expect(Math.abs(listing.binary!.yes_price - listing.binary!.model_p)).toBeLessThan(0.05);
    }

    const replay = await verifyReplay(db);
    expect(replay.passed).toBe(true);

    // A second run changes nothing.
    const snapshot = {
      trades: await count(db, "trades"),
      quotes: await count(db, "quotes"),
      users: await count(db, "users"),
      tournamentUsers: await count(db, "tournament_users"),
      markets: await db.selectFrom("markets").select(["id", "q"]).orderBy("id").execute(),
    };
    expect(await seedDemo(db, { now: SEED_NOW })).toEqual({
      outcome: "already_seeded",
      trades: seeded.filled,
    });
    expect({
      trades: await count(db, "trades"),
      quotes: await count(db, "quotes"),
      users: await count(db, "users"),
      tournamentUsers: await count(db, "tournament_users"),
      markets: await db.selectFrom("markets").select(["id", "q"]).orderBy("id").execute(),
    }).toEqual(snapshot);
  });

  it("spreads the trades over the window, never before a book's honest floor or after now", async () => {
    const db = postgres.db;
    await listAndQuote(db);
    // A real fill ten days in moves the Modal binary's floor: no demo trade there may precede it.
    const realAt = new Date(RUN_AT.getTime() + 10 * 24 * HOUR);
    const trader = await createTrader(db, "early_trader");
    const modal = await getMarket(db, "modal", { now: realAt });
    await executeTrade(
      db,
      trader.id,
      {
        idempotency_key: randomUUID(),
        market_id: modal.binary!.market_id,
        side: "yes",
        strike_index: 0,
        action: "buy",
        spend_usd: "25.00",
        max_cost_usd: "25.00",
      },
      { now: realAt },
    );

    const seeded = await seedDemo(db, { now: SEED_NOW });
    if (seeded.outcome !== "seeded") throw new Error("not seeded");
    const rows = await db
      .selectFrom("trades")
      .innerJoin("users", "users.id", "trades.user_id")
      .innerJoin("tournament_users", "tournament_users.id", "users.tournament_user_id")
      .innerJoin("markets", "markets.id", "trades.market_id")
      .innerJoin("instruments", "instruments.id", "markets.instrument_id")
      .innerJoin("listings", "listings.id", "instruments.listing_id")
      .select([
        "trades.created_at",
        "trades.market_id",
        "instruments.opens_at",
        "listings.listed_at",
      ])
      .where("tournament_users.demo", "=", true)
      .execute();
    const times = rows.map((row) => row.created_at.getTime());
    for (const row of rows) {
      // The dealer's first quotes (RUN_AT) are every book's floor but Modal's binary.
      expect(row.created_at.getTime()).toBeGreaterThan(RUN_AT.getTime());
      expect(row.created_at.getTime()).toBeGreaterThanOrEqual(row.opens_at.getTime());
      expect(row.created_at.getTime()).toBeGreaterThanOrEqual(row.listed_at.getTime());
      expect(row.created_at.getTime()).toBeLessThanOrEqual(SEED_NOW.getTime());
      if (row.market_id === modal.binary!.market_id) {
        expect(row.created_at.getTime()).toBeGreaterThan(realAt.getTime());
      }
    }
    expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(7 * 24 * HOUR);
    expect(seeded.from).toBe(new Date(Math.min(...times)).toISOString());
    expect(seeded.to).toBe(new Date(Math.max(...times)).toISOString());

    // Marks keep sequence order in time, and every quote and reference row still recomputes.
    const replay = await verifyReplay(db);
    expect(replay.passed).toBe(true);
    await runDealerJob(db, `demo-after-${randomUUID()}`, new Date(SEED_NOW.getTime() + HOUR));
    expect((await verifyReplay(db)).passed).toBe(true);
  });

  it("writes the same book from the fixed seed on a fresh database", async () => {
    const db = postgres.db;
    await listAndQuote(db);
    await seedDemo(db, { now: SEED_NOW });
    const first = await demoBook(db);

    await resetPostgresTestDatabase(db);
    await listAndQuote(db);
    await seedDemo(db, { now: SEED_NOW });
    expect(await demoBook(db)).toEqual(first);
  });

  it("tags demo fills in the activity a market page and the board read, and no one else's", async () => {
    const db = postgres.db;
    await listAndQuote(db);
    await seedDemo(db, { now: SEED_NOW });
    const trader = await createTrader(db, "real_trader");
    const before = await getMarket(db, "anduril", { now: new Date(TRADE_AT + HOUR) });
    await executeTrade(
      db,
      trader.id,
      {
        idempotency_key: randomUUID(),
        market_id: before.binary!.market_id,
        side: "yes",
        strike_index: 0,
        action: "buy",
        spend_usd: "25.00",
        max_cost_usd: "25.00",
      },
      { now: new Date(TRADE_AT + HOUR) },
    );

    const page = await getActivity(db, { slug: "anduril", limit: 100 });
    expect(page.items[0]!.demo).toBe(false);
    expect(page.items.slice(1).length).toBeGreaterThan(0);
    expect(page.items.slice(1).every((item) => item.demo)).toBe(true);
    const all = await getActivity(db, { limit: 100 });
    expect(all.items.filter((item) => !item.demo)).toHaveLength(1);
  });

  it("gives demo accounts no way to sign in and no forecast", async () => {
    const db = postgres.db;
    await listAndQuote(db);
    await seedDemo(db, { now: SEED_NOW });
    const ids = await demoUserIds(db);

    for (const table of [
      "tournament_password_credentials",
      "tournament_sessions",
      "tournament_forecast_events",
    ] as const) {
      expect(
        await db.selectFrom(table).select("user_id").where("user_id", "in", ids).execute(),
        table,
      ).toEqual([]);
    }
    expect(
      await db
        .selectFrom("tournament_identities")
        .select("provider")
        .where("user_id", "in", ids)
        .where("provider", "<>", "password")
        .execute(),
    ).toEqual([]);

    // Their handles are taken, and no password opens them.
    await expect(
      registerPasswordAccount(db, { username: "demo_1", password: "correct horse battery" }),
    ).rejects.toMatchObject({ code: "USERNAME_TAKEN" });
    await expect(
      registerPasswordAccount(db, { username: "DEMO_2", password: "correct horse battery" }),
    ).rejects.toMatchObject({ code: "USERNAME_TAKEN" });
    expect(
      await verifyPasswordAccount(db, { username: "demo_1", password: "correct horse battery" }),
    ).toBeNull();

    // The database refuses a session, a credential, an X identity and a forecast for one.
    const demoUser = ids[0]!;
    await expect(createTournamentSession(db, demoUser)).rejects.toThrow(/demo account/);
    await expect(
      db
        .insertInto("tournament_password_credentials")
        .values({ user_id: demoUser, username_normalized: "demo_x", password_hash: "x" })
        .execute(),
    ).rejects.toThrow(/demo account/);
    await expect(
      db
        .insertInto("tournament_identities")
        .values({
          user_id: demoUser,
          provider: "x",
          provider_user_id: "424242",
          handle: "demo_x",
          handle_normalized: "demo_x",
          display_name: "demo_x",
          avatar_url: null,
          verified: false,
          provider_created_at: null,
          last_login_at: new Date(),
        })
        .execute(),
    ).rejects.toThrow(/demo account/);

    const now = Date.now();
    await saveDraftQuestion(
      db,
      questionInputSchema.parse({
        slug: "demo-guard",
        title: "Binary demo-guard",
        description_md: "Description.",
        rulebook_md: "Rulebook.",
        rulebook_version: 1,
        kind: "binary",
        opens_at: new Date(now - HOUR).toISOString(),
        closes_at: new Date(now + HOUR).toISOString(),
      }),
    );
    await openQuestion(db, "demo-guard");
    await expect(
      submitForecast(db, { slug: "demo-guard", userId: demoUser, p: 0.6 }),
    ).rejects.toThrow(/demo account/);
  });

  it("keeps demo accounts off the leaderboard", async () => {
    const db = postgres.db;
    await listAndQuote(db);
    await seedDemo(db, { now: SEED_NOW });
    const { userId: forecaster } = await upsertIdentity(db, {
      provider: "x",
      providerUserId: "777",
      handle: "RealForecaster",
      displayName: "Real Forecaster",
      avatarUrl: null,
      verified: false,
      providerCreatedAt: new Date("2015-01-01T00:00:00Z"),
    });
    const now = Date.now();
    await saveDraftQuestion(
      db,
      questionInputSchema.parse({
        slug: "demo-board",
        title: "Binary demo-board",
        description_md: "Description.",
        rulebook_md: "Rulebook.",
        rulebook_version: 1,
        kind: "binary",
        opens_at: new Date(now - HOUR).toISOString(),
        closes_at: new Date(now + HOUR).toISOString(),
      }),
    );
    await openQuestion(db, "demo-board");
    await submitForecast(db, { slug: "demo-board", userId: forecaster, p: 0.7 });
    await closeQuestion(db, "demo-board", {});
    await resolveQuestion(
      db,
      "demo-board",
      { outcome: "yes", rung_fired: 1, source_url: null, source_excerpt: null, note_md: "Yes." },
      forecaster,
    );

    const board = await getLeaderboard(db, "all");
    expect(board.entries.map((entry) => entry.handle)).toEqual(["RealForecaster"]);
    const demoHandles = new Set(DEMO_ACCOUNTS.map((account) => account.handle));
    expect(board.entries.some((entry) => demoHandles.has(entry.handle))).toBe(false);

    // A demo profile renders, marked as one; a real profile is not.
    const demoProfile = await getForecaster(db, `~${DEMO_ACCOUNTS[0]!.handle}`);
    expect(demoProfile.identity).toMatchObject({ handle: DEMO_ACCOUNTS[0]!.handle, demo: true });
    expect((await getForecaster(db, "RealForecaster")).identity.demo).toBe(false);
  });

  it("skips, writing nothing, with no listings or no live quotes", async () => {
    const db = postgres.db;
    const lines: string[] = [];
    expect(await seedDemo(db, { log: (line) => lines.push(line) })).toEqual({
      outcome: "skipped",
      reason: "no listings",
    });
    await seedFixtureListings(db, LISTED_AT);
    expect(await seedDemo(db, { now: SEED_NOW })).toEqual({
      outcome: "skipped",
      reason: "no live quotes",
    });
    expect(await count(db, "tournament_users")).toBe(0);
    expect(await count(db, "trades")).toBe(0);
  });

  it("writes nothing when a real account holds a demo handle", async () => {
    const db = postgres.db;
    await listAndQuote(db);
    await registerPasswordAccount(db, { username: "demo_3", password: "correct horse battery" });
    expect(await seedDemo(db, { now: SEED_NOW })).toEqual({
      outcome: "skipped",
      reason: "the handle demo_3 belongs to an account that is not a demo account",
    });
    expect(await demoUserIds(db)).toEqual([]);
    expect(await count(db, "trades")).toBe(0);
  });
});

postgresDescribe(`${suiteName}: migration 015`, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
  }, 30_000);

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  async function hasDemoColumn(): Promise<boolean> {
    const { rows } = await sql<{ present: boolean }>`
      select exists (
        select 1 from information_schema.columns
        where table_schema = ${postgres.schema} and table_name = 'tournament_users'
          and column_name = 'demo'
      ) as present
    `.execute(postgres.db);
    return rows[0]!.present;
  }

  it("refuses down while a demo user exists, and goes down and up without one", async () => {
    // Exercise 015's guard independently of later cleanup migrations.
    const baseline = await migrateTestDatabase(postgres, "015_demo_accounts");
    expect(baseline.error).toBeUndefined();
    const db = postgres.db;
    expect(await hasDemoColumn()).toBe(true);
    const demo = await db
      .insertInto("tournament_users")
      .values({ demo: true })
      .returning("id")
      .executeTakeFirstOrThrow();

    const refused = await migrateTestDatabase(postgres, "014_tournament_level_label");
    expect(String(refused.error)).toMatch(/015 down runs only without demo accounts/);
    expect(await hasDemoColumn()).toBe(true);

    await db.deleteFrom("tournament_users").where("id", "=", demo.id).execute();
    const down = await migrateTestDatabase(postgres, "014_tournament_level_label");
    expect(down.error).toBeUndefined();
    expect(down.results?.map((result) => result.migrationName)).toEqual(["015_demo_accounts"]);
    expect(await hasDemoColumn()).toBe(false);
    // Without the flag, nothing refuses a session.
    const user = await db
      .insertInto("tournament_users")
      .defaultValues()
      .returning("id")
      .executeTakeFirstOrThrow();
    await createTournamentSession(db, user.id);

    const up = await migrateTestDatabase(postgres, "latest");
    expect(up.error).toBeUndefined();
    expect(await hasDemoColumn()).toBe(true);
    const flagged = await db
      .selectFrom("tournament_users")
      .select("demo")
      .where("id", "=", user.id)
      .executeTakeFirstOrThrow();
    expect(flagged.demo).toBe(false);
  });
});
