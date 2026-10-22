import { type Kysely, sql } from "kysely";

/**
 * A forward question's level gets a short name ("First-day market cap"), the
 * heading of its forecast field. Additive and nullable: a forward without one
 * reads "Level in USD …"; a binary never has one.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("tournament_questions").addColumn("level_label", "text").execute();
  await db.schema
    .alterTable("tournament_questions")
    .addCheckConstraint(
      "tournament_questions_level_label",
      sql`level_label is null or (kind = 'forward' and char_length(level_label) between 1 and 60)`,
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("tournament_questions").dropColumn("level_label").execute();
}
