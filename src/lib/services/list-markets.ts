import { type Kysely, sql } from "kysely";

import { ServiceError } from "../api/errors.js";
import type { Database, MarketStatus, MetricKind } from "../db/schema.js";

export interface MarketListOptions {
  readonly now?: Date;
  readonly historyLimit?: number;
}

export interface MarketListHistoryPoint {
  readonly timestamp: string;
  readonly marketSequence: string;
  readonly value: number;
}

export interface MarketListItem {
  readonly marketId: string;
  readonly company: {
    readonly name: string;
    readonly slug: string;
    readonly logoPath: string;
  };
  readonly status: MarketStatus;
  readonly metric: {
    readonly kind: MetricKind;
    readonly label: "Implied valuation" | "YES probability";
    readonly format: "usd" | "probability";
    readonly current: number;
    readonly change24Hours: number;
  };
  readonly anchor: {
    readonly valuationUsd: string;
    readonly date: string;
    readonly description: string;
  } | null;
  readonly history: MarketListHistoryPoint[];
  readonly outstandingClaims: number;
  readonly sequence: string;
  readonly createdAt: string;
  readonly settledAt: string | null;
}

export interface MarketListResult {
  readonly markets: MarketListItem[];
  readonly asOf: string;
}

interface HistoryRow {
  readonly market_id: string;
  readonly market_sequence: string;
  readonly ts: Date;
  readonly value: number;
}

const DEFAULT_HISTORY_LIMIT = 24;
const MAX_HISTORY_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1_000;

function normalizeOptions(options: MarketListOptions): {
  readonly now: Date;
  readonly historyLimit: number;
} {
  const now = options.now === undefined ? new Date() : new Date(options.now.getTime());
  if (!Number.isFinite(now.getTime())) {
    throw new ServiceError("INVALID_INPUT", "Read clock must be a valid date.");
  }
  const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 2 || historyLimit > MAX_HISTORY_LIMIT) {
    throw new ServiceError(
      "INVALID_INPUT",
      `historyLimit must be an integer from 2 through ${MAX_HISTORY_LIMIT}.`,
    );
  }
  return { now, historyLimit };
}

function compareSequences(left: string, right: string): number {
  if (!/^\d+$/.test(left) || !/^\d+$/.test(right)) {
    throw new ServiceError("INVALID_INPUT", "Stored mark sequence is invalid.");
  }
  const leftSequence = BigInt(left);
  const rightSequence = BigInt(right);
  return leftSequence < rightSequence ? -1 : leftSequence > rightSequence ? 1 : 0;
}

export async function listMarkets(
  db: Kysely<Database>,
  options: MarketListOptions = {},
): Promise<MarketListResult> {
  const { now, historyLimit } = normalizeOptions(options);
  const changeCutoff = new Date(now.getTime() - DAY_MS);

  return db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(async (transaction) => {
      const rankedMarks = transaction
        .selectFrom("marks")
        .select(["market_id", "market_sequence", "ts", "value"])
        .select(
          sql<number>`row_number() over (partition by market_id order by ts desc, market_sequence desc)`.as(
            "history_rank",
          ),
        )
        .where("ts", "<=", now)
        .as("ranked_marks");

      const [marketRows, unorderedHistoryRows] = await Promise.all([
        transaction
          .selectFrom("markets")
          .innerJoin("companies", "companies.id", "markets.company_id")
          .select([
            "markets.id as market_id",
            "markets.status as status",
            "markets.metric_kind as metric_kind",
            "markets.anchor_valuation as anchor_valuation",
            "markets.anchor_date as anchor_date",
            "markets.anchor_description as anchor_description",
            "markets.current_metric as current_metric",
            "markets.last_market_sequence as last_market_sequence",
            "markets.created_at as created_at",
            "markets.settled_at as settled_at",
            "companies.name as company_name",
            "companies.slug as company_slug",
            "companies.logo_path as company_logo_path",
            sql<number>`coalesce((select sum(bucket_quantity) from holdings as claim_holding cross join lateral unnest(claim_holding.h) as bucket(bucket_quantity) where claim_holding.market_id = markets.id), 0)`.as(
              "outstanding_claims",
            ),
            sql<number>`coalesce(
              (select value from marks as prior_mark where prior_mark.market_id = markets.id and prior_mark.ts <= ${changeCutoff} order by prior_mark.ts desc, prior_mark.market_sequence desc limit 1),
              (select value from marks as first_mark where first_mark.market_id = markets.id and first_mark.ts <= ${now} order by first_mark.ts asc, first_mark.market_sequence asc limit 1),
              markets.current_metric
            )`.as("change_baseline"),
          ])
          .execute(),
        transaction
          .selectFrom(rankedMarks)
          .select([
            "ranked_marks.market_id as market_id",
            "ranked_marks.market_sequence as market_sequence",
            "ranked_marks.ts as ts",
            "ranked_marks.value as value",
          ])
          .where("ranked_marks.history_rank", "<=", historyLimit)
          .orderBy("ranked_marks.market_id", "asc")
          .orderBy("ranked_marks.ts", "asc")
          .orderBy("ranked_marks.market_sequence", "asc")
          .execute(),
      ]);

      const historyByMarket = new Map<string, HistoryRow[]>();
      for (const row of unorderedHistoryRows) {
        const marketHistory = historyByMarket.get(row.market_id);
        if (marketHistory === undefined) {
          historyByMarket.set(row.market_id, [row]);
        } else {
          marketHistory.push(row);
        }
      }
      for (const history of historyByMarket.values()) {
        history.sort(
          (left, right) =>
            left.ts.getTime() - right.ts.getTime() ||
            compareSequences(left.market_sequence, right.market_sequence),
        );
      }

      const markets = marketRows.map((row): MarketListItem => {
        if (
          !Number.isFinite(row.outstanding_claims) ||
          row.outstanding_claims < 0 ||
          !Number.isFinite(row.change_baseline)
        ) {
          throw new ServiceError("INVALID_INPUT", "Stored market summary is invalid.");
        }
        const history = historyByMarket.get(row.market_id) ?? [];
        return {
          marketId: row.market_id,
          company: {
            name: row.company_name,
            slug: row.company_slug,
            logoPath: row.company_logo_path,
          },
          status: row.status,
          metric: {
            kind: row.metric_kind,
            label: row.metric_kind === "valuation_median" ? "Implied valuation" : "YES probability",
            format: row.metric_kind === "valuation_median" ? "usd" : "probability",
            current: row.current_metric,
            change24Hours: row.current_metric - row.change_baseline,
          },
          anchor:
            row.metric_kind === "valuation_median"
              ? {
                  valuationUsd: row.anchor_valuation!,
                  date: row.anchor_date!,
                  description: row.anchor_description!,
                }
              : null,
          history: history.map((point) => ({
            timestamp: point.ts.toISOString(),
            marketSequence: point.market_sequence,
            value: point.value,
          })),
          outstandingClaims: row.outstanding_claims,
          sequence: row.last_market_sequence,
          createdAt: row.created_at.toISOString(),
          settledAt: row.settled_at?.toISOString() ?? null,
        };
      });

      markets.sort((left, right) => {
        if (left.status !== right.status) {
          return left.status === "open" ? -1 : 1;
        }
        if (left.status === "open") {
          const claimOrder = right.outstandingClaims - left.outstandingClaims;
          if (claimOrder !== 0) {
            return claimOrder;
          }
        } else {
          const settledOrder =
            Date.parse(right.settledAt ?? right.createdAt) -
            Date.parse(left.settledAt ?? left.createdAt);
          if (settledOrder !== 0) {
            return settledOrder;
          }
        }
        const slugOrder = left.company.slug.localeCompare(right.company.slug);
        return slugOrder !== 0 ? slugOrder : left.marketId.localeCompare(right.marketId);
      });

      return { markets, asOf: now.toISOString() };
    });
}
