import { type Kysely, sql } from "kysely";

import { ServiceError } from "../api/errors.js";
import {
  type ApiKeyTier,
  bearerApiKey,
  DESIGN_PARTNER_KEY_DAYS,
  hashApiKey,
} from "../auth/api-key.js";
import type { Database } from "../db/schema.js";
import { trustedClientAddress } from "../security/comment-address.js";
import { consumeNetworkRateLimit, consumeRateLimit, RATE_LIMIT_POLICIES } from "./rate-limit.js";

const MINUTE_MS = 60_000;

export type RefCaller =
  | { readonly tier: "public" }
  | { readonly tier: "keyed"; readonly keyId: string; readonly quotaPerMinute: number };

/**
 * The reference API's gate (v1 README D14, kept in v2): a public caller draws one unit from
 * its network's `ref` bucket (60 a minute); a request with a live key draws
 * from that key's own quota instead. A revoked or unknown key is refused, and
 * an expired one is refused with its expiry named; a served keyed request is
 * counted against its key's UTC day (migration 018).
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
    .select(["id", "quota_per_minute", "revoked_at", "expires_at"])
    .where("key_hash", "=", hashApiKey(key))
    .executeTakeFirst();
  if (row === undefined || row.revoked_at !== null) {
    throw new ServiceError("API_KEY_INVALID", "The API key is not valid.");
  }
  if (row.expires_at !== null && row.expires_at.getTime() <= Date.now()) {
    const expiredAt = row.expires_at.toISOString();
    throw new ServiceError("API_KEY_EXPIRED", `The API key expired on ${expiredAt}.`, {
      expired_at: expiredAt,
    });
  }
  await consumeRateLimit(db, "ref", `key:${row.id}`, {
    limit: row.quota_per_minute,
    windowMs: MINUTE_MS,
  });
  await db
    .insertInto("api_key_usage")
    .values({
      key_id: row.id,
      day: sql<string>`(now() at time zone 'utc')::date`,
      request_count: 1,
    })
    .onConflict((conflict) =>
      conflict
        .columns(["key_id", "day"])
        .doUpdateSet({ request_count: sql`api_key_usage.request_count + 1` }),
    )
    .execute();
  return { tier: "keyed", keyId: row.id, quotaPerMinute: row.quota_per_minute };
}

export interface CreatedApiKey {
  readonly id: string;
  readonly name: string;
  readonly quota_per_minute: number;
  readonly tier: ApiKeyTier;
  readonly created_at: Date;
  readonly expires_at: Date | null;
}

/**
 * Stores a new key's hash; the caller shows the key itself once and keeps
 * nothing. A design-partner key's expiry is counted from the database's own
 * creation time.
 */
export async function insertApiKey(
  db: Kysely<Database>,
  input: {
    readonly name: string;
    readonly keyHash: string;
    readonly quotaPerMinute: number;
    readonly tier?: ApiKeyTier;
  },
): Promise<CreatedApiKey> {
  const tier = input.tier ?? "standard";
  return db
    .insertInto("api_keys")
    .values({
      name: input.name,
      key_hash: input.keyHash,
      quota_per_minute: input.quotaPerMinute,
      tier,
      expires_at:
        tier === "design_partner"
          ? sql<Date>`now() + make_interval(days => ${DESIGN_PARTNER_KEY_DAYS})`
          : null,
    })
    .returning(["id", "name", "quota_per_minute", "tier", "created_at", "expires_at"])
    .executeTakeFirstOrThrow();
}
