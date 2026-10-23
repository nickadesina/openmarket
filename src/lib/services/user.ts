import type { Kysely, Transaction } from "kysely";
import { INITIAL_USER_BALANCE_CENTS } from "../api/money.js";
import type { Database } from "../db/schema.js";

export { INITIAL_USER_BALANCE_CENTS } from "../api/money.js";

/**
 * The paper account of a tournament user, opened at the initial balance on
 * first use. Concurrent first requests race on the unique tournament user id:
 * one insert wins, the others do nothing, and every caller reads the one row.
 */
export async function ensurePaperAccount(
  db: Kysely<Database> | Transaction<Database>,
  tournamentUserId: string,
): Promise<string> {
  await db
    .insertInto("users")
    .values({
      tournament_user_id: tournamentUserId,
      cash_balance_cents: INITIAL_USER_BALANCE_CENTS,
    })
    .onConflict((conflict) => conflict.column("tournament_user_id").doNothing())
    .execute();
  const account = await db
    .selectFrom("users")
    .select("id")
    .where("tournament_user_id", "=", tournamentUserId)
    .executeTakeFirstOrThrow();
  return account.id;
}
