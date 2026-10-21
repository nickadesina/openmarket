import type { Kysely, Transaction } from "kysely";

import { ServiceError } from "../api/errors.js";
import type {
  ClaimSide,
  ContractSide,
  Database,
  ForwardSide,
  InstrumentState,
  MarketStatus,
  MetricKind,
  TradeAction,
} from "../db/schema.js";
import { settlementCreditCents } from "../engine/dealer/forward.js";
import { probabilities } from "../engine/lmsr.js";
import { EPS } from "../engine/types.js";
import { latestMid } from "./dealer/dealer-books.js";
import { identitiesFor } from "./tournament/identities.js";
import type { PublicIdentity } from "./tournament/records.js";

/**
 * `GET /api/portfolio`: the signed-in paper account's cash, its binary
 * holdings marked at the book's YES price, its open forward positions marked
 * at the latest model mid, and its trade history. A forward is held to
 * settlement or void (README D11); its marked value is what settlement would
 * credit at the mid now: collateral plus N·clip(mid − F₀, ±κ), quantized as
 * settlement quantizes it.
 */

export const PORTFOLIO_DEFAULT_TRADE_LIMIT = 25;
export const PORTFOLIO_MAX_TRADE_LIMIT = 100;

export interface PortfolioOptions {
  readonly offset?: number;
  readonly limit?: number;
  readonly now?: Date;
}

export interface PortfolioCompany {
  readonly name: string;
  readonly slug: string;
  readonly logoPath: string;
}

export interface PortfolioBinaryPosition {
  readonly side: ClaimSide;
  readonly quantity: number;
  /** The side's price now: YES or NO probability on the book. */
  readonly markPriceUsd: number;
  readonly markedValueUsd: number;
  readonly sellableQuantity: number;
  readonly approximateCostBasis: PortfolioCostBasis | null;
}

export interface PortfolioCostBasis {
  readonly side: ClaimSide;
  readonly netQuantity: number;
  /** Buys minus sell proceeds. Full-set redemptions make this approximate. */
  readonly approximateNetCostCents: string;
  readonly approximateAveragePriceUsd: number | null;
}

/** One binary book the account holds shares in. */
export interface PortfolioMarket {
  readonly marketId: string;
  readonly instrumentId: string | null;
  readonly company: PortfolioCompany;
  readonly status: MarketStatus;
  readonly question: string | null;
  readonly expiresAt: string | null;
  readonly yesProbability: number;
  readonly holdingsMarkedValueUsd: number;
  readonly positions: PortfolioBinaryPosition[];
}

export interface PortfolioForwardPosition {
  readonly positionId: string;
  readonly instrumentId: string;
  readonly marketId: string;
  readonly company: PortfolioCompany;
  readonly question: string;
  readonly state: InstrumentState;
  readonly side: ForwardSide;
  readonly notionalCents: string;
  /** F₀, ln USD and USD. */
  readonly entryLn: number;
  readonly entryUsd: number;
  /** The latest model mid, ln USD and USD. */
  readonly midLn: number;
  readonly midUsd: number;
  /** N·κ, posted at open: the most the position can lose, and the most it can gain. */
  readonly collateralCents: string;
  readonly maxLossCents: string;
  readonly maxGainCents: string;
  /** Settlement credit at the mid minus collateral; signed cents. */
  readonly unrealisedCents: string;
  /** Settlement credit at the mid: collateral plus unrealised. */
  readonly markedValueCents: string;
  readonly openedAt: string;
  readonly expiresAt: string;
}

export interface PortfolioTrade {
  readonly id: string;
  readonly marketId: string;
  readonly company: { readonly name: string; readonly slug: string };
  readonly metricKind: MetricKind;
  readonly marketSequence: string;
  readonly action: TradeAction;
  readonly side: ContractSide;
  /** Binary shares, or a forward's notional in dollars. */
  readonly quantity: number;
  /** Binary cost or proceeds; a forward's collateral. */
  readonly cashAmountCents: string;
  readonly redemptionQuantity: number;
  readonly redemptionCents: string;
  /** A forward's F₀ in USD; null for a binary. */
  readonly entryUsd: number | null;
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
  /** The tournament identity that owns this paper account. */
  readonly identity: PublicIdentity;
  readonly cashBalanceCents: string;
  readonly holdingsMarkedValueUsd: number;
  readonly forwardPositions: PortfolioForwardPosition[];
  /** Σ collateral of open forward positions. */
  readonly forwardCollateralCents: string;
  /** Σ unrealised of open forward positions, signed. */
  readonly forwardUnrealisedCents: string;
  /** Cash + binary holdings mark + open forwards' marked value (collateral + unrealised). */
  readonly accountValueUsd: number;
  readonly markets: PortfolioMarket[];
  readonly tradeHistory: PortfolioTradePage;
  readonly asOf: string;
}

interface CostBasisTrade {
  readonly market_id: string;
  readonly action: TradeAction;
  readonly contract_side: ContractSide;
  readonly quantity: number;
  readonly cash_amount_cents: string;
}

/**
 * A binary holding [NO, YES] marked at the book's probabilities. A full set
 * redeems at trade time, so at most one side is normally held.
 */
export function calculateBinaryExposure(
  holdings: readonly number[],
  marketQ: readonly number[],
  b: number,
): {
  readonly yesProbability: number;
  readonly holdingsMarkedValueUsd: number;
  readonly positions: Omit<PortfolioBinaryPosition, "approximateCostBasis">[];
} {
  if (holdings.length !== 2 || marketQ.length !== 2) {
    throw new RangeError("a binary holding and its book have two outcomes");
  }
  const [noProbability, yesProbability] = probabilities(marketQ, b) as [number, number];
  const positions: Omit<PortfolioBinaryPosition, "approximateCostBasis">[] = [];
  let holdingsMarkedValueUsd = 0;
  for (const [side, index, price] of [
    ["yes", 1, yesProbability],
    ["no", 0, noProbability],
  ] as const) {
    const quantity = holdings[index]!;
    if (!Number.isFinite(quantity) || quantity < -EPS) {
      throw new RangeError("holdings must contain finite, non-negative values");
    }
    if (quantity <= EPS) continue;
    holdingsMarkedValueUsd += quantity * price;
    positions.push({
      side,
      quantity,
      markPriceUsd: price,
      markedValueUsd: quantity * price,
      sellableQuantity: quantity,
    });
  }
  return { yesProbability, holdingsMarkedValueUsd, positions };
}

function normalizeOptions(options: PortfolioOptions): {
  readonly offset: number;
  readonly limit: number;
  readonly now: Date;
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
  const now = options.now === undefined ? new Date() : new Date(options.now.getTime());
  if (!Number.isFinite(now.getTime())) {
    throw new ServiceError("INVALID_INPUT", "Read clock must be a valid date.");
  }
  return { offset, limit, now };
}

function groupCostBasis(trades: readonly CostBasisTrade[]): Map<string, PortfolioCostBasis> {
  const groups = new Map<
    string,
    { side: ClaimSide; netQuantity: number; netCostCents: bigint }
  >();
  for (const trade of trades) {
    if (trade.contract_side !== "yes" && trade.contract_side !== "no") continue;
    const key = `${trade.market_id}:${trade.contract_side}`;
    const group = groups.get(key) ?? {
      side: trade.contract_side,
      netQuantity: 0,
      netCostCents: 0n,
    };
    groups.set(key, group);
    const direction = trade.action === "buy" ? 1 : -1;
    group.netQuantity += direction * trade.quantity;
    group.netCostCents += BigInt(trade.cash_amount_cents) * BigInt(direction);
  }
  return new Map(
    [...groups].map(([key, group]) => [
      key,
      {
        side: group.side,
        netQuantity: group.netQuantity,
        approximateNetCostCents: group.netCostCents.toString(),
        approximateAveragePriceUsd:
          Math.abs(group.netQuantity) > EPS
            ? Number(group.netCostCents) / 100 / group.netQuantity
            : null,
      },
    ]),
  );
}


async function forwardPositionsOf(
  transaction: Transaction<Database>,
  userId: string,
  now: Date,
): Promise<PortfolioForwardPosition[]> {
  const rows = await transaction
    .selectFrom("forward_positions")
    .innerJoin("instruments", "instruments.id", "forward_positions.instrument_id")
    .innerJoin("listings", "listings.id", "instruments.listing_id")
    .innerJoin("companies", "companies.id", "listings.company_id")
    .innerJoin("markets", "markets.instrument_id", "instruments.id")
    .select([
      "forward_positions.id as position_id",
      "forward_positions.instrument_id",
      "forward_positions.side",
      "forward_positions.notional_cents",
      "forward_positions.entry_ln",
      "forward_positions.collateral_cents",
      "forward_positions.opened_at",
      "instruments.question",
      "instruments.state",
      "instruments.expires_at",
      "listings.kappa",
      "markets.id as market_id",
      "companies.name as company_name",
      "companies.slug as company_slug",
      "companies.logo_path as company_logo_path",
    ])
    .where("forward_positions.user_id", "=", userId)
    .where("forward_positions.settled_at", "is", null)
    .where("forward_positions.voided_at", "is", null)
    .orderBy("forward_positions.opened_at", "desc")
    .orderBy("forward_positions.id", "desc")
    .execute();

  const positions: PortfolioForwardPosition[] = [];
  for (const row of rows) {
    const mid = await latestMid(transaction, row.instrument_id, now);
    const midLn = mid?.mid_ln ?? row.entry_ln;
    const notionalCents = Number(row.notional_cents);
    const credit = settlementCreditCents(
      { side: row.side, notionalCents, entryLn: row.entry_ln, kappa: row.kappa },
      midLn,
    );
    const collateral = BigInt(row.collateral_cents);
    positions.push({
      positionId: row.position_id,
      instrumentId: row.instrument_id,
      marketId: row.market_id,
      company: {
        name: row.company_name,
        slug: row.company_slug,
        logoPath: row.company_logo_path,
      },
      question: row.question,
      state: row.state,
      side: row.side,
      notionalCents: row.notional_cents,
      entryLn: row.entry_ln,
      entryUsd: Math.exp(row.entry_ln),
      midLn,
      midUsd: Math.exp(midLn),
      collateralCents: row.collateral_cents,
      maxLossCents: row.collateral_cents,
      maxGainCents: row.collateral_cents,
      unrealisedCents: (BigInt(credit) - collateral).toString(),
      markedValueCents: String(credit),
      openedAt: row.opened_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    });
  }
  return positions;
}

export async function getPortfolio(
  db: Kysely<Database>,
  userId: string,
  options: PortfolioOptions = {},
): Promise<Portfolio> {
  const { offset, limit, now } = normalizeOptions(options);

  return db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(async (transaction) => {
      const user = await transaction
        .selectFrom("users")
        .select(["id", "tournament_user_id", "cash_balance_cents"])
        .where("id", "=", userId)
        .executeTakeFirst();
      if (user === undefined) {
        throw new ServiceError("USER_REQUIRED", "A valid user is required.");
      }
      const identity = (await identitiesFor(transaction, [user.tournament_user_id])).get(
        user.tournament_user_id,
      );
      if (identity === undefined) {
        throw new ServiceError("USER_REQUIRED", "A valid user is required.");
      }

      const [holdingRows, costBasisTrades, historyRows, forwardPositions] = await Promise.all([
        transaction
          .selectFrom("holdings")
          .innerJoin("markets", "markets.id", "holdings.market_id")
          .innerJoin("companies", "companies.id", "markets.company_id")
          .leftJoin("instruments", "instruments.id", "markets.instrument_id")
          .select([
            "holdings.market_id as market_id",
            "holdings.h as h",
            "markets.metric_kind as metric_kind",
            "markets.q as q",
            "markets.b as b",
            "markets.status as market_status",
            "markets.instrument_id as instrument_id",
            "instruments.question as question",
            "instruments.expires_at as expires_at",
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
          .select(["market_id", "action", "contract_side", "quantity", "cash_amount_cents"])
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
            "trades.quantity as quantity",
            "trades.cash_amount_cents as cash_amount_cents",
            "trades.redemption_quantity as redemption_quantity",
            "trades.redemption_cents as redemption_cents",
            "trades.execution_result as execution_result",
            "trades.created_at as created_at",
            "markets.metric_kind as metric_kind",
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
        forwardPositionsOf(transaction, userId, now),
      ]);

      const costBasis = groupCostBasis(costBasisTrades);
      let holdingsMarkedValueUsd = 0;
      const markets: PortfolioMarket[] = [];
      for (const row of holdingRows) {
        if (row.metric_kind !== "yes_probability") continue;
        const exposure = calculateBinaryExposure(row.h, row.q, row.b);
        if (exposure.positions.length === 0) continue;
        holdingsMarkedValueUsd += exposure.holdingsMarkedValueUsd;
        markets.push({
          marketId: row.market_id,
          instrumentId: row.instrument_id,
          company: {
            name: row.company_name,
            slug: row.company_slug,
            logoPath: row.company_logo_path,
          },
          status: row.market_status,
          question: row.question,
          expiresAt: row.expires_at?.toISOString() ?? null,
          yesProbability: exposure.yesProbability,
          holdingsMarkedValueUsd: exposure.holdingsMarkedValueUsd,
          positions: exposure.positions.map((position) => ({
            ...position,
            approximateCostBasis: costBasis.get(`${row.market_id}:${position.side}`) ?? null,
          })),
        });
      }

      const hasMore = historyRows.length > limit;
      const pageRows = hasMore ? historyRows.slice(0, limit) : historyRows;
      const items = pageRows.map((row): PortfolioTrade => {
        const result = row.execution_result;
        const entryUsd =
          row.metric_kind === "forward_ln" &&
          result !== null &&
          typeof result === "object" &&
          !Array.isArray(result) &&
          typeof result.entry_usd === "number"
            ? result.entry_usd
            : null;
        return {
          id: row.id,
          marketId: row.market_id,
          company: { name: row.company_name, slug: row.company_slug },
          metricKind: row.metric_kind,
          marketSequence: row.market_sequence,
          action: row.action,
          side: row.contract_side,
          quantity: row.quantity,
          cashAmountCents: row.cash_amount_cents,
          redemptionQuantity: row.redemption_quantity,
          redemptionCents: row.redemption_cents,
          entryUsd,
          createdAt: row.created_at.toISOString(),
        };
      });

      let forwardCollateral = 0n;
      let forwardUnrealised = 0n;
      let forwardMarked = 0n;
      for (const position of forwardPositions) {
        forwardCollateral += BigInt(position.collateralCents);
        forwardUnrealised += BigInt(position.unrealisedCents);
        forwardMarked += BigInt(position.markedValueCents);
      }

      return {
        userId: user.id,
        identity,
        cashBalanceCents: user.cash_balance_cents,
        holdingsMarkedValueUsd,
        forwardPositions,
        forwardCollateralCents: forwardCollateral.toString(),
        forwardUnrealisedCents: forwardUnrealised.toString(),
        accountValueUsd:
          Number(user.cash_balance_cents) / 100 +
          holdingsMarkedValueUsd +
          Number(forwardMarked) / 100,
        markets,
        tradeHistory: { items, offset, limit, nextOffset: hasMore ? offset + limit : null },
        asOf: now.toISOString(),
      };
    });
}
