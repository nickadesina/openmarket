import { type Kysely, sql } from "kysely";

import { ServiceError } from "../api/errors.js";
import { commentIdSchema } from "../api/schemas.js";
import type { Database } from "../db/schema.js";

export const COMMENT_PAGE_SIZE = 20;
const MAX_CURSOR_LENGTH = 512;

export interface MarketComment {
  readonly id: string;
  readonly marketId: string;
  readonly userId: string;
  readonly username: string;
  readonly parentId: string | null;
  readonly body: string | null;
  readonly createdAt: string;
  readonly removedAt: string | null;
  readonly replyCount: number;
}

export interface CommentPage {
  readonly items: MarketComment[];
  readonly nextCursor: string | null;
}

export interface CommentListOptions {
  readonly parentId?: string;
  readonly cursor?: string;
}

interface CommentCursor {
  readonly createdAt: Date;
  readonly id: string;
}

function commentQuery(db: Kysely<Database>) {
  return db
    .selectFrom("market_comments as comment")
    .innerJoin("users", "users.id", "comment.user_id")
    .select([
      "comment.id",
      "comment.market_id as marketId",
      "comment.user_id as userId",
      "users.username",
      "comment.parent_id as parentId",
      "comment.body",
      "comment.created_at as createdAt",
      "comment.removed_at as removedAt",
      sql<number>`(
        select count(*)::integer from market_comments as reply
        where reply.market_id = comment.market_id and reply.parent_id = comment.id
      )`.as("replyCount"),
    ]);
}

type CommentProjection = Omit<MarketComment, "createdAt" | "removedAt"> & {
  readonly createdAt: Date;
  readonly removedAt: Date | null;
};

function projectComment(row: CommentProjection): MarketComment {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    removedAt: row.removedAt?.toISOString() ?? null,
  };
}

/** Shared projection for create, replay and moderation; never stores a stale response body. */
export async function getComment(db: Kysely<Database>, commentId: string): Promise<MarketComment> {
  const row = await commentQuery(db).where("comment.id", "=", commentId).executeTakeFirst();
  if (row === undefined) {
    throw new ServiceError("COMMENT_NOT_FOUND", "Comment not found.");
  }
  return projectComment(row);
}

function decodeCursor(value: string, marketId: string, parentId: string | null): CommentCursor {
  const invalidCursor = () => new ServiceError("INVALID_INPUT", "Comment cursor is invalid.");
  if (value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw invalidCursor();
  }
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) throw invalidCursor();
    const decoded: unknown = JSON.parse(bytes.toString("utf8"));
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
      throw invalidCursor();
    }
    const cursor = decoded as Record<string, unknown>;
    if (
      Object.keys(cursor).length !== 5 ||
      cursor.v !== 1 ||
      cursor.m !== marketId ||
      cursor.p !== parentId ||
      typeof cursor.t !== "string" ||
      !commentIdSchema.safeParse(cursor.i).success
    ) {
      throw invalidCursor();
    }
    const createdAt = new Date(cursor.t);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== cursor.t) {
      throw invalidCursor();
    }
    return { createdAt, id: cursor.i as string };
  } catch {
    throw invalidCursor();
  }
}

export async function listComments(
  db: Kysely<Database>,
  rawMarketId: string,
  options: CommentListOptions = {},
): Promise<CommentPage> {
  const market = commentIdSchema.safeParse(rawMarketId);
  const parent = commentIdSchema.optional().safeParse(options.parentId);
  if (!market.success || !parent.success) {
    throw new ServiceError("INVALID_INPUT", "Market or parent identifier is invalid.");
  }
  const marketId = market.data;
  const parentId = parent.data ?? null;
  const cursor =
    options.cursor === undefined ? null : decodeCursor(options.cursor, marketId, parentId);

  const exists = await db
    .selectFrom("markets")
    .select("id")
    .where("id", "=", marketId)
    .executeTakeFirst();
  if (exists === undefined) throw new ServiceError("MARKET_NOT_FOUND", "Market not found.");
  if (parentId !== null) {
    const root = await db
      .selectFrom("market_comments")
      .select("parent_id")
      .where("id", "=", parentId)
      .where("market_id", "=", marketId)
      .executeTakeFirst();
    if (root === undefined)
      throw new ServiceError("COMMENT_NOT_FOUND", "Parent comment not found.");
    if (root.parent_id !== null)
      throw new ServiceError("INVALID_INPUT", "Replies must belong to a top-level comment.");
  }

  const direction = parentId === null ? "desc" : "asc";
  let query = commentQuery(db)
    .where("comment.market_id", "=", marketId)
    .where("comment.parent_id", parentId === null ? "is" : "=", parentId);
  if (cursor !== null) {
    query = query.where(
      parentId === null
        ? sql<boolean>`(comment.created_at, comment.id) < (${cursor.createdAt}, ${cursor.id}::uuid)`
        : sql<boolean>`(comment.created_at, comment.id) > (${cursor.createdAt}, ${cursor.id}::uuid)`,
    );
  }
  const rows = await query
    .orderBy("comment.created_at", direction)
    .orderBy("comment.id", direction)
    .limit(COMMENT_PAGE_SIZE + 1)
    .execute();
  const items = rows.slice(0, COMMENT_PAGE_SIZE).map(projectComment);
  const last = items.at(-1);
  const nextCursor =
    rows.length > COMMENT_PAGE_SIZE && last !== undefined
      ? Buffer.from(
          JSON.stringify({ v: 1, m: marketId, p: parentId, t: last.createdAt, i: last.id }),
        ).toString("base64url")
      : null;
  return { items, nextCursor };
}
