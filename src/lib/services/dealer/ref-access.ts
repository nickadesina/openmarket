import type { Kysely } from "kysely";

import { ServiceError } from "../../api/errors.js";
import { bearerApiKey, hashApiKey } from "../../auth/api-key.js";
import type { Database } from "../../db/schema.js";
import { trustedClientAddress } from "../../security/comment-address.js";
import { consumeNetworkRateLimit, consumeRateLimit, RATE_LIMIT_POLICIES } from "../rate-limit.js";

const MINUTE_MS = 60_000;

export type RefCaller =
  | { readonly tier: "public" }
  | { readonly tier: "keyed"; readonly keyId: string; readonly quotaPerMinute: number };

/**
 * The reference API's gate (README D14): a public caller draws one unit from
 * its network's `ref` bucket (60 a minute); a request with a live key draws
 * from that key's own quota instead. A revoked or unknown key is refused.
 * Like the other network buckets, local development and tests share one
 * loopback caller that is not limited, and that caller opens no database
 * connection here (`dbOf` is only called when a bucket is counted).
 */
export async function consumeRefQuota(
  dbOf: () => Kysely<Database>,
  request: Request,
): Promise<RefCaller> {
  const key = bearerApiKey(request);
  if (key === null) {
    if (trustedClientAddress(request) !== "loopback") {
      await consumeNetworkRateLimit(dbOf(), "ref", request, RATE_LIMIT_POLICIES.ref, "network:");
    }
    return { tier: "public" };
  }
  const db = dbOf();
  const row = await db
    .selectFrom("api_keys")
    .select(["id", "quota_per_minute", "revoked_at"])
    .where("key_hash", "=", hashApiKey(key))
    .executeTakeFirst();
  if (row === undefined || row.revoked_at !== null) {
    throw new ServiceError("API_KEY_INVALID", "The API key is not valid.");
  }
  await consumeRateLimit(db, "ref", `key:${row.id}`, {
    limit: row.quota_per_minute,
    windowMs: MINUTE_MS,
  });
  return { tier: "keyed", keyId: row.id, quotaPerMinute: row.quota_per_minute };
}

export interface CreatedApiKey {
  readonly id: string;
  readonly name: string;
  readonly quota_per_minute: number;
  readonly created_at: Date;
}

/** Stores a new key's hash; the caller shows the key itself once and keeps nothing. */
export async function insertApiKey(
  db: Kysely<Database>,
  input: { readonly name: string; readonly keyHash: string; readonly quotaPerMinute: number },
): Promise<CreatedApiKey> {
  return db
    .insertInto("api_keys")
    .values({
      name: input.name,
      key_hash: input.keyHash,
      quota_per_minute: input.quotaPerMinute,
    })
    .returning(["id", "name", "quota_per_minute", "created_at"])
    .executeTakeFirstOrThrow();
}
