import { type Kysely, sql } from "kysely";

import { ServiceError } from "../api/errors.js";
import { commentIdSchema } from "../api/schemas.js";
import type { Database } from "../db/schema.js";
import { getComment, type MarketComment } from "./list-comments.js";

export async function removeComment(
  db: Kysely<Database>,
  rawCommentId: string,
): Promise<MarketComment> {
  const parsed = commentIdSchema.safeParse(rawCommentId);
  if (!parsed.success) throw new ServiceError("INVALID_INPUT", "Comment identifier is invalid.");
  return db.transaction().execute(async (transaction) => {
    const removed = await transaction
      .updateTable("market_comments")
      .set({ body: null, removed_at: sql`coalesce(removed_at, clock_timestamp())` })
      .where("id", "=", parsed.data)
      .returning("id")
      .executeTakeFirst();
    if (removed === undefined) throw new ServiceError("COMMENT_NOT_FOUND", "Comment not found.");
    return getComment(transaction, removed.id);
  });
}
