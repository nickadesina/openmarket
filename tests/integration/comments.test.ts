import { createHash, randomUUID } from "node:crypto";

import { sql } from "kysely";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommentInput } from "../../src/lib/api/schemas.js";
import { signAdminCookie } from "../../src/lib/auth/admin-cookie.js";
import { signUserCookie } from "../../src/lib/auth/user-cookie.js";
import { createComment } from "../../src/lib/services/create-comment.js";
import { listComments } from "../../src/lib/services/list-comments.js";
import { removeComment } from "../../src/lib/services/remove-comment.js";
import { seedMarket } from "../../src/lib/services/seed-market.js";
import { settleMarket } from "../../src/lib/services/settle-market.js";
import { createOrResumeUser } from "../../src/lib/services/user.js";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

const runtime = vi.hoisted(() => ({ getRuntimeDatabase: vi.fn() }));
vi.mock("../../src/lib/db/runtime.js", () => runtime);

import { POST as removeRoute } from "../../src/app/api/admin/comments/[commentId]/remove/route.js";
import {
  POST as createRoute,
  GET as listRoute,
} from "../../src/app/api/markets/by-id/[marketId]/comments/route.js";

const APP_ORIGIN = "https://comments.openmarket.test";
const SECRET = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString(
  "base64url",
);
const ADMIN_SECRET = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 65)).toString(
  "base64url",
);
const NETWORK = createHash("sha256").update("comments-test-network").digest("hex");
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Comments PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Comments PostgreSQL integration";

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;
  let marketId: string;
  let user: { id: string; username: string };

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
  }, 30_000);

  beforeEach(async () => {
    await resetPostgresTestDatabase(postgres.db);
    const seeded = await seedMarket(postgres.db, {
      name: "Comment Market",
      slug: "comment-market",
      logo_path: "/test.svg",
      metric_kind: "yes_probability",
      b: 100,
      yes_probability: 0.5,
    });
    marketId = seeded.market.id;
    user = await createOrResumeUser(postgres.db, "CommentAuthor");
    runtime.getRuntimeDatabase.mockReturnValue(postgres.db);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("APP_ORIGIN", APP_ORIGIN);
    vi.stubEnv("USER_COOKIE_SECRET", SECRET);
    vi.stubEnv("ADMIN_COOKIE_SECRET", ADMIN_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  }, 30_000);

  function input(overrides: Partial<CommentInput> = {}): CommentInput {
    return {
      body: "A comment",
      clientRequestId: randomUUID(),
      expectedUserId: user.id,
      ...overrides,
    };
  }

  async function secondMarket() {
    const result = await seedMarket(postgres.db, {
      name: "Another Market",
      slug: "another-market",
      logo_path: "/test.svg",
      metric_kind: "yes_probability",
      b: 100,
      yes_probability: 0.5,
    });
    return result.market.id;
  }

  function request(path: string, body: unknown, cookie?: string): Request {
    return new Request(`${APP_ORIGIN}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: APP_ORIGIN,
        "x-vercel-forwarded-for": "192.0.2.1",
        ...(cookie === undefined ? {} : { cookie }),
      },
      body: JSON.stringify(body),
    });
  }

  it("serializes concurrent retries into one comment and charges only the initial post", async () => {
    const submission = input();
    const comments = await Promise.all(
      Array.from({ length: 12 }, () =>
        createComment(postgres.db, user.id, marketId, submission, NETWORK),
      ),
    );
    expect(new Set(comments.map((comment) => comment.id)).size).toBe(1);
    expect((await listComments(postgres.db, marketId)).items.map((comment) => comment.id)).toEqual([
      comments[0]!.id,
    ]);
    for (let index = 0; index < 4; index += 1) {
      await createComment(postgres.db, user.id, marketId, input(), NETWORK);
    }
    await expect(
      createComment(postgres.db, user.id, marketId, input(), NETWORK),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      details: { retryAfterSeconds: expect.any(Number) },
    });
    expect((await createComment(postgres.db, user.id, marketId, submission, NETWORK)).id).toBe(
      comments[0]!.id,
    );
  });

  it("binds the UUID globally to the winning caller, market, parent and normalized body", async () => {
    const submission = input();
    const changed = { ...submission, body: "Changed content" };
    const results = await Promise.allSettled([
      createComment(postgres.db, user.id, marketId, submission, NETWORK),
      createComment(postgres.db, user.id, marketId, changed, NETWORK),
    ]);
    const winners = results.filter((result) => result.status === "fulfilled");
    const losers = results.filter((result) => result.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]).toMatchObject({ reason: { code: "IDEMPOTENCY_CONFLICT" } });
    const winner = winners[0]!;
    const bound = { ...submission, body: winner.value.body! };
    const anotherUser = await createOrResumeUser(postgres.db, "AnotherAuthor");
    await expect(
      createComment(
        postgres.db,
        anotherUser.id,
        marketId,
        {
          ...bound,
          expectedUserId: anotherUser.id,
        },
        NETWORK,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      createComment(postgres.db, user.id, await secondMarket(), bound, NETWORK),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      createComment(
        postgres.db,
        user.id,
        marketId,
        {
          ...bound,
          parentId: winner.value.id,
        },
        NETWORK,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(
      (
        await createComment(
          postgres.db,
          user.id,
          marketId,
          { ...bound, body: `  ${bound.body}\n` },
          NETWORK,
        )
      ).id,
    ).toBe(winner.value.id);
  });

  it("checks expected identity before inserting and permits an explicit new submission by the current account", async () => {
    const other = await createOrResumeUser(postgres.db, "CurrentAuthor");
    const submission = input();
    await expect(
      createComment(postgres.db, other.id, marketId, submission, NETWORK),
    ).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
    expect((await listComments(postgres.db, marketId)).items).toEqual([]);
    const accepted = await createComment(
      postgres.db,
      other.id,
      marketId,
      {
        ...submission,
        expectedUserId: other.id,
      },
      NETWORK,
    );
    expect(accepted.userId).toBe(other.id);
  });

  it("retains replay fingerprints after removal and permits replies to a tombstoned root", async () => {
    const submission = input({ body: "Body that must disappear" });
    const root = await createComment(postgres.db, user.id, marketId, submission, NETWORK);
    const firstReply = await createComment(
      postgres.db,
      user.id,
      marketId,
      input({ parentId: root.id }),
      NETWORK,
    );
    const removed = await removeComment(postgres.db, root.id);
    expect(removed.body).toBeNull();
    expect(removed.replyCount).toBe(1);
    expect(removed.removedAt).not.toBeNull();
    expect(await removeComment(postgres.db, root.id)).toEqual(removed);
    expect(await createComment(postgres.db, user.id, marketId, submission, NETWORK)).toEqual(
      removed,
    );
    await expect(
      createComment(
        postgres.db,
        user.id,
        marketId,
        { ...submission, body: "Replacement" },
        NETWORK,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await removeComment(postgres.db, firstReply.id);
    const nextReply = await createComment(
      postgres.db,
      user.id,
      marketId,
      input({ parentId: root.id }),
      NETWORK,
    );
    const page = await listComments(postgres.db, marketId, { parentId: root.id });
    expect(page.items.map((comment) => comment.id).sort()).toEqual(
      [firstReply.id, nextReply.id].sort(),
    );
    expect(page.items.find((comment) => comment.id === firstReply.id)?.body).toBeNull();
    expect((await listComments(postgres.db, marketId)).items[0]?.replyCount).toBe(2);
  });

  it("rejects cross-market and nested replies, with a database foreign key defending market isolation", async () => {
    const root = await createComment(postgres.db, user.id, marketId, input(), NETWORK);
    const reply = await createComment(
      postgres.db,
      user.id,
      marketId,
      input({ parentId: root.id }),
      NETWORK,
    );
    const otherMarket = await secondMarket();
    await expect(
      createComment(postgres.db, user.id, otherMarket, input({ parentId: root.id }), NETWORK),
    ).rejects.toMatchObject({ code: "COMMENT_NOT_FOUND" });
    await expect(
      createComment(postgres.db, user.id, marketId, input({ parentId: reply.id }), NETWORK),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      createComment(postgres.db, user.id, marketId, input({ parentId: randomUUID() }), NETWORK),
    ).rejects.toMatchObject({ code: "COMMENT_NOT_FOUND" });
    await expect(
      postgres.db
        .insertInto("market_comments")
        .values({
          market_id: otherMarket,
          user_id: user.id,
          parent_id: root.id,
          body: "Bypass service",
          client_request_id: randomUUID(),
          request_fingerprint: "a".repeat(64),
          removed_at: null,
        })
        .execute(),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("paginates roots newest-first and replies oldest-first without loss across millisecond ties", async () => {
    const root = await createComment(postgres.db, user.id, marketId, input(), NETWORK);
    const ids = (offset: number) =>
      Array.from(
        { length: 42 },
        (_, index) => `00000000-0000-4000-8000-${String(offset + index).padStart(12, "0")}`,
      );
    const rootIds = ids(100);
    const replyIds = ids(200);
    for (const [parentId, values] of [
      [null, rootIds],
      [root.id, replyIds],
    ] as const) {
      await postgres.db
        .insertInto("market_comments")
        .values(
          values.map((id, index) => ({
            id,
            market_id: marketId,
            user_id: user.id,
            parent_id: parentId,
            body: `Page ${index}`,
            client_request_id: randomUUID(),
            request_fingerprint: "b".repeat(64),
            removed_at: null,
            created_at: sql<Date>`'2026-01-01T00:00:00.123Z'::timestamptz + ${index} * interval '1 microsecond'`,
          })),
        )
        .execute();
    }
    await removeComment(postgres.db, rootIds[10]!);
    for (const [parentId, expected] of [
      [undefined, [root.id, ...[...rootIds].reverse()]],
      [root.id, replyIds],
    ] as const) {
      const first = await listComments(
        postgres.db,
        marketId,
        parentId === undefined ? {} : { parentId },
      );
      expect(first.items).toHaveLength(20);
      const second = await listComments(postgres.db, marketId, {
        ...(parentId === undefined ? {} : { parentId }),
        cursor: first.nextCursor!,
      });
      expect(second.items).toHaveLength(20);
      const third = await listComments(postgres.db, marketId, {
        ...(parentId === undefined ? {} : { parentId }),
        cursor: second.nextCursor!,
      });
      expect(third.nextCursor).toBeNull();
      expect(
        [...first.items, ...second.items, ...third.items].map((comment) => comment.id),
      ).toEqual(expected);
      const wrongParent = parentId === undefined ? root.id : undefined;
      await expect(
        listComments(postgres.db, marketId, {
          ...(wrongParent === undefined ? {} : { parentId: wrongParent }),
          cursor: first.nextCursor!,
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    const page = await listComments(postgres.db, marketId);
    await expect(
      listComments(postgres.db, await secondMarket(), { cursor: page.nextCursor! }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      listComments(postgres.db, marketId, { cursor: "malformed" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("caps concurrent posts per account even when every request has a different network", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) =>
        createComment(
          postgres.db,
          user.id,
          marketId,
          input(),
          createHash("sha256").update(String(index)).digest("hex"),
        ),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(5);
    expect(results.filter((result) => result.status === "rejected")).toMatchObject([
      { reason: { code: "RATE_LIMITED" } },
    ]);
    await postgres.db
      .updateTable("comment_rate_limits")
      .set({ window_started_at: sql`clock_timestamp() - interval '61 seconds'` })
      .execute();
    const next = await createComment(postgres.db, user.id, marketId, input(), NETWORK);
    expect(
      (await listComments(postgres.db, marketId)).items.map((comment) => comment.id),
    ).toContain(next.id);
  });

  it("caps a shared network atomically without charging a rejected user's quota", async () => {
    const authors = await Promise.all(
      Array.from({ length: 21 }, (_, index) =>
        createOrResumeUser(postgres.db, `NetworkAuthor${index}`),
      ),
    );
    const results = await Promise.allSettled(
      authors.map((author) =>
        createComment(
          postgres.db,
          author.id,
          marketId,
          input({ expectedUserId: author.id }),
          NETWORK,
        ),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(20);
    const rejectedIndex = results.findIndex((result) => result.status === "rejected");
    expect(results[rejectedIndex]).toMatchObject({ reason: { code: "RATE_LIMITED" } });
    const rejectedUser = authors[rejectedIndex]!;
    const anotherNetwork = createHash("sha256").update("another-network").digest("hex");
    for (let index = 0; index < 5; index += 1) {
      await createComment(
        postgres.db,
        rejectedUser.id,
        marketId,
        input({ expectedUserId: rejectedUser.id }),
        anotherNetwork,
      );
    }
    await expect(
      createComment(
        postgres.db,
        rejectedUser.id,
        marketId,
        input({ expectedUserId: rejectedUser.id }),
        anotherNetwork,
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("preserves a discussed market on unchanged seed and rejects changing its seed", async () => {
    const comment = await createComment(postgres.db, user.id, marketId, input(), NETWORK);
    const seed = {
      name: "Comment Market",
      slug: "comment-market",
      logo_path: "/test.svg",
      metric_kind: "yes_probability" as const,
      b: 100,
      yes_probability: 0.5,
    };
    const unchanged = await seedMarket(postgres.db, seed);
    expect(unchanged.outcome).toBe("unchanged");
    expect(unchanged.market.id).toBe(marketId);
    await expect(seedMarket(postgres.db, { ...seed, yes_probability: 0.7 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect((await listComments(postgres.db, marketId)).items).toEqual([comment]);
  });

  it("posts after settlement without modifying market, cash, holdings, ledger or marks", async () => {
    await settleMarket(postgres.db, {
      slug: "comment-market",
      confirm_slug: "comment-market",
      settled_value_usd: "1.00",
      source_url: "https://example.com/result",
    });
    const snapshot = async () => ({
      market: await postgres.db
        .selectFrom("markets")
        .selectAll()
        .where("id", "=", marketId)
        .executeTakeFirstOrThrow(),
      author: await postgres.db
        .selectFrom("users")
        .selectAll()
        .where("id", "=", user.id)
        .executeTakeFirstOrThrow(),
      holdings: await postgres.db.selectFrom("holdings").selectAll().execute(),
      trades: await postgres.db.selectFrom("trades").selectAll().execute(),
      marks: await postgres.db.selectFrom("marks").selectAll().execute(),
    });
    const before = await snapshot();
    const created = await createComment(postgres.db, user.id, marketId, input(), NETWORK);
    expect((await listComments(postgres.db, marketId)).items[0]?.id).toBe(created.id);
    expect(await snapshot()).toEqual(before);
  });

  it("exposes anonymous reads but authenticates posting and refuses a stale expected account", async () => {
    const context = { params: Promise.resolve({ marketId }) };
    const path = `/api/markets/by-id/${marketId}/comments`;
    expect((await listRoute(new Request(`${APP_ORIGIN}${path}`), context)).status).toBe(200);
    const anonymous = await createRoute(request(path, input()), context);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ error: { code: "USER_REQUIRED" } });
    const cookie = `openmarket_user=${signUserCookie(user.username, SECRET)}`;
    const changed = await createRoute(
      request(path, input({ expectedUserId: randomUUID() }), cookie),
      context,
    );
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ error: { code: "ACCOUNT_CHANGED" } });
    const injected = await createRoute(
      request(path, { ...input(), userId: randomUUID() }, cookie),
      context,
    );
    expect(injected.status).toBe(400);
    const accepted = await createRoute(request(path, input(), cookie), context);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ userId: user.id, marketId });
    expect((await listRoute(new Request(`${APP_ORIGIN}${path}?limit=100`), context)).status).toBe(
      400,
    );
  });

  it("requires separate admin authorization and returns the current tombstone on repeated removal", async () => {
    const comment = await createComment(postgres.db, user.id, marketId, input(), NETWORK);
    const path = `/api/admin/comments/${comment.id}/remove`;
    const context = { params: Promise.resolve({ commentId: comment.id }) };
    const ordinary = await removeRoute(
      request(path, {}, `openmarket_user=${signUserCookie(user.username, SECRET)}`),
      context,
    );
    expect(ordinary.status).toBe(401);
    expect(await ordinary.json()).toMatchObject({ error: { code: "ADMIN_REQUIRED" } });
    const adminCookie = `openmarket_admin=${signAdminCookie(ADMIN_SECRET)}`;
    const first = await removeRoute(request(path, {}, adminCookie), context);
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    expect(firstBody).toMatchObject({ id: comment.id, body: null, removedAt: expect.any(String) });
    const repeat = await removeRoute(request(path, {}, adminCookie), context);
    expect(await repeat.json()).toEqual(firstBody);
    const unknown = await removeRoute(request(path, {}, adminCookie), {
      params: Promise.resolve({ commentId: randomUUID() }),
    });
    expect(unknown.status).toBe(404);
  });
});
