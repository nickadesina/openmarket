import { type Kysely, type RawBuilder, sql } from "kysely";
import { ServiceError } from "../../api/errors.js";
import { MODEL_VERSION } from "../../config/dealer.js";
import type { Database } from "../../db/schema.js";
import { BLEND_VERSION } from "../../engine/dealer/blend.js";
import { RULEBOOK_VERSION } from "../../engine/dealer/rulebook.js";
import { type ListingWithCompany, listingQuery, listingWithCompany } from "./service-helpers.js";

/**
 * What every /api/ref/* operation shares (README D14): the version envelope
 * every payload opens with, the listing a slug names, and the keyset cursor
 * the paginated logs use. Valuations are ln USD in the tables and carried in
 * both ln and dollars here.
 */

export interface RefEnvelope {
  /** The versions the server publishes under now; stored rows also carry their own. */
  readonly model_version: string;
  readonly rulebook_version: string;
  readonly blend_version: string;
  readonly as_of: string;
}

export function refEnvelope(now: Date): RefEnvelope {
  return {
    model_version: MODEL_VERSION,
    rulebook_version: RULEBOOK_VERSION,
    blend_version: BLEND_VERSION,
    as_of: now.toISOString(),
  };
}

export type RefListing = ListingWithCompany;

/** The active listing of the company `slug` names, or LISTING_NOT_FOUND. */
export async function loadRefListing(db: Kysely<Database>, slug: string): Promise<RefListing> {
  const row = await listingQuery(db)
    .where("companies.slug", "=", slug)
    .where("listings.delisted_at", "is", null)
    .executeTakeFirst();
  if (row === undefined) throw new ServiceError("LISTING_NOT_FOUND", "Listing not found.");
  return listingWithCompany(row);
}

/** exp(ln) in USD, rounded to the cent: what a ln-USD level reads as at the API. */
export function usdOfLn(ln: number): number {
  return Math.round(Math.exp(ln) * 100) / 100;
}

export function centsToUsd(cents: string | number): number {
  return Number(cents) / 100;
}

/** −1, 0 or 1. */
export function signOf(value: number): -1 | 0 | 1 {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

/** The last row a page returned, as (time, tiebreak): the next page starts after it. */
export interface KeysetPosition {
  readonly at: string;
  readonly key: string;
}

const POSITION_PATTERN = /^[0-9a-f-]{1,36}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validCursorTime(value: string): boolean {
  if (!TIME_PATTERN.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 23) === value.slice(0, 23);
}
/** cursorTime's output: UTC, microseconds, so a page never repeats a row timestamptz rounded. */
const TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** A timestamptz column as a cursor time, at the column's full precision. */
export function cursorTime(column: string): RawBuilder<string> {
  return sql<string>`to_char(${sql.ref(column)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/** `(time, key) > (cursor)` for a keyset page; `keyType` casts the tiebreak. */
export function afterPosition(
  timeColumn: string,
  keyColumn: string,
  position: KeysetPosition,
  keyType: "uuid" | "bigint",
): RawBuilder<boolean> {
  const validKey =
    keyType === "uuid"
      ? UUID_PATTERN.test(position.key)
      : /^\d{1,19}$/.test(position.key) && BigInt(position.key) <= 9_223_372_036_854_775_807n;
  if (!validKey || !validCursorTime(position.at)) throw invalidCursor();
  return sql<boolean>`(${sql.ref(timeColumn)}, ${sql.ref(keyColumn)}) > (${position.at}::timestamptz, ${position.key}::${sql.raw(keyType)})`;
}

export function encodeCursor(
  value: Readonly<Record<string, KeysetPosition | "end" | null>>,
): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function invalidCursor(): ServiceError {
  return new ServiceError("INVALID_INPUT", "Invalid cursor query parameter.", {
    parameter: "cursor",
  });
}

/** One stream's entry in a cursor: not started, a position, or ended. */
function streamPosition(value: unknown): KeysetPosition | "end" | null {
  if (value === undefined || value === null) return null;
  if (value === "end") return "end";
  const position = value as Partial<KeysetPosition>;
  if (
    typeof position !== "object" ||
    typeof position.at !== "string" ||
    !validCursorTime(position.at) ||
    typeof position.key !== "string" ||
    !POSITION_PATTERN.test(position.key)
  ) {
    throw invalidCursor();
  }
  return { at: position.at, key: position.key };
}

/** A cursor this API issued, read back; anything else is INVALID_INPUT. */
export function decodeCursor<const S extends string>(
  cursor: string | undefined,
  streams: readonly S[],
): Record<S, KeysetPosition | "end" | null> {
  let record: Record<string, unknown> = {};
  if (cursor !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    } catch {
      throw invalidCursor();
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw invalidCursor();
    }
    record = parsed as Record<string, unknown>;
    if (Object.keys(record).some((key) => !(streams as readonly string[]).includes(key))) {
      throw invalidCursor();
    }
  }
  return Object.fromEntries(
    streams.map((stream) => [stream, streamPosition(record[stream])]),
  ) as Record<S, KeysetPosition | "end" | null>;
}

/**
 * A page from `limit + 1` fetched rows: the first `limit`, and the position
 * the next page starts after, or `end` when nothing is left.
 */
export function takePage<T>(
  fetched: readonly T[],
  limit: number,
  position: (row: T) => KeysetPosition,
): { readonly items: T[]; readonly next: KeysetPosition | "end" } {
  const items = fetched.slice(0, limit);
  return { items, next: fetched.length > limit ? position(items.at(-1)!) : "end" };
}

/** The next cursor, or null once every stream has ended. */
export function cursorAfter(
  positions: Readonly<Record<string, KeysetPosition | "end">>,
): string | null {
  return Object.values(positions).every((position) => position === "end")
    ? null
    : encodeCursor(positions);
}
