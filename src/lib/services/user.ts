import type { Kysely, Selectable, Transaction } from "kysely";

import type { Database } from "../db/schema.js";

export const INITIAL_USER_BALANCE_CENTS = "10000000";
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}(?![\s\S])/;

export class InvalidUsernameError extends Error {
  readonly code = "INVALID_INPUT" as const;

  constructor() {
    super("Username must be 3 to 20 letters, numbers, or underscores.");
    this.name = "InvalidUsernameError";
  }
}

export function normalizeUsername(username: string): string {
  if (typeof username !== "string" || !USERNAME_PATTERN.test(username)) {
    throw new InvalidUsernameError();
  }

  return username.toLowerCase();
}

export async function getUserByUsername(
  db: Kysely<Database> | Transaction<Database>,
  username: string,
): Promise<{ readonly id: string } | undefined> {
  return db
    .selectFrom("users")
    .select("id")
    .where("username_normalized", "=", normalizeUsername(username))
    .executeTakeFirst();
}

export async function createOrResumeUser(
  db: Kysely<Database> | Transaction<Database>,
  username: string,
): Promise<Selectable<Database["users"]>> {
  const usernameNormalized = normalizeUsername(username);

  return db
    .insertInto("users")
    .values({
      username,
      username_normalized: usernameNormalized,
      cash_balance_cents: INITIAL_USER_BALANCE_CENTS,
    })
    .onConflict((conflict) =>
      conflict.column("username_normalized").doUpdateSet({
        username_normalized: usernameNormalized,
      }),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
}
