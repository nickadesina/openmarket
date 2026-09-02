import { type Kysely, sql } from "kysely";

import { ServiceError } from "../api/errors.js";
import type { ContractSide, Database, MetricKind, TradeAction } from "../db/schema.js";

export const ACTIVITY_DEFAULT_LIMIT = 25;
export const ACTIVITY_MAX_LIMIT = 100;
const MAX_CURSOR_LENGTH = 512;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/;
const CURSOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/;
const MAX_BIGINT = 9_223_372_036_854_775_807n;

export interface ActivityOptions {
  readonly slug?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ActivityItem {
  readonly company: {
    readonly name: string;
    readonly slug: string;
    readonly logoPath: string;
  };
  readonly metricKind: MetricKind;
  readonly marketSequence: string;
  readonly action: TradeAction;
  readonly side: ContractSide;
  readonly strikeIndex: number;
  readonly strikeValueUsd: string | null;
  readonly quantity: number;
  readonly cashAmountCents: string;
  readonly metricBefore: number;
  readonly metricAfter: number;
  readonly createdAt: string;
}

export interface ActivityPage {
  readonly items: ActivityItem[];
  readonly limit: number;
  readonly nextCursor: string | null;
}

interface ActivityCursor {
  readonly version: 1;
  readonly scope: string | null;
  readonly createdAt: Date;
  readonly marketSequence: string;
  readonly tradeId: string;
}

interface ActivityRow {
  readonly id: string;
  readonly market_sequence: string;
  readonly action: TradeAction;
  readonly contract_side: ContractSide;
  readonly strike_index: number;
  readonly strike_value: string | null;
  readonly quantity: number;
  readonly cash_amount_cents: string;
  readonly metric_before: number;
  readonly metric_after: number;
  readonly created_at: Date;
  readonly metric_kind: MetricKind;
  readonly company_name: string;
  readonly company_slug: string;
  readonly company_logo_path: string;
}

function invalidCursor(): ServiceError {
  return new ServiceError("INVALID_INPUT", "Activity cursor is invalid.");
}

function normalizeOptions(options: ActivityOptions): {
  readonly slug: string | undefined;
  readonly limit: number;
  readonly cursor: ActivityCursor | null;
} {
  const slug = options.slug;
  if (slug !== undefined && (slug.length > 100 || !SLUG_PATTERN.test(slug))) {
    throw new ServiceError("INVALID_INPUT", "Company slug is invalid.");
  }
  const limit = options.limit ?? ACTIVITY_DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > ACTIVITY_MAX_LIMIT) {
    throw new ServiceError(
      "INVALID_INPUT",
      `Activity limit must be an integer from 1 through ${ACTIVITY_MAX_LIMIT}.`,
    );
  }

  if (options.cursor === undefined) {
    return { slug, limit, cursor: null };
  }
  if (
    options.cursor.length === 0 ||
    options.cursor.length > MAX_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+(?![\s\S])/.test(options.cursor)
  ) {
    throw invalidCursor();
  }

  try {
    const decoded: unknown = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8"));
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
      throw invalidCursor();
    }
    const record = decoded as Record<string, unknown>;
    if (
      Object.keys(record).length !== 5 ||
      record.v !== 1 ||
      (record.scope !== null && typeof record.scope !== "string") ||
      record.scope !== (slug ?? null) ||
      typeof record.t !== "string" ||
      typeof record.s !== "string" ||
      !/^\d+(?![\s\S])/.test(record.s) ||
      typeof record.i !== "string" ||
      !CURSOR_ID_PATTERN.test(record.i)
    ) {
      throw invalidCursor();
    }
    if (BigInt(record.s) > MAX_BIGINT) {
      throw invalidCursor();
    }
    const createdAt = new Date(record.t);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== record.t) {
      throw invalidCursor();
    }
    return {
      slug,
      limit,
      cursor: {
        version: 1,
        scope: record.scope,
        createdAt,
        marketSequence: record.s,
        tradeId: record.i,
      },
    };
  } catch (error) {
    if (error instanceof ServiceError) {
      throw error;
    }
    throw invalidCursor();
  }
}

function encodeCursor(row: ActivityRow, scope: string | undefined): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      scope: scope ?? null,
      t: row.created_at.toISOString(),
      s: row.market_sequence,
      i: row.id,
    }),
    "utf8",
  ).toString("base64url");
}

function publicItem(row: ActivityRow): ActivityItem {
  return {
    company: {
      name: row.company_name,
      slug: row.company_slug,
      logoPath: row.company_logo_path,
    },
    metricKind: row.metric_kind,
    marketSequence: row.market_sequence,
    action: row.action,
    side: row.contract_side,
    strikeIndex: row.strike_index,
    strikeValueUsd: row.strike_value,
    quantity: row.quantity,
    cashAmountCents: row.cash_amount_cents,
    metricBefore: row.metric_before,
    metricAfter: row.metric_after,
    createdAt: row.created_at.toISOString(),
  };
}

export async function getActivity(
  db: Kysely<Database>,
  options: ActivityOptions = {},
): Promise<ActivityPage> {
  const { slug, limit, cursor } = normalizeOptions(options);

  return db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(async (transaction) => {
      if (slug !== undefined) {
        const company = await transaction
          .selectFrom("companies")
          .select("id")
          .where("slug", "=", slug)
          .executeTakeFirst();
        if (company === undefined) {
          throw new ServiceError("MARKET_NOT_FOUND", "Market was not found.");
        }
      }

      let query = transaction
        .selectFrom("trades")
        .innerJoin("markets", "markets.id", "trades.market_id")
        .innerJoin("companies", "companies.id", "markets.company_id")
        .select([
          "trades.id as id",
          "trades.market_sequence as market_sequence",
          "trades.action as action",
          "trades.contract_side as contract_side",
          "trades.strike_index as strike_index",
          "trades.strike_value as strike_value",
          "trades.quantity as quantity",
          "trades.cash_amount_cents as cash_amount_cents",
          "trades.metric_before as metric_before",
          "trades.metric_after as metric_after",
          "trades.created_at as created_at",
          "markets.metric_kind as metric_kind",
          "companies.name as company_name",
          "companies.slug as company_slug",
          "companies.logo_path as company_logo_path",
        ]);

      if (slug !== undefined) {
        query = query.where("companies.slug", "=", slug);
      }
      if (cursor !== null) {
        query = query.where(
          sql<boolean>`(trades.created_at, trades.market_sequence, trades.id) < (${cursor.createdAt}::timestamptz, ${cursor.marketSequence}::bigint, ${cursor.tradeId}::uuid)`,
        );
      }

      const rows = await query
        .orderBy("trades.created_at", "desc")
        .orderBy("trades.market_sequence", "desc")
        .orderBy("trades.id", "desc")
        .limit(limit + 1)
        .execute();
      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;

      return {
        items: pageRows.map(publicItem),
        limit,
        nextCursor:
          hasMore && pageRows.length > 0
            ? encodeCursor(pageRows[pageRows.length - 1]!, slug)
            : null,
      };
    });
}
