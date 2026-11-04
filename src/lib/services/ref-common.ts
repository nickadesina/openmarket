import { type RawBuilder, sql } from "kysely";
import { ServiceError } from "../api/errors.js";
import { RULEBOOK_VERSION } from "../engine/rulebook.js";

/**
 * What every /api/ref/* operation shares: the version envelope every payload
 * opens with and the keyset cursor the paginated logs use.
 *
 * The envelope here is the interim one (rulebook_version and as_of only);
 * the v2 envelope (methodology_version, ce_version, rulebook_version, as_of,
 * lag_note) replaces it with the index payloads (docs/prompts/v2/README.md).
 */

export interface RefEnvelope {
  readonly rulebook_version: string;
  readonly as_of: string;
}

export function refEnvelope(now: Date): RefEnvelope {
  return { rulebook_version: RULEBOOK_VERSION, as_of: now.toISOString() };
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
