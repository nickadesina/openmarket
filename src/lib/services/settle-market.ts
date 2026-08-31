import { sql, type Kysely } from "kysely";

import { ServiceError } from "../api/errors.js";
import { parseUsdToCents } from "../api/money.js";
import type { SettlementInput } from "../api/schemas.js";
import type { Database, MetricKind } from "../db/schema.js";
import { valuationBucketIndex } from "../engine/buckets.js";
import { quantizeEntitlementCents } from "../engine/lmsr.js";

export interface SettlementResult {
  readonly market_id: string;
  readonly slug: string;
  readonly settled_value_usd: string;
  readonly winning_bucket: number;
  readonly credited_users: number;
  readonly total_payout_cents: string;
  readonly rounding_reserve_delta_cents: string;
  readonly settled_at: string;
}

function winningBucket(
  metricKind: MetricKind,
  settledValueUsd: string,
): number {
  let settledValueCents: number;
  try {
    settledValueCents = parseUsdToCents(settledValueUsd);
  } catch {
    throw new ServiceError("INVALID_INPUT", "Settlement value is invalid.");
  }

  if (metricKind === "yes_probability") {
    if (settledValueCents !== 0 && settledValueCents !== 100) {
      throw new ServiceError(
        "INVALID_INPUT",
        "Binary settlement value must be 0 or 1.",
      );
    }
    return settledValueCents === 100 ? 1 : 0;
  }

  if (settledValueCents <= 0) {
    throw new ServiceError(
      "INVALID_INPUT",
      "Valuation settlement value must be positive.",
    );
  }

  return valuationBucketIndex(settledValueCents / 100);
}

export async function settleMarket(
  db: Kysely<Database>,
  input: SettlementInput,
): Promise<SettlementResult> {
  return db.transaction().execute(async (transaction) => {
    const market = await transaction
      .selectFrom("markets")
      .innerJoin("companies", "companies.id", "markets.company_id")
      .select([
        "markets.id as market_id",
        "markets.status",
        "markets.n_buckets",
        "markets.metric_kind",
        "markets.mm_cash_flow_cents",
        "markets.rounding_reserve_cents",
      ])
      .where("companies.slug", "=", input.slug)
      .where("markets.status", "=", "open")
      .forUpdate(["markets", "companies"])
      .executeTakeFirst();

    if (market === undefined) {
      const priorMarket = await transaction
        .selectFrom("markets")
        .innerJoin("companies", "companies.id", "markets.company_id")
        .select("markets.id")
        .where("companies.slug", "=", input.slug)
        .limit(1)
        .executeTakeFirst();

      if (priorMarket !== undefined) {
        throw new ServiceError("MARKET_SETTLED", "Market is already settled.");
      }
      throw new ServiceError("MARKET_NOT_FOUND", "Market was not found.");
    }

    const winningBucketIndex = winningBucket(
      market.metric_kind,
      input.settled_value_usd,
    );
    if (winningBucketIndex >= market.n_buckets) {
      throw new ServiceError(
        "INVALID_INPUT",
        "Settlement value does not map to this market's bucket grid.",
      );
    }

    const { settlement_ts: settlementTs } = await transaction
      .selectNoFrom(sql<Date>`clock_timestamp()`.as("settlement_ts"))
      .executeTakeFirstOrThrow();

    const holdings = await transaction
      .selectFrom("holdings")
      .innerJoin("users", "users.id", "holdings.user_id")
      .select([
        "holdings.user_id",
        "holdings.h",
        "users.cash_balance_cents",
      ])
      .where("holdings.market_id", "=", market.market_id)
      .orderBy("users.id", "asc")
      .forUpdate(["holdings", "users"])
      .execute();

    let totalEntitlementUsd = 0;
    let totalPayoutCents = 0n;
    const zeroHoldings = new Array<number>(market.n_buckets).fill(0);

    for (const holding of holdings) {
      if (holding.h.length !== market.n_buckets) {
        throw new ServiceError(
          "INVALID_INPUT",
          "Stored holdings do not match the market bucket count.",
        );
      }

      const entitlementUsd = holding.h[winningBucketIndex]!;
      let payoutCents: number;
      try {
        payoutCents = quantizeEntitlementCents(entitlementUsd);
      } catch {
        throw new ServiceError(
          "INVALID_INPUT",
          "Stored settlement entitlement is invalid.",
        );
      }

      totalEntitlementUsd += entitlementUsd;
      totalPayoutCents += BigInt(payoutCents);

      await transaction
        .updateTable("users")
        .set({
          cash_balance_cents: (
            BigInt(holding.cash_balance_cents) + BigInt(payoutCents)
          ).toString(),
        })
        .where("id", "=", holding.user_id)
        .executeTakeFirstOrThrow();

      await transaction
        .updateTable("holdings")
        .set({ h: zeroHoldings, updated_at: settlementTs })
        .where("user_id", "=", holding.user_id)
        .where("market_id", "=", market.market_id)
        .executeTakeFirstOrThrow();
    }

    let aggregatePayoutCents: number;
    try {
      aggregatePayoutCents = quantizeEntitlementCents(totalEntitlementUsd);
    } catch {
      throw new ServiceError(
        "INVALID_INPUT",
        "Aggregate settlement entitlement is invalid.",
      );
    }
    const rawRoundingReserveDeltaCents =
      BigInt(aggregatePayoutCents) - totalPayoutCents;
    const roundingReserveDeltaCents =
      rawRoundingReserveDeltaCents < 0n ? 0n : rawRoundingReserveDeltaCents;

    await transaction
      .insertInto("settlements")
      .values({
        market_id: market.market_id,
        settled_value: input.settled_value_usd,
        winning_bucket: winningBucketIndex,
        source_url: input.source_url,
        source_description: input.source_description ?? null,
        ts: settlementTs,
      })
      .executeTakeFirstOrThrow();

    await transaction
      .updateTable("markets")
      .set({
        status: "settled",
        settled_at: settlementTs,
        mm_cash_flow_cents: (
          BigInt(market.mm_cash_flow_cents) - totalPayoutCents
        ).toString(),
        rounding_reserve_cents: (
          BigInt(market.rounding_reserve_cents) +
          roundingReserveDeltaCents
        ).toString(),
      })
      .where("id", "=", market.market_id)
      .where("status", "=", "open")
      .executeTakeFirstOrThrow();

    return {
      market_id: market.market_id,
      slug: input.slug,
      settled_value_usd: input.settled_value_usd,
      winning_bucket: winningBucketIndex,
      credited_users: holdings.length,
      total_payout_cents: totalPayoutCents.toString(),
      rounding_reserve_delta_cents: roundingReserveDeltaCents.toString(),
      settled_at: settlementTs.toISOString(),
    };
  });
}
