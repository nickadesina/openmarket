import type { Kysely } from "kysely";

import { ServiceError } from "../api/errors.js";
import type {
  ContractSide,
  Database,
  MarketStatus,
  MetricKind,
  TradeAction,
} from "../db/schema.js";
import { VALUATION_BOUNDARIES_USD, VALUATION_BUCKET_COUNT } from "../engine/buckets.js";
import { contractMask, sellableQuantity } from "../engine/contracts.js";
import { decomposeHoldings } from "../engine/decomposition.js";
import { probabilities } from "../engine/lmsr.js";
import { EPS } from "../engine/types.js";

export const PORTFOLIO_DEFAULT_TRADE_LIMIT = 25;
export const PORTFOLIO_MAX_TRADE_LIMIT = 100;

export interface PortfolioOptions {
  readonly offset?: number;
  readonly limit?: number;
}

export interface PortfolioExposurePosition {
  readonly side: ContractSide;
  readonly strikeIndex: number;
  readonly quantity: number;
  readonly markPriceUsd: number;
  readonly markedValueUsd: number;
  readonly sellableQuantity: number;
}

export interface PortfolioResidualExposure {
  readonly buckets: number[];
  readonly markedValueUsd: number;
}

export interface PortfolioExposure {
  readonly probabilities: number[];
  readonly holdingsMarkedValueUsd: number;
  readonly positions: PortfolioExposurePosition[];
  readonly residualExposure: PortfolioResidualExposure;
}

export interface PortfolioCostBasis {
  readonly side: ContractSide;
  readonly strikeIndex: number;
  readonly strikeValueUsd: string | null;
  readonly netQuantity: number;
  /** Buys minus sell proceeds. Redemptions and cross-strike attribution make this approximate. */
  readonly approximateNetCostCents: string;
  readonly approximateAveragePriceUsd: number | null;
}

export interface PortfolioPosition extends PortfolioExposurePosition {
  readonly strikeValueUsd: string | null;
  readonly approximateCostBasis: PortfolioCostBasis | null;
}

export interface PortfolioMarket {
  readonly marketId: string;
  readonly company: {
    readonly name: string;
    readonly slug: string;
    readonly logoPath: string;
  };
  readonly status: MarketStatus;
  readonly metricKind: MetricKind;
  readonly probabilities: number[];
  readonly holdingsMarkedValueUsd: number;
  readonly positions: PortfolioPosition[];
  readonly residualExposure: PortfolioResidualExposure;
  readonly costBasis: PortfolioCostBasis[];
}

export interface PortfolioTrade {
  readonly id: string;
  readonly marketId: string;
  readonly company: {
    readonly name: string;
    readonly slug: string;
  };
  readonly marketSequence: string;
  readonly action: TradeAction;
  readonly side: ContractSide;
  readonly strikeIndex: number;
  readonly strikeValueUsd: string | null;
  readonly quantity: number;
  readonly requestedSpendCents: string | null;
  readonly engineCostUsd: number;
  readonly cashAmountCents: string;
  readonly redemptionQuantity: number;
  readonly redemptionCents: string;
  readonly metricBefore: number;
  readonly metricAfter: number;
  readonly createdAt: string;
}

export interface PortfolioTradePage {
  readonly items: PortfolioTrade[];
  readonly offset: number;
  readonly limit: number;
  readonly nextOffset: number | null;
}

export interface Portfolio {
  readonly userId: string;
  readonly username: string;
  readonly cashBalanceCents: string;
  readonly holdingsMarkedValueUsd: number;
  readonly accountValueUsd: number;
  readonly markets: PortfolioMarket[];
  readonly tradeHistory: PortfolioTradePage;
}

interface CostBasisTrade {
  readonly market_id: string;
  readonly action: TradeAction;
  readonly contract_side: ContractSide;
  readonly strike_index: number;
  readonly quantity: number;
  readonly cash_amount_cents: string;
}

interface MutableCostBasis {
  readonly marketId: string;
  readonly side: ContractSide;
  readonly strikeIndex: number;
  netQuantity: number;
  netCostCents: bigint;
}

/**
 * Marks and deterministically decomposes one canonical holdings vector.
 * Every returned array is newly allocated; the supplied market and holdings vectors are untouched.
 */
export function calculatePortfolioExposure(
  holdings: readonly number[],
  marketQ: readonly number[],
  b: number,
): PortfolioExposure {
  if (holdings.length !== marketQ.length) {
    throw new RangeError("holdings and market q must have equal lengths");
  }

  const currentProbabilities = probabilities(marketQ, b);
  const normalizedHoldings = new Array<number>(holdings.length);
  let holdingsMarkedValueUsd = 0;
  for (let bucket = 0; bucket < holdings.length; bucket += 1) {
    const quantity = holdings[bucket];
    if (quantity === undefined || !Number.isFinite(quantity) || quantity < -EPS) {
      throw new RangeError("holdings must contain finite, non-negative values");
    }
    const normalizedQuantity = quantity > EPS ? quantity : 0;
    normalizedHoldings[bucket] = normalizedQuantity;
    holdingsMarkedValueUsd += normalizedQuantity * currentProbabilities[bucket]!;
  }

  const decomposition = decomposeHoldings(normalizedHoldings);
  const positions = decomposition.positions.map((position) => {
    const mask = contractMask(holdings.length, position.strikeIndex, position.side);
    let markPriceUsd = 0;
    for (let bucket = 0; bucket < mask.length; bucket += 1) {
      if (mask[bucket]) {
        markPriceUsd += currentProbabilities[bucket]!;
      }
    }

    return {
      ...position,
      markPriceUsd,
      markedValueUsd: position.quantity * markPriceUsd,
      sellableQuantity: sellableQuantity(normalizedHoldings, mask),
    };
  });

  let residualMarkedValueUsd = 0;
  for (let bucket = 0; bucket < decomposition.residual.length; bucket += 1) {
    residualMarkedValueUsd += decomposition.residual[bucket]! * currentProbabilities[bucket]!;
  }

  return {
    probabilities: currentProbabilities,
    holdingsMarkedValueUsd,
    positions,
    residualExposure: {
      buckets: decomposition.residual,
      markedValueUsd: residualMarkedValueUsd,
    },
  };
}

export async function getPortfolio(
  db: Kysely<Database>,
  userId: string,
  options: PortfolioOptions = {},
): Promise<Portfolio> {
  const { offset, limit } = normalizeOptions(options);

  return db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(async (transaction) => {
      const user = await transaction
        .selectFrom("users")
        .select(["id", "username", "cash_balance_cents"])
        .where("id", "=", userId)
        .executeTakeFirst();

      if (user === undefined) {
        throw new ServiceError("USER_REQUIRED", "A valid user is required.");
      }

      const [holdingRows, costBasisTrades, historyRows] = await Promise.all([
        transaction
          .selectFrom("holdings")
          .innerJoin("markets", "markets.id", "holdings.market_id")
          .innerJoin("companies", "companies.id", "markets.company_id")
          .select([
            "holdings.market_id as market_id",
            "holdings.h as h",
            "markets.n_buckets as n_buckets",
            "markets.bucket_grid_version as bucket_grid_version",
            "markets.metric_kind as metric_kind",
            "markets.q as q",
            "markets.b as b",
            "markets.status as market_status",
            "companies.name as company_name",
            "companies.slug as company_slug",
            "companies.logo_path as company_logo_path",
          ])
          .where("holdings.user_id", "=", userId)
          .orderBy("companies.slug", "asc")
          .orderBy("markets.id", "asc")
          .execute(),
        transaction
          .selectFrom("trades")
          .select([
            "market_id",
            "action",
            "contract_side",
            "strike_index",
            "quantity",
            "cash_amount_cents",
          ])
          .where("user_id", "=", userId)
          .execute(),
        transaction
          .selectFrom("trades")
          .innerJoin("markets", "markets.id", "trades.market_id")
          .innerJoin("companies", "companies.id", "markets.company_id")
          .select([
            "trades.id as id",
            "trades.market_id as market_id",
            "trades.market_sequence as market_sequence",
            "trades.action as action",
            "trades.contract_side as contract_side",
            "trades.strike_index as strike_index",
            "trades.strike_value as strike_value",
            "trades.quantity as quantity",
            "trades.requested_spend_cents as requested_spend_cents",
            "trades.engine_cost_usd as engine_cost_usd",
            "trades.cash_amount_cents as cash_amount_cents",
            "trades.redemption_quantity as redemption_quantity",
            "trades.redemption_cents as redemption_cents",
            "trades.metric_before as metric_before",
            "trades.metric_after as metric_after",
            "trades.created_at as created_at",
            "companies.name as company_name",
            "companies.slug as company_slug",
          ])
          .where("trades.user_id", "=", userId)
          .orderBy("trades.created_at", "desc")
          .orderBy("trades.market_sequence", "desc")
          .orderBy("trades.id", "desc")
          .offset(offset)
          .limit(limit + 1)
          .execute(),
      ]);

      const groupedCostBasis = groupCostBasis(costBasisTrades);
      let holdingsMarkedValueUsd = 0;
      const markets = holdingRows.map((row): PortfolioMarket => {
        assertMarketShape(row.metric_kind, row.bucket_grid_version, row.n_buckets, row.h, row.q);
        const exposure = calculatePortfolioExposure(row.h, row.q, row.b);
        const marketCostBasis = (groupedCostBasis.get(row.market_id) ?? []).map(
          (basis): PortfolioCostBasis => ({
            ...basis,
            strikeValueUsd: strikeValue(row.metric_kind, basis.strikeIndex),
          }),
        );
        const costBasisByContract = new Map(
          marketCostBasis.map((basis) => [contractKey(basis.side, basis.strikeIndex), basis]),
        );
        holdingsMarkedValueUsd += exposure.holdingsMarkedValueUsd;

        return {
          marketId: row.market_id,
          company: {
            name: row.company_name,
            slug: row.company_slug,
            logoPath: row.company_logo_path,
          },
          status: row.market_status,
          metricKind: row.metric_kind,
          probabilities: exposure.probabilities,
          holdingsMarkedValueUsd: exposure.holdingsMarkedValueUsd,
          positions: exposure.positions.map((position) => ({
            ...position,
            strikeValueUsd: strikeValue(row.metric_kind, position.strikeIndex),
            approximateCostBasis:
              costBasisByContract.get(contractKey(position.side, position.strikeIndex)) ?? null,
          })),
          residualExposure: exposure.residualExposure,
          costBasis: marketCostBasis,
        };
      });

      const hasMore = historyRows.length > limit;
      const pageRows = hasMore ? historyRows.slice(0, limit) : historyRows;
      const items = pageRows.map(
        (row): PortfolioTrade => ({
          id: row.id,
          marketId: row.market_id,
          company: { name: row.company_name, slug: row.company_slug },
          marketSequence: row.market_sequence,
          action: row.action,
          side: row.contract_side,
          strikeIndex: row.strike_index,
          strikeValueUsd: row.strike_value,
          quantity: row.quantity,
          requestedSpendCents: row.requested_spend_cents,
          engineCostUsd: row.engine_cost_usd,
          cashAmountCents: row.cash_amount_cents,
          redemptionQuantity: row.redemption_quantity,
          redemptionCents: row.redemption_cents,
          metricBefore: row.metric_before,
          metricAfter: row.metric_after,
          createdAt: row.created_at.toISOString(),
        }),
      );

      return {
        userId: user.id,
        username: user.username,
        cashBalanceCents: user.cash_balance_cents,
        holdingsMarkedValueUsd,
        accountValueUsd: Number(user.cash_balance_cents) / 100 + holdingsMarkedValueUsd,
        markets,
        tradeHistory: {
          items,
          offset,
          limit,
          nextOffset: hasMore ? offset + limit : null,
        },
      };
    });
}

function normalizeOptions(options: PortfolioOptions): {
  offset: number;
  limit: number;
} {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? PORTFOLIO_DEFAULT_TRADE_LIMIT;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new ServiceError(
      "INVALID_INPUT",
      "Portfolio trade offset must be a non-negative integer.",
    );
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > PORTFOLIO_MAX_TRADE_LIMIT) {
    throw new ServiceError(
      "INVALID_INPUT",
      `Portfolio trade limit must be from 1 to ${PORTFOLIO_MAX_TRADE_LIMIT}.`,
    );
  }
  return { offset, limit };
}

function assertMarketShape(
  metricKind: MetricKind,
  bucketGridVersion: string,
  bucketCount: number,
  holdings: readonly number[],
  marketQ: readonly number[],
): void {
  const expectedBucketCount = metricKind === "valuation_median" ? VALUATION_BUCKET_COUNT : 2;
  if (
    bucketCount !== expectedBucketCount ||
    holdings.length !== bucketCount ||
    marketQ.length !== bucketCount
  ) {
    throw new RangeError("portfolio market vectors do not match the market shape");
  }
  if (metricKind === "valuation_median" && bucketGridVersion !== "valuation-v1") {
    throw new RangeError("portfolio market uses an unsupported valuation grid");
  }
}

function groupCostBasis(trades: readonly CostBasisTrade[]): Map<string, PortfolioCostBasis[]> {
  const groups = new Map<string, MutableCostBasis>();
  for (const trade of trades) {
    const key = `${trade.market_id}:${contractKey(trade.contract_side, trade.strike_index)}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        marketId: trade.market_id,
        side: trade.contract_side,
        strikeIndex: trade.strike_index,
        netQuantity: 0,
        netCostCents: 0n,
      };
      groups.set(key, group);
    }
    const direction = trade.action === "buy" ? 1 : -1;
    group.netQuantity += direction * trade.quantity;
    group.netCostCents += BigInt(trade.cash_amount_cents) * BigInt(direction);
  }

  const byMarket = new Map<string, PortfolioCostBasis[]>();
  for (const group of groups.values()) {
    const basis: PortfolioCostBasis = {
      side: group.side,
      strikeIndex: group.strikeIndex,
      strikeValueUsd: null,
      netQuantity: group.netQuantity,
      approximateNetCostCents: group.netCostCents.toString(),
      approximateAveragePriceUsd:
        Math.abs(group.netQuantity) > EPS
          ? Number(group.netCostCents) / 100 / group.netQuantity
          : null,
    };
    const marketGroups = byMarket.get(group.marketId);
    if (marketGroups === undefined) {
      byMarket.set(group.marketId, [basis]);
    } else {
      marketGroups.push(basis);
    }
  }

  for (const marketGroups of byMarket.values()) {
    marketGroups.sort(
      (left, right) =>
        left.strikeIndex - right.strikeIndex ||
        (left.side === right.side ? 0 : left.side === "yes" ? -1 : 1),
    );
  }
  return byMarket;
}

function contractKey(side: ContractSide, strikeIndex: number): string {
  return `${side}:${strikeIndex}`;
}

function strikeValue(metricKind: MetricKind, strikeIndex: number): string | null {
  if (metricKind === "yes_probability") {
    return null;
  }
  const boundary = VALUATION_BOUNDARIES_USD[strikeIndex];
  if (boundary === undefined) {
    throw new RangeError("valuation strike index is outside the canonical grid");
  }
  return boundary.toString();
}
