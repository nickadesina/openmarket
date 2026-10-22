import type { Kysely } from "kysely";

import type { Database } from "../../db/schema.js";
import { consumeNetworkRateLimit, consumeRateLimit, RATE_LIMIT_NETWORK_POLICIES } from "../rate-limit.js";

/** Independent profile buckets reuse the evidence policy, per forecaster and per network. */
export async function consumeProfileRateLimit(db: Kysely<Database>, userId: string, request: Request): Promise<void> {
  await consumeRateLimit(db, "evidence", `profile:user:${userId}`);
  await consumeNetworkRateLimit(db, "evidence", request, RATE_LIMIT_NETWORK_POLICIES.evidence, "profile:network:");
}
