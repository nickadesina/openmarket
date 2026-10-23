import { createHash, randomUUID } from "node:crypto";

import { type Kysely, sql } from "kysely";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { TradeInput } from "../../src/lib/api/schemas.js";
import { TOURNAMENT_SESSION_COOKIE } from "../../src/lib/auth/tournament-session.js";
import type { Database } from "../../src/lib/db/schema.js";
import { createComment } from "../../src/lib/services/create-comment.js";
import { executeTrade } from "../../src/lib/services/execute-trade.js";
import { upsertIdentity } from "../../src/lib/services/tournament/sign-in.js";
import { ensurePaperAccount, INITIAL_USER_BALANCE_CENTS } from "../../src/lib/services/user.js";
import { verifyReplay } from "../../src/lib/services/verify-replay.js";
import {
  createBinaryBook,
  createPostgresTestDatabase,
  createTrader,
  migrateTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  sessionCookie,
  settleBinaryBook,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

const runtime = vi.hoisted(() => ({ getRuntimeDatabase: vi.fn() }));
vi.mock("../../src/lib/db/runtime.js", () => runtime);

// A 007 database predates 011's restricted-person tables, so trades placed on
// it to populate the migration skip that check; it runs everywhere else.
const oldSchema = vi.hoisted(() => ({ active: false }));
vi.mock("../../src/lib/services/tournament/restrictions.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/lib/services/tournament/restrictions.js")>();
  return {
    ...actual,
    assertMayTrade: (...args: Parameters<typeof actual.assertMayTrade>) =>
      oldSchema.active ? Promise.resolve() : actual.assertMayTrade(...args),
  };
});

import { POST as removeRoute } from "../../src/app/api/admin/comments/[commentId]/remove/route.js";
import { GET as portfolioRoute } from "../../src/app/api/portfolio/route.js";
import { POST as logoutRoute } from "../../src/app/api/t/auth/logout/route.js";
import { GET as meRoute } from "../../src/app/api/t/me/route.js";

const APP_ORIGIN = "https://identity.openmarket.test";
const NETWORK = createHash("sha256").update("identity-test-network").digest("hex");
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Identity PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Identity PostgreSQL integration";

function get(path: string, cookie?: string): Request {
  return new Request(`${APP_ORIGIN}${path}`, {
    headers: cookie === undefined ? {} : { cookie },
  });
}

function post(path: string, body: unknown, cookie?: string): Request {
  return new Request(`${APP_ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: APP_ORIGIN,
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const { rows } = await sql<{ count: number }>`
    select count(*)::integer as count from ${sql.table(table)}
  `.execute(db);
  return rows[0]!.count;
}

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
  }, 30_000);

  beforeEach(async () => {
    await resetPostgresTestDatabase(postgres.db);
    runtime.getRuntimeDatabase.mockReturnValue(postgres.db);
    vi.stubEnv("APP_ORIGIN", APP_ORIGIN);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  }, 30_000);

  async function devIdentity(handle: string): Promise<string> {
    const { userId } = await upsertIdentity(postgres.db, {
      provider: "dev",
      providerUserId: handle.toLowerCase(),
      handle,
      displayName: handle,
      avatarUrl: null,
      verified: false,
      providerCreatedAt: null,
    });
    return userId;
  }

  it("opens one paper account per tournament user, idempotently and under concurrency", async () => {
    const tournamentUserId = await devIdentity("racer");
    expect(await countRows(postgres.db, "users")).toBe(0);

    const ids = await Promise.all(
      Array.from({ length: 12 }, () => ensurePaperAccount(postgres.db, tournamentUserId)),
    );
    expect(new Set(ids).size).toBe(1);
    expect(await ensurePaperAccount(postgres.db, tournamentUserId)).toBe(ids[0]);

    const accounts = await postgres.db.selectFrom("users").selectAll().execute();
    expect(accounts).toEqual([
      expect.objectContaining({
        id: ids[0],
        tournament_user_id: tournamentUserId,
        cash_balance_cents: INITIAL_USER_BALANCE_CENTS,
      }),
    ]);
    await expect(
      postgres.db
        .insertInto("users")
        .values({ tournament_user_id: randomUUID(), cash_balance_cents: "1" })
        .execute(),
    ).rejects.toThrow(/foreign key/);
  });

  it("acts as the session's paper account, opened by its first portfolio read", async () => {
    const tournamentUserId = await devIdentity("Reader");
    const cookie = await sessionCookie(postgres.db, tournamentUserId);

    const signedOut = await portfolioRoute(get("/api/portfolio"));
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toMatchObject({ error: { code: "USER_REQUIRED" } });
    const forged = await portfolioRoute(
      get("/api/portfolio", `${TOURNAMENT_SESSION_COOKIE}=${"f".repeat(43)}`),
    );
    expect(forged.status).toBe(401);

    // Signing in alone opens nothing.
    expect((await meRoute(get("/api/t/me", cookie))).status).toBe(200);
    expect(await countRows(postgres.db, "users")).toBe(0);

    const first = await portfolioRoute(get("/api/portfolio", cookie));
    expect(first.status).toBe(200);
    const portfolio = await first.json();
    expect(portfolio).toMatchObject({
      cashBalanceCents: INITIAL_USER_BALANCE_CENTS,
      identity: { handle: "Reader", provider: "dev", profileSlug: "Reader" },
      markets: [],
    });
    const again = await (await portfolioRoute(get("/api/portfolio", cookie))).json();
    expect(again.userId).toBe(portfolio.userId);
    expect(await countRows(postgres.db, "users")).toBe(1);

    expect((await logoutRoute(post("/api/t/auth/logout", {}, cookie))).status).toBe(200);
    expect((await portfolioRoute(get("/api/portfolio", cookie))).status).toBe(401);
  });

  it("authorizes moderation only for a session on the tournament admin allowlist", async () => {
    vi.stubEnv("TOURNAMENT_ADMIN_X_IDS", "4242, password:moderator");
    const { market } = await createBinaryBook(postgres.db, { slug: "moderated" });
    const author = await createTrader(postgres.db, "author");
    const comment = await createComment(
      postgres.db,
      author.id,
      market.id,
      { body: "Remove me", clientRequestId: randomUUID(), expectedUserId: author.id },
      NETWORK,
    );
    const path = `/api/admin/comments/${comment.id}/remove`;
    const context = { params: Promise.resolve({ commentId: comment.id }) };
    const { userId: xAdmin } = await upsertIdentity(postgres.db, {
      provider: "x",
      providerUserId: "4242",
      handle: "admin_on_x",
      displayName: "Admin",
      avatarUrl: null,
      verified: true,
      providerCreatedAt: new Date("2015-01-01T00:00:00.000Z"),
    });
    const { userId: passwordAdmin } = await upsertIdentity(postgres.db, {
      provider: "password",
      providerUserId: "moderator",
      handle: "moderator",
      displayName: "moderator",
      avatarUrl: null,
      verified: false,
      providerCreatedAt: null,
    });

    const signedOut = await removeRoute(post(path, {}), context);
    const ordinary = await removeRoute(
      post(path, {}, await sessionCookie(postgres.db, author.tournamentUserId)),
      context,
    );
    expect([signedOut.status, ordinary.status]).toEqual([401, 403]);
    expect(await ordinary.json()).toMatchObject({ error: { code: "ADMIN_REQUIRED" } });
    expect(
      (await postgres.db.selectFrom("market_comments").select("body").executeTakeFirstOrThrow())
        .body,
    ).toBe("Remove me");

    const xCookie = await sessionCookie(postgres.db, xAdmin);
    const me = await (await meRoute(get("/api/t/me", xCookie))).json();
    expect(me).toMatchObject({ isAdmin: true, viewer: { identity: { handle: "admin_on_x" } } });
    const removed = await removeRoute(post(path, {}, xCookie), context);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ id: comment.id, body: null });
    const repeat = await removeRoute(
      post(path, {}, await sessionCookie(postgres.db, passwordAdmin)),
      context,
    );
    expect(repeat.status).toBe(200);
  });
});

/** The pre-008 shape: username accounts trading books that have no dealer instrument. */
async function insertUsernameAccount(db: Kysely<Database>, username: string): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    insert into users (username, username_normalized, cash_balance_cents)
    values (${username}, ${username.toLowerCase()}, ${INITIAL_USER_BALANCE_CENTS})
    returning id
  `.execute(db);
  return rows[0]!.id;
}

/**
 * A pre-dealer book: no instrument, the shape 008 deletes. The ladders were
 * 41-bucket books; their trading code is gone, so the fixture trades the
 * two-outcome shape the remaining LMSR path prices, which 008 treats the same.
 */
async function insertLadder(db: Kysely<Database>, slug: string) {
  const { company, market } = await createBinaryBook(db, { slug, name: slug, b: 1_000 });
  return { companyId: company.id, marketId: market.id };
}

/** A listed name with one live binary instrument and its untraded book. */
async function insertDealerBook(db: Kysely<Database>, slug: string) {
  const company = await db
    .insertInto("companies")
    .values({ name: slug, slug, logo_path: `/logos/${slug}.svg` })
    .onConflict((conflict) => conflict.column("slug").doUpdateSet({ name: slug }))
    .returning("id")
    .executeTakeFirstOrThrow();
  const listing = await db
    .insertInto("listings")
    .values({
      company_id: company.id,
      tier: "mega",
      binary_event: "priced_round",
      kappa: 1,
      cap_cents: "2500000",
      b_cents: "200000",
      spread_floor: 0.05,
      gamma: 0.5,
      p_floor: 0.05,
      forward_t_days: 90,
      model_version: "1.0.0",
      anchor_round: "Series F",
      anchor_date: "2025-09-02",
      anchor_post_money_usd: "183000000000.00",
      anchor_source_url: "https://example.test/round",
      anchor_source_rank: 1,
      listed_at: new Date("2026-10-01T00:00:00.000Z"),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const instrument = await db
    .insertInto("instruments")
    .values({
      listing_id: listing.id,
      kind: "binary",
      epoch: 1,
      question: `Does ${slug} announce a priced round by 2026-12-31?`,
      opens_at: new Date("2026-10-01T00:00:00.000Z"),
      expires_at: new Date("2026-12-31T23:59:59.000Z"),
      state: "quoting",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const book = await db
    .insertInto("markets")
    .values({
      company_id: company.id,
      instrument_id: instrument.id,
      status: "open",
      n_buckets: 2,
      bucket_grid_version: "binary-v1",
      metric_kind: "yes_probability",
      b: 2_000,
      sigma: null,
      initial_q: [0, 0],
      q: [0, 0],
      current_metric: 0.5,
      settled_at: null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("marks")
    .values({
      market_id: book.id,
      market_sequence: "0",
      trade_id: null,
      ts: new Date(),
      value: 0.5,
    })
    .execute();
  return { companyId: company.id, bookId: book.id };
}

function buy(marketId: string, spendUsd: string, side: "yes" | "no"): TradeInput {
  return {
    idempotency_key: randomUUID(),
    market_id: marketId,
    action: "buy",
    side,
    strike_index: 0,
    spend_usd: spendUsd,
    max_cost_usd: spendUsd,
  };
}

postgresDescribe(`${suiteName}: 008 on a populated 007 database`, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    oldSchema.active = true;
    postgres = await createPostgresTestDatabase(databaseUrl!, "007_dealer");
  }, 30_000);

  afterAll(async () => {
    oldSchema.active = false;
    if (postgres !== undefined) await postgres.dispose();
  }, 30_000);

  async function columns(table: string): Promise<string[]> {
    const { rows } = await sql<{ column_name: string }>`
      select column_name from information_schema.columns
      where table_schema = ${postgres.schema} and table_name = ${table}
      order by column_name
    `.execute(postgres.db);
    return rows.map((row) => row.column_name);
  }

  it("removes the ladders, Stripe and every username account, and replay still reconciles", async () => {
    const db = postgres.db;
    const anthropic = await insertLadder(db, "anthropic");
    const stripe = await insertLadder(db, "stripe");
    const alice = await insertUsernameAccount(db, "Alice");
    const bob = await insertUsernameAccount(db, "bob_2");
    await insertUsernameAccount(db, "Idle_Carol");
    for (const [user, input] of [
      [alice, buy(anthropic.marketId, "250.00", "yes")],
      [bob, buy(anthropic.marketId, "120.00", "no")],
      [alice, buy(stripe.marketId, "75.00", "yes")],
      [bob, buy(stripe.marketId, "40.00", "yes")],
    ] as const) {
      await executeTrade(db, user, input);
    }
    await executeTrade(db, alice, {
      idempotency_key: randomUUID(),
      market_id: anthropic.marketId,
      action: "sell",
      side: "yes",
      strike_index: 0,
      quantity: 10,
      min_proceeds_usd: "0.00",
    });
    await settleBinaryBook(db, stripe.marketId, "yes", "https://example.test/stripe");
    await sql`
      insert into market_comments (market_id, user_id, body, client_request_id, request_fingerprint)
      values (${anthropic.marketId}, ${alice}, 'A ladder comment', ${randomUUID()}, ${"a".repeat(64)})
    `.execute(db);
    await sql`
      insert into comment_rate_limits (scope, key, window_started_at, post_count)
      values ('user', ${alice}, now(), 1), ('network', 'hmac', now(), 1)
    `.execute(db);
    await sql`
      insert into rate_limits (scope, key, window_started_at, request_count) values
        ('user_create', 'net', now(), 1),
        ('admin_login', 'net', now(), 1),
        ('quote', ${alice}, now(), 3),
        ('trade', 'network:abc', now(), 2),
        ('tournament_login', 'net', now(), 1)
    `.execute(db);
    // One open book per company and kind: the pre-dealer book closes before the dealer lists.
    await settleBinaryBook(db, anthropic.marketId, "no", "https://example.test/anthropic");
    const dealer = await insertDealerBook(db, "anthropic");
    await db
      .insertInto("companies")
      .values({ name: "Modal", slug: "modal", logo_path: "/logos/modal.svg" })
      .execute();
    expect(dealer.companyId).toBe(anthropic.companyId);

    const before = await verifyReplay(db);
    expect(before.passed).toBe(true);
    expect(before.cashReconciliation.userCount).toBe(3);
    expect(Number(before.cashReconciliation.marketMakerCashFlowCents)).not.toBe(0);

    const migration = await migrateTestDatabase(postgres, "latest");
    expect(migration.error).toBeUndefined();
    const historicalMigrations = [
      "008_retire_ladder_and_username_accounts",
      "009_dealer_pnl",
      "010_api_keys",
      "011_tournament_bridge",
      "012_tournament_choice",
      "013_tournament_contract_models",
      "014_tournament_level_label",
      "015_demo_accounts",
    ];
    expect(
      migration.results
        ?.slice(0, historicalMigrations.length)
        .map((result) => result.migrationName),
    ).toEqual(historicalMigrations);
    expect(migration.results?.every((result) => result.status === "Success")).toBe(true);

    for (const table of [
      "users",
      "trades",
      "holdings",
      "settlements",
      "market_comments",
      "comment_rate_limits",
    ]) {
      expect(await countRows(db, table), table).toBe(0);
    }
    expect(await db.selectFrom("markets").select("id").execute()).toEqual([{ id: dealer.bookId }]);
    expect(await db.selectFrom("marks").select(["market_id", "market_sequence"]).execute()).toEqual(
      [{ market_id: dealer.bookId, market_sequence: "0" }],
    );
    expect(
      (await db.selectFrom("companies").select("slug").orderBy("slug").execute()).map(
        (company) => company.slug,
      ),
    ).toEqual(["anthropic"]);
    expect(stripe.companyId).not.toBe(anthropic.companyId);
    expect(
      await db.selectFrom("rate_limits").select(["scope", "key"]).orderBy("scope").execute(),
    ).toEqual([
      { scope: "tournament_login", key: "net" },
      { scope: "trade", key: "network:abc" },
    ]);
    await expect(
      sql`insert into rate_limits values ('user_create', 'net', now(), 0)`.execute(db),
    ).rejects.toThrow(/rate_limits_scope/);

    const userColumns = await columns("users");
    expect(userColumns).toEqual(["cash_balance_cents", "created_at", "id", "tournament_user_id"]);

    const after = await verifyReplay(db);
    expect(after.passed).toBe(true);
    expect(after.cashReconciliation).toMatchObject({ userCount: 0, differenceCents: "0" });

    const { userId: tournamentUserId } = await upsertIdentity(db, {
      provider: "dev",
      providerUserId: "after",
      handle: "after",
      displayName: "after",
      avatarUrl: null,
      verified: false,
      providerCreatedAt: null,
    });
    await ensurePaperAccount(db, tournamentUserId);
    const opened = await verifyReplay(db);
    expect(opened.passed).toBe(true);
    expect(opened.cashReconciliation).toMatchObject({ userCount: 1, differenceCents: "0" });

    // down restores the username shape for surviving accounts, then up runs clean again.
    const down = await migrateTestDatabase(postgres, "007_dealer");
    expect(down.error).toBeUndefined();
    const { rows } = await sql<{ username: string; username_normalized: string }>`
      select username, username_normalized from users
    `.execute(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.username).toMatch(/^u_[0-9a-f]{18}$/);
    expect(rows[0]!.username_normalized).toBe(rows[0]!.username);
    expect(await columns("users")).not.toContain("tournament_user_id");
    const up = await migrateTestDatabase(postgres, "latest");
    expect(up.error).toBeUndefined();
    expect(await countRows(db, "users")).toBe(0);
  });
});

postgresDescribe(`${suiteName}: 008 after dealer trading`, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    oldSchema.active = true;
    postgres = await createPostgresTestDatabase(databaseUrl!, "007_dealer");
  }, 30_000);

  afterAll(async () => {
    oldSchema.active = false;
    if (postgres !== undefined) await postgres.dispose();
  }, 30_000);

  it("refuses to run once a dealer book has trades, changing nothing", async () => {
    const db = postgres.db;
    const { bookId } = await insertDealerBook(db, "modal");
    const trader = await insertUsernameAccount(db, "EarlyDealer");
    await executeTrade(db, trader, buy(bookId, "10.00", "yes"));

    const migration = await migrateTestDatabase(postgres, "latest");
    expect(String(migration.error)).toMatch(/008 runs before dealer trading/);
    expect(await countRows(db, "users")).toBe(1);
    expect(await countRows(db, "trades")).toBe(1);
  });
});
