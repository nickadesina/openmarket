import { type Kysely, sql } from "kysely";

/**
 * The dealer design (README D10–D14, TECHNICAL_DESIGN.md §3). Listings hold a
 * name's versioned parameters; instruments hold each contract's semantics and
 * state. Every instrument trades on exactly one `markets` row, its ledger
 * book, so cash, sequence, marks, status, settlements and comments reuse the
 * existing ledger. The binary's book is the `yes_probability` shape; the
 * forward's is `forward_ln`.
 *
 * event_flags, model_mids, quotes and reference_prices are append-only logs
 * (tournament_reject_mutation from 004); the rest is state derived from them.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("cron_runs")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("job", "text", (column) => column.notNull())
    // The caller's key for one firing; a rerun with the same key exits early.
    .addColumn("run_id", "text", (column) => column.notNull().unique())
    .addColumn("started_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn("finished_at", "timestamptz")
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("detail_json", "jsonb")
    .addCheckConstraint("cron_runs_status", sql`status in ('running', 'succeeded', 'failed')`)
    .addCheckConstraint(
      "cron_runs_finished",
      sql`(status = 'running') = (finished_at is null) and (finished_at is null or finished_at >= started_at)`,
    )
    .execute();

  await db.schema
    .createTable("listings")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("company_id", "uuid", (column) => column.notNull().references("companies.id"))
    .addColumn("tier", "text", (column) => column.notNull())
    .addColumn("binary_event", "text", (column) => column.notNull())
    .addColumn("kappa", "double precision", (column) => column.notNull())
    .addColumn("cap_cents", "bigint", (column) => column.notNull())
    .addColumn("b_cents", "bigint", (column) => column.notNull())
    .addColumn("spread_floor", "double precision", (column) => column.notNull())
    .addColumn("gamma", "double precision", (column) => column.notNull())
    .addColumn("p_floor", "double precision", (column) => column.notNull())
    .addColumn("forward_t_days", "integer", (column) => column.notNull())
    .addColumn("model_version", "text", (column) => column.notNull())
    // The last priced round in backtest/events.csv when the name was listed.
    .addColumn("anchor_round", "text", (column) => column.notNull())
    .addColumn("anchor_date", "date", (column) => column.notNull())
    .addColumn("anchor_post_money_usd", "numeric(24, 2)", (column) => column.notNull())
    .addColumn("anchor_source_url", "text", (column) => column.notNull())
    .addColumn("anchor_source_rank", "smallint")
    .addColumn("listed_at", "timestamptz", (column) => column.notNull())
    .addColumn("delisted_at", "timestamptz")
    .addUniqueConstraint("listings_company_listed_at", ["company_id", "listed_at"])
    .addCheckConstraint("listings_tier", sql`tier in ('mega', 'redhot')`)
    .addCheckConstraint("listings_binary_event", sql`binary_event in ('priced_round', 'public_s1')`)
    .addCheckConstraint(
      "listings_parameters",
      sql`kappa > 0 and cap_cents > 0 and b_cents > 0 and spread_floor > 0 and gamma >= 0
        and p_floor > 0 and p_floor < 0.5 and forward_t_days > 0`,
    )
    .addCheckConstraint(
      "listings_anchor",
      sql`anchor_post_money_usd > 0 and (anchor_source_rank is null or anchor_source_rank between 1 and 4)`,
    )
    .addCheckConstraint(
      "listings_delisted_after_listed",
      sql`delisted_at is null or delisted_at > listed_at`,
    )
    .execute();

  await db.schema
    .createIndex("listings_one_active_per_company")
    .unique()
    .on("listings")
    .column("company_id")
    .where(sql<boolean>`delisted_at is null`)
    .execute();

  await db.schema
    .createTable("instruments")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("listing_id", "uuid", (column) => column.notNull().references("listings.id"))
    .addColumn("kind", "text", (column) => column.notNull())
    // 1, 2, … per listing and kind; a successor lists at the next epoch.
    .addColumn("epoch", "integer", (column) => column.notNull())
    .addColumn("question", "text", (column) => column.notNull())
    .addColumn("opens_at", "timestamptz", (column) => column.notNull())
    .addColumn("expires_at", "timestamptz", (column) => column.notNull())
    // The forward's anchor in ln USD: the print it rolled from, or the mid on a void.
    .addColumn("entry_ref_ln", "double precision")
    .addColumn("state", "text", (column) => column.notNull())
    .addColumn("widened_until", "timestamptz")
    .addColumn("closed_at", "timestamptz")
    .addColumn("resolution_json", "jsonb")
    .addUniqueConstraint("instruments_listing_kind_epoch", ["listing_id", "kind", "epoch"])
    .addCheckConstraint("instruments_kind", sql`kind in ('binary', 'forward')`)
    .addCheckConstraint("instruments_epoch_positive", sql`epoch >= 1`)
    .addCheckConstraint("instruments_window", sql`opens_at < expires_at`)
    .addCheckConstraint(
      "instruments_state",
      sql`state in ('quoting', 'widened', 'resolved', 'expired')`,
    )
    .addCheckConstraint(
      "instruments_entry_ref_forward_only",
      sql`kind = 'forward' or entry_ref_ln is null`,
    )
    .addCheckConstraint(
      "instruments_widened_until",
      sql`(state = 'widened') = (widened_until is not null)`,
    )
    .addCheckConstraint(
      "instruments_closed",
      sql`(state in ('resolved', 'expired')) = (closed_at is not null)
        and (resolution_json is null or closed_at is not null)`,
    )
    .execute();

  await db.schema
    .createIndex("instruments_one_live_per_listing_kind")
    .unique()
    .on("instruments")
    .columns(["listing_id", "kind"])
    .where(sql<boolean>`state in ('quoting', 'widened')`)
    .execute();

  await db.schema
    .alterTable("markets")
    .addColumn("instrument_id", "uuid", (column) => column.references("instruments.id").unique())
    .execute();

  // A forward's book: q = [open long, open short] notional in USD from [0, 0],
  // and b is the listing's κ, the clip, so b·(q long + q short) bounds the
  // book's liability. current_metric is the mid in USD, exp(mid_ln).
  await db.schema.alterTable("markets").dropConstraint("markets_metric_kind_check").execute();
  await db.schema
    .alterTable("markets")
    .addCheckConstraint(
      "markets_metric_kind_check",
      sql`metric_kind in ('valuation_median', 'yes_probability', 'forward_ln')`,
    )
    .execute();
  await db.schema.alterTable("markets").dropConstraint("markets_kind_shape_check").execute();
  await db.schema
    .alterTable("markets")
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
      ) or (
        metric_kind = 'forward_ln'
        and n_buckets = 2
        and instrument_id is not null
        and anchor_valuation is null
        and anchor_date is null
        and anchor_description is null
        and sigma is null
        and initial_q = array[0, 0]::double precision[]
        and 0 <= all(q)
        and current_metric > 0
      )`,
    )
    .execute();

  // A strict relaxation: one open book per company and kind, so a name's
  // binary and forward books stand beside each other (and beside a ladder
  // until milestone 6 removes it).
  await db.schema.dropIndex("markets_one_open_per_company").execute();
  await db.schema
    .createIndex("markets_one_open_per_company_kind")
    .unique()
    .on("markets")
    .columns(["company_id", "metric_kind"])
    .where(sql<boolean>`status = 'open'`)
    .execute();

  // A forward trade is notional at the quote: contract_side long or short, strike_index -1.
  await db.schema.alterTable("trades").dropConstraint("trades_contract_side_check").execute();
  await db.schema
    .alterTable("trades")
    .addCheckConstraint(
      "trades_contract_side_check",
      sql`contract_side in ('yes', 'no', 'long', 'short')`,
    )
    .execute();

  // Pinned by docs/decisions/0001-event-flags-and-ingest-handoff.md.
  await db.schema
    .createTable("event_flags")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("company_id", "uuid", (column) => column.notNull().references("companies.id"))
    .addColumn("kind", "text", (column) => column.notNull())
    .addColumn("source_url", "text")
    .addColumn("source_rank", "smallint")
    .addColumn("observed_at", "timestamptz", (column) => column.notNull())
    .addColumn("published_at", "timestamptz")
    .addColumn("terms_json", "jsonb", (column) => column.notNull())
    .addColumn("confidence", "text", (column) => column.notNull())
    // Syndications of one report share a key; the rulebook counts outlets within it.
    .addColumn("dedupe_key", "text", (column) => column.notNull())
    .addColumn("promoted_from", "uuid", (column) => column.references("event_flags.id"))
    .addColumn("run_id", "text", (column) => column.references("cron_runs.run_id"))
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      "event_flags_kind",
      sql`kind in ('form_d', 'form_d_amend', 'charter', 'scoop', 'release', 's1_public', 'print', 'user_submitted')`,
    )
    .addCheckConstraint("event_flags_confidence", sql`confidence in ('high', 'medium', 'low')`)
    .addCheckConstraint(
      "event_flags_source_rank",
      sql`source_rank is null or source_rank between 1 and 4`,
    )
    .addCheckConstraint(
      "event_flags_print_sourced",
      sql`kind <> 'print' or (source_url is not null and source_rank is not null)`,
    )
    .addCheckConstraint(
      "event_flags_promoted_print_only",
      sql`promoted_from is null or kind = 'print'`,
    )
    // A JSON null basis counts as absent.
    .addCheckConstraint(
      "event_flags_terms_shape",
      sql`jsonb_typeof(terms_json) = 'object'
        and coalesce(terms_json ->> 'valuation_basis', 'unknown') in ('pre', 'post', 'unknown')`,
    )
    .execute();

  await db.schema
    .createIndex("event_flags_company_observed")
    .on("event_flags")
    .columns(["company_id", "observed_at"])
    .execute();
  await db.schema
    .createIndex("event_flags_dedupe_key")
    .on("event_flags")
    .column("dedupe_key")
    .execute();

  await db.schema
    .createTable("model_mids")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("instrument_id", "uuid", (column) => column.notNull().references("instruments.id"))
    .addColumn("model_version", "text", (column) => column.notNull())
    .addColumn("rulebook_version", "text", (column) => column.notNull())
    .addColumn("computed_at", "timestamptz", (column) => column.notNull())
    // A forward's mid in ln USD, or a binary's probability; never both.
    .addColumn("mid_ln", "double precision")
    .addColumn("p", "double precision")
    .addColumn("inputs_json", "jsonb", (column) => column.notNull())
    .addColumn("run_id", "text", (column) => column.references("cron_runs.run_id"))
    .addCheckConstraint("model_mids_one_value", sql`(mid_ln is null) <> (p is null)`)
    .addCheckConstraint("model_mids_p_range", sql`p is null or (p > 0 and p < 1)`)
    .execute();

  await db.schema
    .createIndex("model_mids_instrument_computed")
    .on("model_mids")
    .columns(["instrument_id", "computed_at"])
    .execute();

  // The tape: every two-way quote posted. A forward quote carries mid, bid and
  // ask in ln USD (a side breaching Q is pulled, so null); a binary, price.
  await db.schema
    .createTable("quotes")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("instrument_id", "uuid", (column) => column.notNull().references("instruments.id"))
    .addColumn("posted_at", "timestamptz", (column) => column.notNull())
    .addColumn("reason", "text", (column) => column.notNull())
    .addColumn("model_mid_id", "uuid", (column) => column.references("model_mids.id"))
    .addColumn("mid_ln", "double precision")
    .addColumn("bid_ln", "double precision")
    .addColumn("ask_ln", "double precision")
    .addColumn("price", "double precision")
    .addColumn("half_spread", "double precision")
    .addColumn("inventory_cents", "bigint", (column) => column.notNull())
    .addColumn("cap_cents_effective", "bigint", (column) => column.notNull())
    .addColumn("flag_state", "text", (column) => column.notNull())
    .addColumn("trade_id", "uuid", (column) => column.references("trades.id"))
    .addColumn("model_version", "text", (column) => column.notNull())
    .addColumn("rulebook_version", "text", (column) => column.notNull())
    .addCheckConstraint(
      "quotes_reason",
      sql`reason in ('list', 'requote', 'fill', 'widen', 'restore')`,
    )
    .addCheckConstraint("quotes_flag_state", sql`flag_state in ('normal', 'widened')`)
    .addCheckConstraint("quotes_fill_has_trade", sql`(reason = 'fill') = (trade_id is not null)`)
    .addCheckConstraint(
      "quotes_shape",
      sql`(mid_ln is null) <> (price is null)
        and (price is null or (bid_ln is null and ask_ln is null and price > 0 and price < 1))
        and (bid_ln is null or ask_ln is null or bid_ln < ask_ln)
        and (half_spread is null or half_spread >= 0)
        and cap_cents_effective >= 0`,
    )
    .execute();

  await db.schema
    .createIndex("quotes_instrument_posted")
    .on("quotes")
    .columns(["instrument_id", "posted_at"])
    .execute();

  // Collateral N·κ is reserved at open and released at settlement or void.
  await db.schema
    .createTable("forward_positions")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("instrument_id", "uuid", (column) => column.notNull().references("instruments.id"))
    .addColumn("user_id", "uuid", (column) => column.notNull().references("users.id"))
    .addColumn("trade_id", "uuid", (column) => column.notNull().references("trades.id").unique())
    .addColumn("side", "text", (column) => column.notNull())
    .addColumn("notional_cents", "bigint", (column) => column.notNull())
    // F₀: the side of the quote filled (ask for a long, bid for a short), ln USD.
    .addColumn("entry_ln", "double precision", (column) => column.notNull())
    .addColumn("collateral_cents", "bigint", (column) => column.notNull())
    .addColumn("opened_at", "timestamptz", (column) => column.notNull())
    .addColumn("settled_at", "timestamptz")
    .addColumn("settle_ln", "double precision")
    .addColumn("payout_cents", "bigint")
    .addColumn("voided_at", "timestamptz")
    .addCheckConstraint("forward_positions_side", sql`side in ('long', 'short')`)
    .addCheckConstraint(
      "forward_positions_amounts",
      sql`notional_cents > 0 and collateral_cents >= 0`,
    )
    .addCheckConstraint(
      "forward_positions_settlement",
      sql`not (settled_at is not null and voided_at is not null)
        and (settled_at is null) = (settle_ln is null)
        and (settled_at is null) = (payout_cents is null)`,
    )
    .execute();

  await db.schema
    .createIndex("forward_positions_instrument")
    .on("forward_positions")
    .column("instrument_id")
    .execute();
  await db.schema
    .createIndex("forward_positions_user")
    .on("forward_positions")
    .columns(["user_id", "opened_at"])
    .execute();

  await db.schema
    .createTable("reference_prices")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("listing_id", "uuid", (column) => column.notNull().references("listings.id"))
    .addColumn("kind", "text", (column) => column.notNull())
    .addColumn("as_of", "timestamptz", (column) => column.notNull())
    .addColumn("value", "double precision", (column) => column.notNull())
    .addColumn("blend_version", "text", (column) => column.notNull())
    .addColumn("model_version", "text", (column) => column.notNull())
    .addColumn("rulebook_version", "text", (column) => column.notNull())
    .addColumn("w_model", "double precision", (column) => column.notNull())
    .addColumn("w_traded", "double precision", (column) => column.notNull())
    .addColumn("w_crowd", "double precision", (column) => column.notNull())
    .addColumn("components_json", "jsonb", (column) => column.notNull())
    .addCheckConstraint("reference_prices_kind", sql`kind in ('forward', 'binary')`)
    .addCheckConstraint(
      "reference_prices_weights",
      sql`w_model >= 0 and w_traded >= 0 and w_crowd >= 0
        and abs(w_model + w_traded + w_crowd - 1) < 1e-9`,
    )
    .execute();

  await db.schema
    .createIndex("reference_prices_listing_kind_as_of")
    .on("reference_prices")
    .columns(["listing_id", "kind", "as_of"])
    .execute();

  await db.schema
    .createTable("tournament_instrument_links")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("question_id", "uuid", (column) =>
      column.notNull().references("tournament_questions.id").unique(),
    )
    .addColumn("instrument_id", "uuid", (column) =>
      column.notNull().references("instruments.id").unique(),
    )
    .execute();

  // Written by ingest; ships empty so /admin/dealer reads it from day one.
  await db.schema
    .createTable("source_health")
    .addColumn("source", "text", (column) => column.primaryKey().notNull())
    .addColumn("last_success_at", "timestamptz")
    .addColumn("last_error_at", "timestamptz")
    .addColumn("last_error", "text")
    .execute();

  for (const table of ["event_flags", "model_mids", "quotes", "reference_prices"]) {
    await sql`
      create trigger ${sql.raw(`${table}_append_only`)}
      before update or delete on ${sql.table(table)}
      for each row execute function tournament_reject_mutation()
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    "source_health",
    "tournament_instrument_links",
    "reference_prices",
    "forward_positions",
    "quotes",
    "model_mids",
    "event_flags",
  ]) {
    await db.schema.dropTable(table).execute();
  }

  await db.schema.alterTable("trades").dropConstraint("trades_contract_side_check").execute();
  await db.schema
    .alterTable("trades")
    .addCheckConstraint("trades_contract_side_check", sql`contract_side in ('yes', 'no')`)
    .execute();

  await db.schema.dropIndex("markets_one_open_per_company_kind").execute();
  await db.schema
    .createIndex("markets_one_open_per_company")
    .unique()
    .on("markets")
    .column("company_id")
    .where(sql<boolean>`status = 'open'`)
    .execute();

  await db.schema.alterTable("markets").dropConstraint("markets_kind_shape_check").execute();
  await db.schema.alterTable("markets").dropConstraint("markets_metric_kind_check").execute();
  await db.schema.alterTable("markets").dropColumn("instrument_id").execute();
  await db.schema
    .alterTable("markets")
    .addCheckConstraint(
      "markets_metric_kind_check",
      sql`metric_kind in ('valuation_median', 'yes_probability')`,
    )
    .execute();
  await db.schema
    .alterTable("markets")
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

  await db.schema.dropTable("instruments").execute();
  await db.schema.dropTable("listings").execute();
  await db.schema.dropTable("cron_runs").execute();
}
