import { type Expression, type RawBuilder, sql } from "kysely";

/**
 * D4 open interest: the market maker's maximum payout liability in dollars. Holdings are summed
 * across accounts per bucket and the largest bucket total wins; each contract pays $1.00 in its
 * winning bucket, so the figure does not grow with how many buckets a contract's mask covers.
 * Summing every bucket entry instead would count one low-strike YES forty times.
 */
export function openInterestSql(marketId: Expression<string> | string): RawBuilder<number> {
  return sql<number>`coalesce((select max(bucket_total) from (select sum(bucket.bucket_quantity) as bucket_total from holdings as claim_holding cross join lateral unnest(claim_holding.h) with ordinality as bucket(bucket_quantity, bucket_index) where claim_holding.market_id = ${marketId} group by bucket.bucket_index) as bucket_totals), 0)`;
}
