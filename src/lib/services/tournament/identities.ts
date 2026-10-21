import type { TournamentProvider } from "../../db/schema.js";
import type { PublicIdentity, TournamentDb } from "./records.js";

/** Password accounts live under `~`, so a username can never pass for an X handle. */
export const PASSWORD_PROFILE_PREFIX = "~";

/** A profile slug: an X handle, or `~` plus a username. */
export const PROFILE_SLUG_PATTERN = /^~?[A-Za-z0-9_]{1,50}$/;

export function profileSlug(provider: TournamentProvider, handle: string): string {
  return provider === "password" ? `${PASSWORD_PROFILE_PREFIX}${handle}` : handle;
}

/** Each user's public identity: their most recently used sign-in. */
export async function identitiesFor(
  db: TournamentDb,
  userIds: readonly string[],
): Promise<Map<string, PublicIdentity>> {
  const identities = new Map<string, PublicIdentity>();
  if (userIds.length === 0) return identities;
  const rows = await db
    .selectFrom("tournament_identities as identities")
    .innerJoin("tournament_users as users", "users.id", "identities.user_id")
    .select([
      "identities.user_id",
      "identities.provider",
      "identities.handle",
      "identities.display_name",
      "identities.avatar_url",
      "identities.verified",
      "users.flagged",
      "users.affiliation",
    ])
    .distinctOn("identities.user_id")
    .where("identities.user_id", "in", [...new Set(userIds)])
    .orderBy("identities.user_id")
    .orderBy("identities.last_login_at", "desc")
    .execute();
  for (const row of rows) {
    identities.set(row.user_id, {
      handle: row.handle,
      provider: row.provider,
      profileSlug: profileSlug(row.provider, row.handle),
      affiliation: row.affiliation,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      verified: row.verified,
      flagged: row.flagged,
    });
  }
  return identities;
}

/**
 * The user behind a profile slug. `~name` resolves among password accounts
 * only; a bare handle among X (and development) identities, where handles
 * move between accounts, so the latest sign-in wins.
 */
export async function userIdForHandle(db: TournamentDb, slug: string): Promise<string | undefined> {
  const password = slug.startsWith(PASSWORD_PROFILE_PREFIX);
  const handle = password ? slug.slice(PASSWORD_PROFILE_PREFIX.length) : slug;
  const row = await db
    .selectFrom("tournament_identities")
    .select("user_id")
    .where("handle_normalized", "=", handle.toLowerCase())
    .where("provider", password ? "=" : "<>", "password")
    .orderBy("last_login_at", "desc")
    .limit(1)
    .executeTakeFirst();
  return row?.user_id;
}
