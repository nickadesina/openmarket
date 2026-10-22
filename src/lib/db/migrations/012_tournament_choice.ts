import { type Kysely, sql } from "kysely";

/**
 * Choice questions: named outcomes, none of them a value, plus the floor
 * bucket every non-binary question carries ("neither by expiry"). Additive:
 * the unit check gains `choice`; buckets, forecasts and scores are unchanged.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("tournament_questions")
    .dropConstraint("tournament_questions_unit")
    .execute();
  await db.schema
    .alterTable("tournament_questions")
    .addCheckConstraint(
      "tournament_questions_unit",
      sql`unit in ('USD_B', 'USD_T', 'bool', 'choice')`,
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // A choice question has no value to convert to; down refuses rather than drop it.
  await db.schema
    .alterTable("tournament_questions")
    .dropConstraint("tournament_questions_unit")
    .execute();
  await db.schema
    .alterTable("tournament_questions")
    .addCheckConstraint("tournament_questions_unit", sql`unit in ('USD_B', 'USD_T', 'bool')`)
    .execute();
}
