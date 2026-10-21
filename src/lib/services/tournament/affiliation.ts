import type { Kysely } from "kysely";

import { ServiceError } from "../../api/errors.js";
import type { Database } from "../../db/schema.js";
import { userIdForHandle } from "./identities.js";

/** Sets or clears a forecaster's self-reported affiliation. */
export async function setAffiliation(
  db: Kysely<Database>,
  userId: string,
  affiliation: string | null,
): Promise<{ readonly affiliation: string | null }> {
  await db
    .updateTable("tournament_users")
    .set({ affiliation })
    .where("id", "=", userId)
    .executeTakeFirstOrThrow();
  return { affiliation };
}

/** Admin override, for an affiliation that misleads or offends. */
export async function setAffiliationForHandle(
  db: Kysely<Database>,
  slug: string,
  affiliation: string | null,
): Promise<{ readonly handle: string; readonly affiliation: string | null }> {
  const userId = await userIdForHandle(db, slug);
  if (userId === undefined) {
    throw new ServiceError("FORECASTER_NOT_FOUND", "No forecaster has that handle.");
  }
  await setAffiliation(db, userId, affiliation);
  return { handle: slug, affiliation };
}
