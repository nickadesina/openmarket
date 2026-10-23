import { type Kysely, sql, type Transaction } from "kysely";
import { ServiceError } from "../../api/errors.js";
import type {
  CompanyRow,
  Database,
  InstrumentRow,
  JsonValue,
  ListingRow,
} from "../../db/schema.js";
import type { InstrumentSnapshot } from "../../engine/dealer/lifecycle.js";

export function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}
export function lockListing(db: Transaction<Database>, id: string) {
  return sql`select pg_advisory_xact_lock(hashtext('openmarket_listing'), hashtext(${id}))`.execute(
    db,
  );
}
export function lockIdempotency(db: Transaction<Database>, key: bigint) {
  return sql`select pg_advisory_xact_lock(${key.toString()}::bigint)`.execute(db);
}
export function lockCron(db: Transaction<Database>, job: string) {
  return sql`select pg_advisory_xact_lock(hashtext('openmarket_cron'), hashtext(${job}))`.execute(
    db,
  );
}
export type ListingWithCompany = ListingRow & {
  readonly company: Pick<CompanyRow, "id" | "name" | "slug">;
};
export function listingQuery(db: Kysely<Database>) {
  return db
    .selectFrom("listings")
    .innerJoin("companies", "companies.id", "listings.company_id")
    .selectAll("listings")
    .select(["companies.name as company_name", "companies.slug as company_slug"]);
}
export function listingWithCompany(
  row: ListingRow & { company_name: string; company_slug: string },
): ListingWithCompany {
  const { company_name, company_slug, ...listing } = row;
  return {
    ...listing,
    company: { id: listing.company_id, name: company_name, slug: company_slug },
  };
}
export function lifecycleSnapshot(
  instrument: InstrumentRow,
  flagHours: number,
): InstrumentSnapshot {
  const until = instrument.state === "widened" ? instrument.widened_until : null;
  return {
    kind: instrument.kind,
    state: instrument.state,
    expiresAt: instrument.expires_at,
    widenedAt: until === null ? null : new Date(until.getTime() - flagHours * 3_600_000),
    widenedUntil: until,
  };
}
export async function loadTradeReplay<T extends JsonValue>(
  db: Transaction<Database>,
  key: string,
  userId: string,
  fingerprint: string,
  valid: (value: JsonValue) => value is T,
  invalidMessage: string,
): Promise<T | undefined> {
  const row = await db
    .selectFrom("trades")
    .select(["user_id", "request_fingerprint", "execution_result"])
    .where("idempotency_key", "=", key)
    .executeTakeFirst();
  if (row === undefined) return undefined;
  if (
    row.user_id.toLowerCase() !== userId.toLowerCase() ||
    row.request_fingerprint !== fingerprint
  ) {
    throw new ServiceError(
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key is bound to a different caller or request.",
    );
  }
  if (!valid(row.execution_result)) throw new ServiceError("IDEMPOTENCY_CONFLICT", invalidMessage);
  return row.execution_result;
}

export function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const group = groups.get(id) ?? [];
    group.push(row);
    groups.set(id, group);
  }
  return groups;
}
