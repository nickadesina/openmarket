import { createHash } from "node:crypto";

import { type Kysely, sql, type Transaction } from "kysely";

import { ServiceError } from "../api/errors.js";
import { type CommentInput, commentIdSchema, commentInputSchema } from "../api/schemas.js";
import type { Database } from "../db/schema.js";
import { getComment, type MarketComment } from "./list-comments.js";

const RATE_WINDOW_MS = 60_000;

async function consumePostingQuota(
  transaction: Transaction<Database>,
  userId: string,
  networkKey: string,
): Promise<void> {
  // Always acquire network then user rows, independent of which request arrived first.
  await transaction
    .insertInto("comment_rate_limits")
    .values([
      {
        scope: "network",
        key: networkKey,
        window_started_at: sql`clock_timestamp()`,
        post_count: 0,
      },
      { scope: "user", key: userId, window_started_at: sql`clock_timestamp()`, post_count: 0 },
    ])
    .onConflict((conflict) => conflict.columns(["scope", "key"]).doNothing())
    .execute();
  const counters = await transaction
    .selectFrom("comment_rate_limits")
    .selectAll()
    .where((expression) =>
      expression.or([
        expression.and([expression("scope", "=", "network"), expression("key", "=", networkKey)]),
        expression.and([expression("scope", "=", "user"), expression("key", "=", userId)]),
      ]),
    )
    .orderBy("scope")
    .orderBy("key")
    .forUpdate()
    .execute();
  // Read the database clock after acquiring both locks, not before a potentially long wait.
  const { now } = await transaction
    .selectNoFrom(sql<Date>`clock_timestamp()`.as("now"))
    .executeTakeFirstOrThrow();
  let retryAfterSeconds = 0;
  for (const counter of counters) {
    const expiresAt = counter.window_started_at.getTime() + RATE_WINDOW_MS;
    const maximum = counter.scope === "user" ? 5 : 20;
    if (expiresAt > now.getTime() && counter.post_count >= maximum) {
      retryAfterSeconds = Math.max(
        retryAfterSeconds,
        Math.ceil((expiresAt - now.getTime()) / 1_000),
      );
    }
  }
  if (retryAfterSeconds > 0) {
    throw new ServiceError("RATE_LIMITED", "Please wait before posting another comment.", {
      retryAfterSeconds,
    });
  }
  for (const counter of counters) {
    const expired = counter.window_started_at.getTime() + RATE_WINDOW_MS <= now.getTime();
    await transaction
      .updateTable("comment_rate_limits")
      .set({
        window_started_at: expired ? now : counter.window_started_at,
        post_count: expired ? 1 : counter.post_count + 1,
      })
      .where("scope", "=", counter.scope)
      .where("key", "=", counter.key)
      .execute();
  }
}

export async function createComment(
  db: Kysely<Database>,
  rawUserId: string,
  rawMarketId: string,
  rawInput: CommentInput,
  networkKey: string,
): Promise<MarketComment> {
  const user = commentIdSchema.safeParse(rawUserId);
  const market = commentIdSchema.safeParse(rawMarketId);
  const parsed = commentInputSchema.safeParse(rawInput);
  if (!user.success || !market.success || !parsed.success) {
    throw new ServiceError("INVALID_INPUT", "Comment request is invalid.");
  }
  const userId = user.data;
  const marketId = market.data;
  const input = parsed.data;
  if (input.expectedUserId !== userId) {
    throw new ServiceError(
      "ACCOUNT_CHANGED",
      "The active account changed. Review the author before posting.",
    );
  }
  if (!/^[0-9a-f]{64}$/.test(networkKey)) {
    throw new ServiceError("POSTING_UNAVAILABLE", "Comment posting is temporarily unavailable.");
  }
  const parentId = input.parentId ?? null;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ userId, marketId, parentId, body: input.body }))
    .digest("hex");
  const advisoryKey = createHash("sha256")
    .update(`openmarket.comment:${input.clientRequestId}`)
    .digest()
    .readBigInt64BE(0);

  return db.transaction().execute(async (transaction) => {
    await sql`select pg_advisory_xact_lock(${advisoryKey.toString()}::bigint)`.execute(transaction);
    const existing = await transaction
      .selectFrom("market_comments")
      .select(["id", "request_fingerprint"])
      .where("client_request_id", "=", input.clientRequestId)
      .executeTakeFirst();
    if (existing !== undefined) {
      if (existing.request_fingerprint !== fingerprint) {
        throw new ServiceError(
          "IDEMPOTENCY_CONFLICT",
          "Submission key is bound to a different author or comment.",
        );
      }
      return getComment(transaction, existing.id);
    }

    const foundMarket = await transaction
      .selectFrom("markets")
      .select("id")
      .where("id", "=", marketId)
      .executeTakeFirst();
    if (foundMarket === undefined) throw new ServiceError("MARKET_NOT_FOUND", "Market not found.");
    const foundUser = await transaction
      .selectFrom("users")
      .select("id")
      .where("id", "=", userId)
      .executeTakeFirst();
    if (foundUser === undefined)
      throw new ServiceError("USER_REQUIRED", "A valid user is required.");
    if (parentId !== null) {
      const parent = await transaction
        .selectFrom("market_comments")
        .select("parent_id")
        .where("id", "=", parentId)
        .where("market_id", "=", marketId)
        .forKeyShare()
        .executeTakeFirst();
      if (parent === undefined)
        throw new ServiceError("COMMENT_NOT_FOUND", "Parent comment not found.");
      if (parent.parent_id !== null)
        throw new ServiceError("INVALID_INPUT", "Replies must belong to a top-level comment.");
    }

    await consumePostingQuota(transaction, userId, networkKey);
    const inserted = await transaction
      .insertInto("market_comments")
      .values({
        market_id: marketId,
        user_id: userId,
        parent_id: parentId,
        body: input.body,
        client_request_id: input.clientRequestId,
        request_fingerprint: fingerprint,
        removed_at: null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return getComment(transaction, inserted.id);
  });
}
