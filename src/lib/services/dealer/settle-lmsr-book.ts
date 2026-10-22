import type { Transaction } from "kysely";

import { ServiceError } from "../../api/errors.js";
import type { Database } from "../../db/schema.js";
import { quantizeEntitlementCents } from "../../engine/lmsr.js";

export interface LmsrBookSettlement {
  /** The book, already locked for update by the caller. */
  readonly market: {
    readonly market_id: string;
    readonly n_buckets: number;
    readonly mm_cash_flow_cents: string;
    readonly rounding_reserve_cents: string;
  };
  readonly winningBucket: number;
  /** Decimal USD, as `settlements.settled_value` stores it. */
  readonly settledValue: string;
  readonly sourceUrl: string;
  readonly sourceDescription: string | null;
  readonly ts: Date;
}

export interface LmsrBookCredit {
  readonly creditedUsers: number;
  readonly totalPayoutCents: bigint;
  readonly roundingReserveDeltaCents: bigint;
}

/**
 * Pays $1 per share in the winning bucket to every holder, zeroes holdings,
 * writes the `settlements` row and closes the book, in the caller's
 * transaction. The settle job pays a dealer binary's YES or NO through this.
 */
export async function settleLmsrBook(
  transaction: Transaction<Database>,
  book: LmsrBookSettlement,
): Promise<LmsrBookCredit> {
  const market = book.market;
  const holdings = await transaction
    .selectFrom("holdings")
    .innerJoin("users", "users.id", "holdings.user_id")
    .select(["holdings.user_id", "holdings.h", "users.cash_balance_cents"])
    .where("holdings.market_id", "=", market.market_id)
    .orderBy("users.id", "asc")
    .forUpdate(["holdings", "users"])
    .execute();

  let totalEntitlementUsd = 0;
  let totalPayoutCents = 0n;
  let creditedUsers = 0;
  const zeroHoldings = new Array<number>(market.n_buckets).fill(0);

  for (const holding of holdings) {
    if (holding.h.length !== market.n_buckets) {
      throw new ServiceError(
        "INVALID_INPUT",
        "Stored holdings do not match the market bucket count.",
      );
    }

    const entitlementUsd = holding.h[book.winningBucket]!;
    let payoutCents: number;
    try {
      payoutCents = quantizeEntitlementCents(entitlementUsd);
    } catch {
      throw new ServiceError("INVALID_INPUT", "Stored settlement entitlement is invalid.");
    }

    totalEntitlementUsd += entitlementUsd;
    totalPayoutCents += BigInt(payoutCents);
    if (payoutCents > 0) creditedUsers += 1;

    await transaction
      .updateTable("users")
      .set({
        cash_balance_cents: (BigInt(holding.cash_balance_cents) + BigInt(payoutCents)).toString(),
      })
      .where("id", "=", holding.user_id)
      .executeTakeFirstOrThrow();

    await transaction
      .updateTable("holdings")
      .set({ h: zeroHoldings, updated_at: book.ts })
      .where("user_id", "=", holding.user_id)
      .where("market_id", "=", market.market_id)
      .executeTakeFirstOrThrow();
  }

  let aggregatePayoutCents: number;
  try {
    aggregatePayoutCents = quantizeEntitlementCents(totalEntitlementUsd);
  } catch {
    throw new ServiceError("INVALID_INPUT", "Aggregate settlement entitlement is invalid.");
  }
  const rawRoundingReserveDeltaCents = BigInt(aggregatePayoutCents) - totalPayoutCents;
  const roundingReserveDeltaCents =
    rawRoundingReserveDeltaCents < 0n ? 0n : rawRoundingReserveDeltaCents;

  await transaction
    .insertInto("settlements")
    .values({
      market_id: market.market_id,
      settled_value: book.settledValue,
      winning_bucket: book.winningBucket,
      source_url: book.sourceUrl,
      source_description: book.sourceDescription,
      ts: book.ts,
    })
    .executeTakeFirstOrThrow();

  await transaction
    .updateTable("markets")
    .set({
      status: "settled",
      settled_at: book.ts,
      mm_cash_flow_cents: (BigInt(market.mm_cash_flow_cents) - totalPayoutCents).toString(),
      rounding_reserve_cents: (
        BigInt(market.rounding_reserve_cents) + roundingReserveDeltaCents
      ).toString(),
    })
    .where("id", "=", market.market_id)
    .where("status", "=", "open")
    .executeTakeFirstOrThrow();

  return { creditedUsers, totalPayoutCents, roundingReserveDeltaCents };
}
