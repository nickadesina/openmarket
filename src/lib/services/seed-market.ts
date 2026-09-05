import { type Kysely, sql } from "kysely";

import { ServiceError } from "../api/errors.js";
import { formatCentsAsUsd, parseUsdToCents } from "../api/money.js";
import type { SeedInput } from "../api/schemas.js";
import type { CompanyRow, Database, MarketInsert, MarketRow } from "../db/schema.js";
import {
  VALUATION_BOUNDARIES_USD,
  VALUATION_BUCKET_COUNT,
  VALUATION_GRID_VERSION,
} from "../engine/buckets.js";
import { seedBinaryMarket, seedValuationMarket } from "../engine/seed.js";

export const BINARY_GRID_VERSION = "binary-v1" as const;

export type SeedMarketOutcome = "created" | "reseeded" | "unchanged";

/**
 * Internal service result. The database rows deliberately retain their Date
 * fields; a route boundary must serialize them before producing JSON.
 */
export interface SeedMarketResult {
  company: CompanyRow;
  market: MarketRow;
  outcome: SeedMarketOutcome;
}

type SeedMarketValues = Pick<
  MarketInsert,
  | "n_buckets"
  | "bucket_grid_version"
  | "metric_kind"
  | "anchor_valuation"
  | "anchor_date"
  | "anchor_description"
  | "b"
  | "sigma"
  | "initial_q"
  | "q"
  | "current_metric"
  | "last_market_sequence"
  | "mm_cash_flow_cents"
  | "rounding_reserve_cents"
  | "settled_at"
>;

interface SeedMark {
  market_sequence: string;
  trade_id: string | null;
  value: number;
}

function canonicalUsd(value: string): string {
  return formatCentsAsUsd(parseUsdToCents(value));
}

function buildSeedValues(input: SeedInput): SeedMarketValues {
  if (input.metric_kind === "valuation_median") {
    const seeded = seedValuationMarket(
      Number(input.anchor_valuation_usd),
      input.sigma,
      input.b,
      VALUATION_BOUNDARIES_USD,
    );

    return {
      n_buckets: VALUATION_BUCKET_COUNT,
      bucket_grid_version: VALUATION_GRID_VERSION,
      metric_kind: input.metric_kind,
      anchor_valuation: canonicalUsd(input.anchor_valuation_usd),
      anchor_date: input.anchor_date,
      anchor_description: input.anchor_description,
      b: input.b,
      sigma: input.sigma,
      initial_q: [...seeded.q],
      q: [...seeded.q],
      current_metric: seeded.currentMetric,
      last_market_sequence: "0",
      mm_cash_flow_cents: "0",
      rounding_reserve_cents: "0",
      settled_at: null,
    };
  }

  const seeded = seedBinaryMarket(input.yes_probability, input.b);
  return {
    n_buckets: 2,
    bucket_grid_version: BINARY_GRID_VERSION,
    metric_kind: input.metric_kind,
    anchor_valuation: null,
    anchor_date: null,
    anchor_description: null,
    b: input.b,
    sigma: null,
    initial_q: [...seeded.q],
    q: [...seeded.q],
    current_metric: seeded.currentMetric,
    last_market_sequence: "0",
    mm_cash_flow_cents: "0",
    rounding_reserve_cents: "0",
    settled_at: null,
  };
}

function arraysEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hasCanonicalSeedMark(marks: readonly SeedMark[], currentMetric: number): boolean {
  const [mark] = marks;
  return (
    marks.length === 1 &&
    mark?.market_sequence === "0" &&
    mark.trade_id === null &&
    mark.value === currentMetric
  );
}

function isEquivalentSeed(
  market: MarketRow,
  values: SeedMarketValues,
  marks: readonly SeedMark[],
): boolean {
  return (
    market.status === "open" &&
    market.n_buckets === values.n_buckets &&
    market.bucket_grid_version === values.bucket_grid_version &&
    market.metric_kind === values.metric_kind &&
    market.anchor_valuation === values.anchor_valuation &&
    market.anchor_date === values.anchor_date &&
    market.anchor_description === values.anchor_description &&
    market.b === values.b &&
    market.sigma === values.sigma &&
    arraysEqual(market.initial_q, values.initial_q) &&
    arraysEqual(market.q, values.q) &&
    market.current_metric === values.current_metric &&
    market.last_market_sequence === "0" &&
    market.mm_cash_flow_cents === "0" &&
    market.rounding_reserve_cents === "0" &&
    market.settled_at === null &&
    hasCanonicalSeedMark(marks, values.current_metric)
  );
}

function refuseReseed(marketId: string): never {
  throw new ServiceError(
    "INVALID_INPUT",
    "Only a pristine market with no trading history can be reseeded.",
    { market_id: marketId },
  );
}

function assertPristine(
  market: MarketRow,
  marks: readonly SeedMark[],
  relatedRowExists: boolean,
): void {
  if (
    relatedRowExists ||
    market.last_market_sequence !== "0" ||
    market.mm_cash_flow_cents !== "0" ||
    market.rounding_reserve_cents !== "0" ||
    market.settled_at !== null ||
    !arraysEqual(market.q, market.initial_q) ||
    !hasCanonicalSeedMark(marks, market.current_metric)
  ) {
    refuseReseed(market.id);
  }
}

export async function seedMarket(
  db: Kysely<Database>,
  input: SeedInput,
): Promise<SeedMarketResult> {
  const seedValues = buildSeedValues(input);

  return db.transaction().execute(async (transaction) => {
    const company = await transaction
      .insertInto("companies")
      .values({
        name: input.name,
        slug: input.slug,
        logo_path: input.logo_path,
      })
      .onConflict((conflict) =>
        conflict.column("slug").doUpdateSet({
          name: input.name,
          logo_path: input.logo_path,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    const existingMarket = await transaction
      .selectFrom("markets")
      .selectAll()
      .where("company_id", "=", company.id)
      .where("status", "=", "open")
      .forUpdate()
      .executeTakeFirst();

    const insertSeed = async (
      outcome: Exclude<SeedMarketOutcome, "unchanged">,
    ): Promise<SeedMarketResult> => {
      const market = await transaction
        .insertInto("markets")
        .values({
          company_id: company.id,
          status: "open",
          ...seedValues,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await transaction
        .insertInto("marks")
        .values({
          market_id: market.id,
          market_sequence: "0",
          trade_id: null,
          ts: sql<Date>`clock_timestamp()`,
          value: market.current_metric,
        })
        .executeTakeFirstOrThrow();

      return { company, market, outcome };
    };

    if (existingMarket === undefined) {
      return insertSeed("created");
    }

    const marks = await transaction
      .selectFrom("marks")
      .select(["market_sequence", "trade_id", "value"])
      .where("market_id", "=", existingMarket.id)
      .execute();

    if (isEquivalentSeed(existingMarket, seedValues, marks)) {
      return { company, market: existingMarket, outcome: "unchanged" };
    }

    const trade = await transaction
      .selectFrom("trades")
      .select("id")
      .where("market_id", "=", existingMarket.id)
      .limit(1)
      .executeTakeFirst();
    const holding = await transaction
      .selectFrom("holdings")
      .select("user_id")
      .where("market_id", "=", existingMarket.id)
      .limit(1)
      .executeTakeFirst();
    const settlement = await transaction
      .selectFrom("settlements")
      .select("market_id")
      .where("market_id", "=", existingMarket.id)
      .executeTakeFirst();
    const comment = await transaction
      .selectFrom("market_comments")
      .select("id")
      .where("market_id", "=", existingMarket.id)
      .limit(1)
      .executeTakeFirst();

    assertPristine(
      existingMarket,
      marks,
      trade !== undefined ||
        holding !== undefined ||
        settlement !== undefined ||
        comment !== undefined,
    );

    await transaction
      .deleteFrom("marks")
      .where("market_id", "=", existingMarket.id)
      .where("market_sequence", "=", "0")
      .execute();
    await transaction.deleteFrom("markets").where("id", "=", existingMarket.id).execute();

    return insertSeed("reseeded");
  });
}
