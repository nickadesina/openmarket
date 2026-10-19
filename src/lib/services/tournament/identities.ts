import type { PublicIdentity, TournamentDb } from "./records.js";

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
      "identities.handle",
      "identities.display_name",
      "identities.avatar_url",
      "identities.verified",
      "users.flagged",
    ])
    .distinctOn("identities.user_id")
    .where("identities.user_id", "in", [...new Set(userIds)])
    .orderBy("identities.user_id")
    .orderBy("identities.last_login_at", "desc")
    .execute();
  for (const row of rows) {
    identities.set(row.user_id, {
      handle: row.handle,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      verified: row.verified,
      flagged: row.flagged,
    });
  }
  return identities;
}

/** The user currently holding a handle; handles move, so the latest sign-in wins. */
export async function userIdForHandle(
  db: TournamentDb,
  handle: string,
): Promise<string | undefined> {
  const row = await db
    .selectFrom("tournament_identities")
    .select("user_id")
    .where("handle_normalized", "=", handle.toLowerCase())
    .orderBy("last_login_at", "desc")
    .limit(1)
    .executeTakeFirst();
  return row?.user_id;
}
