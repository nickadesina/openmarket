import { type Kysely, sql } from "kysely";

/**
 * Questions on request (docs/prompts/tradeables, item 7): the name of whoever
 * proposed a question, as they want it shown ("Proposed by <name>" on its
 * page). Set on a draft by `seed:tournament -- --from=<file>` or the admin
 * questions route; pinned with the rest of the record when it opens.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("tournament_questions").addColumn("proposed_by", "text").execute();
  await db.schema
    .alterTable("tournament_questions")
    .addCheckConstraint(
      "tournament_questions_proposed_by",
      sql`proposed_by is null or length(btrim(proposed_by)) between 1 and 100`,
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("tournament_questions")
    .dropConstraint("tournament_questions_proposed_by")
    .execute();
  await db.schema.alterTable("tournament_questions").dropColumn("proposed_by").execute();
}
