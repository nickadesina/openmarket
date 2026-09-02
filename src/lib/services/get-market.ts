import { type Kysely, sql } from "kysely";

import { ServiceError } from "../api/errors.js";
import type {
  ContractSide,
  Database,
  MarketStatus,
  MetricKind,
  TradeAction,
} from "../db/schema.js";
import {
  VALUATION_BOUNDARIES_USD,
  VALUATION_BUCKET_COUNT,
  VALUATION_GRID_VERSION,
} from "../engine/buckets.js";
import { probabilities } from "../engine/lmsr.js";
import { calculateTimeWeightedAverage } from "../engine/twap.js";
import type { OrderedMark } from "../engine/types.js";

export interface GetMarketOptions {
  readonly now?: Date;
  readonly activityLimit?: number;
}

export interface MarketContract {
  readonly strikeIndex: number;
  readonly strikeValueUsd: string | null;
  readonly yesProbability: number;
  readonly noProbability: number;
}

export interface MarketActivitySummary {
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

export interface MarketDetail {
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
    readonly mark60Minutes: number;
  };
  readonly anchor: {
    readonly valuationUsd: string;
    readonly date: string;
    readonly description: string;
  } | null;
  readonly bucketGridVersion: string;
  readonly pmf: number[];
  readonly contracts: MarketContract[];
  readonly outstandingClaims: number;
  readonly sequence: string;
  readonly recentActivity: MarketActivitySummary[];
  readonly settlement: {
    readonly settledValueUsd: string;
    readonly winningBucket: number;
    readonly sourceUrl: string;
    readonly sourceDescription: string | null;
    readonly timestamp: string;
  } | null;
  readonly createdAt: string;
  readonly settledAt: string | null;
}

interface MarkRow {
  readonly market_sequence: string;
  readonly ts: Date;
  readonly value: number;
}

const DEFAULT_ACTIVITY_LIMIT = 20;
const MAX_ACTIVITY_LIMIT = 100;
const TWAP_WINDOW_MS = 60 * 60 * 1_000;
const CHANGE_WINDOW_MS = 24 * 60 * 60 * 1_000;

function normalizeOptions(options: GetMarketOptions): {
  readonly now: Date;
  readonly activityLimit: number;
} {
  const now = options.now === undefined ? new Date() : new Date(options.now.getTime());
  if (!Number.isFinite(now.getTime())) {
    throw new ServiceError("INVALID_INPUT", "Read clock must be a valid date.");
  }
  const activityLimit = options.activityLimit ?? DEFAULT_ACTIVITY_LIMIT;
  if (
    !Number.isSafeInteger(activityLimit) ||
    activityLimit < 1 ||
    activityLimit > MAX_ACTIVITY_LIMIT
  ) {
    throw new ServiceError(
      "INVALID_INPUT",
      `activityLimit must be an integer from 1 through ${MAX_ACTIVITY_LIMIT}.`,
    );
  }
  return { now, activityLimit };
}

function orderedMark(row: MarkRow): OrderedMark {
  if (!/^\d+$/.test(row.market_sequence)) {
    throw new ServiceError("INVALID_INPUT", "Stored mark sequence is invalid.");
  }
  const marketSequence = Number(row.market_sequence);
  if (!Number.isSafeInteger(marketSequence)) {
    throw new ServiceError("INVALID_INPUT", "Stored mark sequence is too large.");
  }
  return {
    marketSequence,
    timestamp: new Date(row.ts.getTime()),
    value: row.value,
  };
}

function buildContracts(
  metricKind: MetricKind,
  bucketGridVersion: string,
  bucketCount: number,
  pmf: readonly number[],
): MarketContract[] {
  if (metricKind === "yes_probability") {
    if (bucketGridVersion !== "binary-v1" || bucketCount !== 2) {
      throw new ServiceError("INVALID_INPUT", "Stored binary market shape is invalid.");
    }
    return [
      {
        strikeIndex: 0,
        strikeValueUsd: null,
        yesProbability: pmf[1]!,
        noProbability: pmf[0]!,
      },
    ];
  }
  if (bucketGridVersion !== VALUATION_GRID_VERSION || bucketCount !== VALUATION_BUCKET_COUNT) {
    throw new ServiceError("INVALID_INPUT", "Stored valuation market shape is invalid.");
  }

  const contracts = new Array<MarketContract>(VALUATION_BOUNDARIES_USD.length);
  let noProbability = 0;
  for (let strikeIndex = 0; strikeIndex < contracts.length; strikeIndex += 1) {
    noProbability += pmf[strikeIndex]!;
    const boundedNoProbability = Math.min(1, Math.max(0, noProbability));
    contracts[strikeIndex] = {
      strikeIndex,
      strikeValueUsd: VALUATION_BOUNDARIES_USD[strikeIndex]!.toFixed(2),
      yesProbability: 1 - boundedNoProbability,
      noProbability: boundedNoProbability,
    };
  }
  return contracts;
}

export async function getMarket(
  db: Kysely<Database>,
  slug: string,
  options: GetMarketOptions = {},
): Promise<MarketDetail> {
  const { now, activityLimit } = normalizeOptions(options);
  const twapStart = new Date(now.getTime() - TWAP_WINDOW_MS);

  return db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(async (transaction) => {
      const market = await transaction
        .selectFrom("markets")
        .innerJoin("companies", "companies.id", "markets.company_id")
        .select([
          "markets.id as market_id",
          "markets.status as status",
          "markets.n_buckets as n_buckets",
          "markets.bucket_grid_version as bucket_grid_version",
          "markets.metric_kind as metric_kind",
          "markets.anchor_valuation as anchor_valuation",
          "markets.anchor_date as anchor_date",
          "markets.anchor_description as anchor_description",
          "markets.b as b",
          "markets.q as q",
          "markets.current_metric as current_metric",
          "markets.last_market_sequence as last_market_sequence",
          "markets.created_at as created_at",
          "markets.settled_at as settled_at",
          "companies.name as company_name",
          "companies.slug as company_slug",
          "companies.logo_path as company_logo_path",
        ])
        .where("companies.slug", "=", slug)
        .orderBy("markets.status", "asc")
        .orderBy("markets.created_at", "desc")
        .orderBy("markets.id", "desc")
        .executeTakeFirst();

      if (market === undefined) {
        throw new ServiceError("MARKET_NOT_FOUND", "Market was not found.");
      }
      if (market.q.length !== market.n_buckets) {
        throw new ServiceError("INVALID_INPUT", "Stored market state has invalid length.");
      }

      const changeCutoff = new Date(now.getTime() - CHANGE_WINDOW_MS);
      const [claimsRow, changeRow, priorMark, markRows, activityRows, settlement] =
        await Promise.all([
          transaction
            .selectNoFrom(
              sql<number>`coalesce((select sum(bucket_quantity) from holdings as claim_holding cross join lateral unnest(claim_holding.h) as bucket(bucket_quantity) where claim_holding.market_id = ${market.market_id}), 0)`.as(
                "outstanding_claims",
              ),
            )
            .executeTakeFirstOrThrow(),
          transaction
            .selectNoFrom(
              sql<number>`coalesce(
                (select value from marks as prior_mark where prior_mark.market_id = ${market.market_id} and prior_mark.ts <= ${changeCutoff} order by prior_mark.ts desc, prior_mark.market_sequence desc limit 1),
                (select value from marks as first_mark where first_mark.market_id = ${market.market_id} and first_mark.ts <= ${now} order by first_mark.ts asc, first_mark.market_sequence asc limit 1),
                ${market.current_metric}::double precision
              )`.as("change_baseline"),
            )
            .executeTakeFirstOrThrow(),
          transaction
            .selectFrom("marks")
            .select(["market_sequence", "ts", "value"])
            .where("market_id", "=", market.market_id)
            .where("ts", "<=", twapStart)
            .orderBy("ts", "desc")
            .orderBy("market_sequence", "desc")
            .executeTakeFirst(),
          transaction
            .selectFrom("marks")
            .select(["market_sequence", "ts", "value"])
            .where("market_id", "=", market.market_id)
            .where("ts", ">=", twapStart)
            .where("ts", "<=", now)
            .orderBy("ts", "asc")
            .orderBy("market_sequence", "asc")
            .execute(),
          transaction
            .selectFrom("trades")
            .select([
              "market_sequence",
              "action",
              "contract_side",
              "strike_index",
              "strike_value",
              "quantity",
              "cash_amount_cents",
              "metric_before",
              "metric_after",
              "created_at",
            ])
            .where("market_id", "=", market.market_id)
            .orderBy("created_at", "desc")
            .orderBy("market_sequence", "desc")
            .orderBy("id", "desc")
            .limit(activityLimit)
            .execute(),
          transaction
            .selectFrom("settlements")
            .select(["settled_value", "winning_bucket", "source_url", "source_description", "ts"])
            .where("market_id", "=", market.market_id)
            .executeTakeFirst(),
        ]);

      const pmf = probabilities(market.q, market.b);
      const contracts = buildContracts(
        market.metric_kind,
        market.bucket_grid_version,
        market.n_buckets,
        pmf,
      );
      const mark60Minutes = calculateTimeWeightedAverage({
        priorMark: priorMark === undefined ? null : orderedMark(priorMark),
        marks: markRows.map(orderedMark),
        currentMetric: market.current_metric,
        now,
      });
      const anchor =
        market.metric_kind === "valuation_median"
          ? {
              valuationUsd: market.anchor_valuation!,
              date: market.anchor_date!,
              description: market.anchor_description!,
            }
          : null;

      return {
        marketId: market.market_id,
        company: {
          name: market.company_name,
          slug: market.company_slug,
          logoPath: market.company_logo_path,
        },
        status: market.status,
        metric: {
          kind: market.metric_kind,
          label:
            market.metric_kind === "valuation_median" ? "Implied valuation" : "YES probability",
          format: market.metric_kind === "valuation_median" ? "usd" : "probability",
          current: market.current_metric,
          change24Hours: Number.isFinite(changeRow.change_baseline)
            ? market.current_metric - changeRow.change_baseline
            : 0,
          mark60Minutes,
        },
        anchor,
        bucketGridVersion: market.bucket_grid_version,
        pmf,
        contracts,
        outstandingClaims: claimsRow.outstanding_claims,
        sequence: market.last_market_sequence,
        recentActivity: activityRows.map((row) => ({
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
        })),
        settlement:
          settlement === undefined
            ? null
            : {
                settledValueUsd: settlement.settled_value,
                winningBucket: settlement.winning_bucket,
                sourceUrl: settlement.source_url,
                sourceDescription: settlement.source_description,
                timestamp: settlement.ts.toISOString(),
              },
        createdAt: market.created_at.toISOString(),
        settledAt: market.settled_at?.toISOString() ?? null,
      };
    });
}
