import type { Kysely } from "kysely";

import { ServiceError } from "../../api/errors.js";
import type { PasswordAccountInput, PasswordSignInInput } from "../../api/tournament-schemas.js";
import { burnPasswordCheck, hashPassword, verifyPassword } from "../../auth/tournament-password.js";
import type { Database } from "../../db/schema.js";

const UNIQUE_VIOLATION = "23505";

function usernameTaken(): ServiceError {
  return new ServiceError("USERNAME_TAKEN", "That username is taken.");
}

/**
 * Creates a username/password account: a tournament user, a `password`
 * identity whose handle is the username as typed, and its credential. The
 * account has no external creation date, so question account-age rules,
 * which read the X account's age, do not apply to it.
 */
export async function registerPasswordAccount(
  db: Kysely<Database>,
  input: PasswordAccountInput,
): Promise<string> {
  const normalized = input.username.toLowerCase();
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.transaction().execute(async (transaction) => {
      const existing = await transaction
        .selectFrom("tournament_password_credentials")
        .select("user_id")
        .where("username_normalized", "=", normalized)
        .executeTakeFirst();
      if (existing !== undefined) throw usernameTaken();

      const user = await transaction
        .insertInto("tournament_users")
        .defaultValues()
        .returning("id")
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto("tournament_identities")
        .values({
          user_id: user.id,
          provider: "password",
          provider_user_id: normalized,
          handle: input.username,
          handle_normalized: normalized,
          display_name: input.username,
          avatar_url: null,
          verified: false,
          provider_created_at: null,
          last_login_at: new Date(),
        })
        .execute();
      await transaction
        .insertInto("tournament_password_credentials")
        .values({ user_id: user.id, username_normalized: normalized, password_hash: passwordHash })
        .execute();
      return user.id;
    });
  } catch (error) {
    // A concurrent registration of the same name loses on the unique index.
    if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) throw usernameTaken();
    throw error;
  }
}

/** The account's user id when the password matches; null otherwise, in constant-ish time. */
export async function verifyPasswordAccount(
  db: Kysely<Database>,
  input: PasswordSignInInput,
): Promise<string | null> {
  const credential = await db
    .selectFrom("tournament_password_credentials")
    .select(["user_id", "password_hash"])
    .where("username_normalized", "=", input.username.toLowerCase())
    .executeTakeFirst();
  if (credential === undefined) {
    await burnPasswordCheck(input.password);
    return null;
  }
  if (!(await verifyPassword(input.password, credential.password_hash))) return null;
  await db
    .updateTable("tournament_identities")
    .set({ last_login_at: new Date() })
    .where("user_id", "=", credential.user_id)
    .where("provider", "=", "password")
    .execute();
  return credential.user_id;
}
