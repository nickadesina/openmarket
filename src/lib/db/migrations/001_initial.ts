import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create extension if not exists pgcrypto`.execute(db);

  await db.schema
    .createTable("companies")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("slug", "text", (column) => column.notNull().unique())
    .addColumn("logo_path", "text", (column) => column.notNull())
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable("markets")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("company_id", "uuid", (column) => column.notNull().references("companies.id"))
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("n_buckets", "smallint", (column) => column.notNull())
    .addColumn("bucket_grid_version", "text", (column) => column.notNull())
    .addColumn("metric_kind", "text", (column) => column.notNull())
    .addColumn("anchor_valuation", "numeric(24, 2)")
    .addColumn("anchor_date", "date")
    .addColumn("anchor_description", "text")
    .addColumn("b", "double precision", (column) => column.notNull())
    .addColumn("sigma", "double precision")
    .addColumn("initial_q", sql`double precision[]`, (column) => column.notNull())
    .addColumn("q", sql`double precision[]`, (column) => column.notNull())
    .addColumn("current_metric", "double precision", (column) => column.notNull())
    .addColumn("last_market_sequence", "bigint", (column) => column.notNull().defaultTo("0"))
    .addColumn("mm_cash_flow_cents", "bigint", (column) => column.notNull().defaultTo("0"))
    .addColumn("rounding_reserve_cents", "bigint", (column) => column.notNull().defaultTo("0"))
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn("settled_at", "timestamptz")
    .addCheckConstraint("markets_status_check", sql`status in ('open', 'settled')`)
    .addCheckConstraint(
      "markets_metric_kind_check",
      sql`metric_kind in ('valuation_median', 'yes_probability')`,
    )
    .addCheckConstraint("markets_b_positive_check", sql`b > 0`)
    .addCheckConstraint("markets_sigma_positive_check", sql`sigma is null or sigma > 0`)
    .addCheckConstraint("markets_last_sequence_nonnegative_check", sql`last_market_sequence >= 0`)
    .addCheckConstraint(
      "markets_initial_q_length_check",
      sql`array_length(initial_q, 1) = n_buckets`,
    )
    .addCheckConstraint("markets_q_length_check", sql`array_length(q, 1) = n_buckets`)
    .addCheckConstraint(
      "markets_kind_shape_check",
      sql`(
        metric_kind = 'valuation_median'
        and n_buckets = 41
        and anchor_valuation is not null
        and anchor_date is not null
        and anchor_description is not null
        and sigma is not null
      ) or (
        metric_kind = 'yes_probability'
        and n_buckets = 2
      )`,
    )
    .execute();

  await db.schema
    .createIndex("markets_one_open_per_company")
    .unique()
    .on("markets")
    .column("company_id")
    .where(sql<boolean>`status = 'open'`)
    .execute();

  await db.schema
    .createTable("users")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("username", "text", (column) => column.notNull())
    .addColumn("username_normalized", "text", (column) => column.notNull().unique())
    .addColumn("cash_balance_cents", "bigint", (column) => column.notNull())
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addCheckConstraint("users_cash_balance_nonnegative_check", sql`cash_balance_cents >= 0`)
    .execute();

  await db.schema
    .createTable("holdings")
    .addColumn("user_id", "uuid", (column) => column.notNull().references("users.id"))
    .addColumn("market_id", "uuid", (column) => column.notNull().references("markets.id"))
    .addColumn("h", sql`double precision[]`, (column) => column.notNull())
    .addColumn("updated_at", "timestamptz", (column) => column.notNull())
    .addPrimaryKeyConstraint("holdings_primary_key", ["user_id", "market_id"])
    .execute();

  await db.schema
    .createTable("trades")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("idempotency_key", "uuid", (column) => column.notNull().unique())
    .addColumn("request_fingerprint", "text", (column) => column.notNull())
    .addColumn("user_id", "uuid", (column) => column.notNull().references("users.id"))
    .addColumn("market_id", "uuid", (column) => column.notNull().references("markets.id"))
    .addColumn("market_sequence", "bigint", (column) => column.notNull())
    .addColumn("action", "text", (column) => column.notNull())
    .addColumn("contract_side", "text", (column) => column.notNull())
    .addColumn("strike_index", "smallint", (column) => column.notNull())
    .addColumn("strike_value", "numeric(24, 2)")
    .addColumn("quantity", "double precision", (column) => column.notNull())
    .addColumn("requested_spend_cents", "bigint")
    .addColumn("engine_cost_usd", "double precision", (column) => column.notNull())
    .addColumn("cash_amount_cents", "bigint", (column) => column.notNull())
    .addColumn("redemption_quantity", "double precision", (column) => column.notNull().defaultTo(0))
    .addColumn("redemption_cents", "bigint", (column) => column.notNull().defaultTo("0"))
    .addColumn("delta", sql`double precision[]`, (column) => column.notNull())
    .addColumn("q_before", sql`double precision[]`, (column) => column.notNull())
    .addColumn("q_after", sql`double precision[]`, (column) => column.notNull())
    .addColumn("metric_before", "double precision", (column) => column.notNull())
    .addColumn("metric_after", "double precision", (column) => column.notNull())
    .addColumn("execution_result", "jsonb", (column) => column.notNull())
    .addColumn("created_at", "timestamptz", (column) => column.notNull())
    .addUniqueConstraint("trades_market_sequence_unique", ["market_id", "market_sequence"])
    .addCheckConstraint("trades_market_sequence_positive_check", sql`market_sequence > 0`)
    .addCheckConstraint("trades_action_check", sql`action in ('buy', 'sell')`)
    .addCheckConstraint("trades_contract_side_check", sql`contract_side in ('yes', 'no')`)
    .addCheckConstraint("trades_quantity_positive_check", sql`quantity > 0`)
    .execute();

  await db.schema
    .createTable("marks")
    .addColumn("market_id", "uuid", (column) => column.notNull().references("markets.id"))
    .addColumn("market_sequence", "bigint", (column) => column.notNull())
    .addColumn("trade_id", "uuid", (column) => column.references("trades.id").unique())
    .addColumn("ts", "timestamptz", (column) => column.notNull())
    .addColumn("value", "double precision", (column) => column.notNull())
    .addPrimaryKeyConstraint("marks_primary_key", ["market_id", "market_sequence"])
    .execute();

  await db.schema
    .createIndex("marks_market_ts_sequence_index")
    .on("marks")
    .columns(["market_id", "ts", "market_sequence"])
    .execute();

  await db.schema
    .createTable("settlements")
    .addColumn("market_id", "uuid", (column) =>
      column.primaryKey().notNull().references("markets.id"),
    )
    .addColumn("settled_value", "numeric(24, 2)", (column) => column.notNull())
    .addColumn("winning_bucket", "smallint", (column) => column.notNull())
    .addColumn("source_url", "text", (column) => column.notNull())
    .addColumn("source_description", "text")
    .addColumn("ts", "timestamptz", (column) => column.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("settlements").execute();
  await db.schema.dropTable("marks").execute();
  await db.schema.dropTable("trades").execute();
  await db.schema.dropTable("holdings").execute();
  await db.schema.dropTable("users").execute();
  await db.schema.dropTable("markets").execute();
  await db.schema.dropTable("companies").execute();
}
