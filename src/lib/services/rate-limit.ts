import { createHash } from "node:crypto";

import { type Kysely, sql } from "kysely";

import { ServiceError } from "../api/errors.js";
import type { Database } from "../db/schema.js";
import { trustedClientAddress } from "../security/comment-address.js";

export type RateLimitScope = "admin_login" | "user_create" | "quote" | "trade";

export interface RateLimitPolicy {
  readonly limit: number;
  readonly windowMs: number;
}

export const RATE_LIMIT_POLICIES: Readonly<Record<RateLimitScope, RateLimitPolicy>> = {
  // Failed attempts only; the login route checks availability before
  // verifying and consumes quota only when verification fails.
  admin_login: { limit: 10, windowMs: 15 * 60_000 },
  user_create: { limit: 20, windowMs: 60_000 },
  quote: { limit: 120, windowMs: 60_000 },
  trade: { limit: 30, windowMs: 60_000 },
};

/** Per-network ceilings consumed alongside the per-user policy, so minting
 * fresh accounts cannot reset a caller's quote/trade quota. */
export const RATE_LIMIT_NETWORK_POLICIES: Readonly<Record<"quote" | "trade", RateLimitPolicy>> = {
  quote: { limit: 600, windowMs: 60_000 },
  trade: { limit: 120, windowMs: 60_000 },
};

export interface RateLimitWindowState {
  readonly windowStartedAtMs: number;
  readonly count: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
  readonly nextWindowStartedAtMs: number;
  readonly nextCount: number;
}

/** Pure fixed-window decision; the database wrapper supplies the clock. */
export function evaluateRateLimitWindow(
  state: RateLimitWindowState,
  nowMs: number,
  policy: RateLimitPolicy,
): RateLimitDecision {
  const expiresAtMs = state.windowStartedAtMs + policy.windowMs;
  if (expiresAtMs <= nowMs) {
    return { allowed: true, retryAfterSeconds: 0, nextWindowStartedAtMs: nowMs, nextCount: 1 };
  }
  if (state.count >= policy.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((expiresAtMs - nowMs) / 1_000),
      nextWindowStartedAtMs: state.windowStartedAtMs,
      nextCount: state.count,
    };
  }
  return {
    allowed: true,
    retryAfterSeconds: 0,
    nextWindowStartedAtMs: state.windowStartedAtMs,
    nextCount: state.count + 1,
  };
}

/**
 * Hashed bucket key for the caller's network. Unlike comment posting this
 * never fails the request: without a trusted address every caller shares
 * one unattributed bucket, which limits abuse instead of disabling the route.
 */
export function rateLimitNetworkKey(
  request: Request,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const address = trustedClientAddress(request, environment) ?? "unattributed";
  return createHash("sha256")
    .update("openmarket.rate-limit.network.v1\0")
    .update(address)
    .digest("hex");
}

async function applyRateLimit(
  db: Kysely<Database>,
  scope: RateLimitScope,
  key: string,
  policy: RateLimitPolicy,
  increment: boolean,
): Promise<void> {
  await db.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("rate_limits")
      .values({
        scope,
        key,
        window_started_at: sql`clock_timestamp()`,
        request_count: 0,
      })
      .onConflict((conflict) => conflict.columns(["scope", "key"]).doNothing())
      .execute();
    const counters = await transaction
      .selectFrom("rate_limits")
      .selectAll()
      .where("scope", "=", scope)
      .where("key", "=", key)
      .forUpdate()
      .execute();
    // Read the database clock after acquiring the row lock, not before the wait.
    const { now } = await transaction
      .selectNoFrom(sql<Date>`clock_timestamp()`.as("now"))
      .executeTakeFirstOrThrow();
    const counter = counters[0]!;
    const decision = evaluateRateLimitWindow(
      { windowStartedAtMs: counter.window_started_at.getTime(), count: counter.request_count },
      now.getTime(),
      policy,
    );
    if (!decision.allowed) {
      throw new ServiceError("RATE_LIMITED", "Too many requests. Please wait and try again.", {
        retryAfterSeconds: decision.retryAfterSeconds,
      });
    }
    if (!increment) return;
    await transaction
      .updateTable("rate_limits")
      .set({
        window_started_at: new Date(decision.nextWindowStartedAtMs),
        request_count: decision.nextCount,
      })
      .where("scope", "=", scope)
      .where("key", "=", key)
      .execute();
  });
}

/** Consumes one unit of quota, or throws RATE_LIMITED before any real work. */
export async function consumeRateLimit(
  db: Kysely<Database>,
  scope: RateLimitScope,
  key: string,
  policy: RateLimitPolicy = RATE_LIMIT_POLICIES[scope],
): Promise<void> {
  return applyRateLimit(db, scope, key, policy, true);
}

/** Throws RATE_LIMITED when the window is exhausted, without consuming quota. */
export async function assertRateLimitAvailable(
  db: Kysely<Database>,
  scope: RateLimitScope,
  key: string,
  policy: RateLimitPolicy = RATE_LIMIT_POLICIES[scope],
): Promise<void> {
  return applyRateLimit(db, scope, key, policy, false);
}

/**
 * Network-keyed variants. In development/test every caller shares the
 * synthetic "loopback" address, which is not a real network identity:
 * applying per-network policies to it would throttle the developer and
 * the browser test suite itself. Those deployments skip network buckets;
 * per-user limits still apply, and production without a trusted address
 * keeps the shared unattributed bucket.
 */
function networkKeyUnlessLocal(request: Request, keyPrefix: string): string | null {
  if (trustedClientAddress(request) === "loopback") return null;
  return `${keyPrefix}${rateLimitNetworkKey(request)}`;
}

export async function consumeNetworkRateLimit(
  db: Kysely<Database>,
  scope: RateLimitScope,
  request: Request,
  policy: RateLimitPolicy = RATE_LIMIT_POLICIES[scope],
  keyPrefix = "",
): Promise<void> {
  const key = networkKeyUnlessLocal(request, keyPrefix);
  if (key !== null) await consumeRateLimit(db, scope, key, policy);
}

export async function assertNetworkRateLimitAvailable(
  db: Kysely<Database>,
  scope: RateLimitScope,
  request: Request,
  policy: RateLimitPolicy = RATE_LIMIT_POLICIES[scope],
): Promise<void> {
  const key = networkKeyUnlessLocal(request, "");
  if (key !== null) await assertRateLimitAvailable(db, scope, key, policy);
}
