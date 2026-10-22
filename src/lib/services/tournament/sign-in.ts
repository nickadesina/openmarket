import type { Kysely } from "kysely";

import type { Database, TournamentProvider } from "../../db/schema.js";

export interface IdentityProfile {
  readonly provider: TournamentProvider;
  readonly providerUserId: string;
  readonly handle: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly verified: boolean;
  readonly providerCreatedAt: Date | null;
}

export interface SignedInIdentity {
  readonly userId: string;
  /** True only when this call created the identity: its first sign-in, which onboards. */
  readonly created: boolean;
}

/**
 * One user per provider id. The id is the identity; handle, name and avatar
 * are re-fetched and cached on every sign-in because handles change.
 */
export async function upsertIdentity(
  db: Kysely<Database>,
  profile: IdentityProfile,
): Promise<SignedInIdentity> {
  return db.transaction().execute(async (transaction) => {
    const values = {
      handle: profile.handle,
      handle_normalized: profile.handle.toLowerCase(),
      display_name: profile.displayName,
      avatar_url: profile.avatarUrl,
      verified: profile.verified,
      provider_created_at: profile.providerCreatedAt,
      last_login_at: new Date(),
    };
    const existing = await transaction
      .updateTable("tournament_identities")
      .set(values)
      .where("provider", "=", profile.provider)
      .where("provider_user_id", "=", profile.providerUserId)
      .returning("user_id")
      .executeTakeFirst();
    if (existing !== undefined) return { userId: existing.user_id, created: false };

    const user = await transaction
      .insertInto("tournament_users")
      .defaultValues()
      .returning("id")
      .executeTakeFirstOrThrow();
    const inserted = await transaction
      .insertInto("tournament_identities")
      .values({
        ...values,
        user_id: user.id,
        provider: profile.provider,
        provider_user_id: profile.providerUserId,
      })
      .onConflict((conflict) => conflict.columns(["provider", "provider_user_id"]).doNothing())
      .returning("user_id")
      .executeTakeFirst();
    if (inserted !== undefined) return { userId: inserted.user_id, created: true };

    // A concurrent first sign-in won the race; adopt its user and drop ours.
    // That call onboards, so this one is a returning sign-in.
    await transaction.deleteFrom("tournament_users").where("id", "=", user.id).execute();
    const winner = await transaction
      .selectFrom("tournament_identities")
      .select("user_id")
      .where("provider", "=", profile.provider)
      .where("provider_user_id", "=", profile.providerUserId)
      .executeTakeFirstOrThrow();
    return { userId: winner.user_id, created: false };
  });
}
