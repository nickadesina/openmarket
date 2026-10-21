import type { Kysely, Transaction } from "kysely";

import type { Database } from "../db/schema.js";

/** Every paper account opens with $100,000.00 (README D1). */
export const INITIAL_USER_BALANCE_CENTS = "10000000";

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
