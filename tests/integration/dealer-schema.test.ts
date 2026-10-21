import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createMigrator } from "../../src/lib/db/migrator.js";
import type {
  EventFlagInsert,
  InstrumentInsert,
  MarketInsert,
  MetricKind,
} from "../../src/lib/db/schema.js";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

/**
 * Migration 007_dealer: the constraints the dealer will lean on, checked
 * against PostgreSQL rather than trusted from the migration's text.
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Dealer schema PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Dealer schema PostgreSQL integration";

const LISTED_AT = new Date("2026-10-22T00:00:00.000Z");
const EXPIRES_AT = new Date("2026-12-31T23:59:59.000Z");

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;
  let companyId: string;
  let listingId: string;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
  }, 30_000);

  beforeEach(async () => {
    await resetPostgresTestDatabase(postgres.db);
    const company = await postgres.db
      .insertInto("companies")
      .values({ name: "Schema Co", slug: "schema-co", logo_path: "/test.svg" })
      .returning("id")
      .executeTakeFirstOrThrow();
    companyId = company.id;
    const listing = await postgres.db
      .insertInto("listings")
      .values({
        company_id: companyId,
        tier: "mega",
        binary_event: "priced_round",
        kappa: 1,
        cap_cents: "2500000",
        b_cents: "200000",
        spread_floor: 0.05,
        gamma: 0.5,
        p_floor: 0.05,
        forward_t_days: 90,
        model_version: "1.0.0",
        anchor_round: "Series A",
        anchor_date: "2026-09-28",
        anchor_post_money_usd: "10000000000.00",
        anchor_source_url: "https://example.test/schema-co",
        anchor_source_rank: 1,
        listed_at: LISTED_AT,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    listingId = listing.id;
  });

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  function insertInstrument(values: Partial<InstrumentInsert> = {}) {
    return postgres.db
      .insertInto("instruments")
      .values({
        listing_id: listingId,
        kind: "binary",
        epoch: 1,
        question: "Does Schema Co announce a priced round by 2026-12-31?",
        opens_at: LISTED_AT,
        expires_at: EXPIRES_AT,
        state: "quoting",
        ...values,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
  }

  function insertMarket(metricKind: MetricKind, values: Partial<MarketInsert> = {}) {
    return postgres.db
      .insertInto("markets")
      .values({
        company_id: companyId,
        status: "open",
        n_buckets: 2,
        bucket_grid_version: metricKind === "forward_ln" ? "forward-v1" : "binary-v1",
        metric_kind: metricKind,
        b: metricKind === "forward_ln" ? 1 : 2000,
        sigma: null,
        initial_q: [0, 0],
        q: [0, 0],
        current_metric: metricKind === "forward_ln" ? 10_000_000_000 : 0.5,
        ...values,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
  }

  function insertFlag(values: Partial<EventFlagInsert> = {}) {
    return postgres.db
      .insertInto("event_flags")
      .values({
        company_id: companyId,
        kind: "scoop",
        observed_at: LISTED_AT,
        terms_json: { valuation_usd: 12_000_000_000, valuation_basis: "unknown" },
        confidence: "high",
        dedupe_key: "schema-co-scoop",
        ...values,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
  }

  it("requires a source URL and rank on every print, and nowhere else", async () => {
    await expect(insertFlag()).resolves.toBeDefined();
    await expect(
      insertFlag({ kind: "print", source_url: "https://example.test/print" }),
    ).rejects.toThrow(/event_flags_print_sourced/);
    await expect(insertFlag({ kind: "print", source_rank: 1 })).rejects.toThrow(
      /event_flags_print_sourced/,
    );
    await expect(
      insertFlag({ kind: "print", source_url: "https://example.test/print", source_rank: 5 }),
    ).rejects.toThrow(/event_flags_source_rank/);
    await expect(
      insertFlag({ kind: "print", source_url: "https://example.test/print", source_rank: 1 }),
    ).resolves.toBeDefined();
  });

  it("keeps the flag kinds closed, promotion to prints, and the terms shape", async () => {
    const release = await insertFlag({ kind: "release", dedupe_key: "schema-co-release" });
    await expect(insertFlag({ kind: "rumour" as "scoop" })).rejects.toThrow(/event_flags_kind/);
    await expect(insertFlag({ promoted_from: release.id })).rejects.toThrow(
      /event_flags_promoted_print_only/,
    );
    await expect(
      insertFlag({
        kind: "print",
        source_url: "https://example.test/print",
        source_rank: 1,
        promoted_from: release.id,
      }),
    ).resolves.toBeDefined();
    await expect(insertFlag({ terms_json: { valuation_basis: "implied" } })).rejects.toThrow(
      /event_flags_terms_shape/,
    );
    // The fixture writes a JSON null basis where no valuation was reported.
    await expect(insertFlag({ terms_json: { valuation_basis: null } })).resolves.toBeDefined();
    await expect(insertFlag({ terms_json: {} })).resolves.toBeDefined();
    // Syndications share a dedupe key.
    await expect(insertFlag()).resolves.toBeDefined();
  });

  it("links a flag's run_id to cron_runs", async () => {
    await expect(insertFlag({ run_id: "ingest-missing" })).rejects.toThrow(/foreign key/);
    await postgres.db
      .insertInto("cron_runs")
      .values({ job: "ingest", run_id: "ingest-1", status: "running" })
      .execute();
    await expect(insertFlag({ run_id: "ingest-1" })).resolves.toBeDefined();
    await expect(
      postgres.db
        .insertInto("cron_runs")
        .values({ job: "ingest", run_id: "ingest-1", status: "running" })
        .execute(),
    ).rejects.toThrow(/cron_runs_run_id/);
  });

  it("rejects UPDATE and DELETE on every append-only log", async () => {
    const flag = await insertFlag();
    const instrument = await insertInstrument();
    const mid = await postgres.db
      .insertInto("model_mids")
      .values({
        instrument_id: instrument.id,
        model_version: "1.0.0",
        rulebook_version: "1.0.0",
        computed_at: LISTED_AT,
        p: 0.2,
        inputs_json: {},
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const quote = await postgres.db
      .insertInto("quotes")
      .values({
        instrument_id: instrument.id,
        posted_at: LISTED_AT,
        reason: "list",
        model_mid_id: mid.id,
        price: 0.2,
        inventory_cents: "0",
        cap_cents_effective: "2500000",
        flag_state: "normal",
        model_version: "1.0.0",
        rulebook_version: "1.0.0",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const reference = await postgres.db
      .insertInto("reference_prices")
      .values({
        listing_id: listingId,
        kind: "binary",
        as_of: LISTED_AT,
        value: 0.2,
        blend_version: "1.0.0",
        model_version: "1.0.0",
        rulebook_version: "1.0.0",
        w_model: 1,
        w_traded: 0,
        w_crowd: 0,
        components_json: {},
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    for (const [table, id] of [
      ["event_flags", flag.id],
      ["model_mids", mid.id],
      ["quotes", quote.id],
      ["reference_prices", reference.id],
    ] as const) {
      await expect(
        sql`update ${sql.table(table)} set id = id where id = ${id}`.execute(postgres.db),
      ).rejects.toThrow(`${table} is append-only`);
      await expect(
        sql`delete from ${sql.table(table)} where id = ${id}`.execute(postgres.db),
      ).rejects.toThrow(`${table} is append-only`);
    }
  });

  it("checks a mid and a quote carry one kind of price", async () => {
    const instrument = await insertInstrument();
    const mid = (values: { mid_ln?: number; p?: number }) =>
      postgres.db
        .insertInto("model_mids")
        .values({
          instrument_id: instrument.id,
          model_version: "1.0.0",
          rulebook_version: "1.0.0",
          computed_at: LISTED_AT,
          inputs_json: {},
          ...values,
        })
        .execute();
    await expect(mid({})).rejects.toThrow(/model_mids_one_value/);
    await expect(mid({ mid_ln: 23, p: 0.2 })).rejects.toThrow(/model_mids_one_value/);
    await expect(mid({ mid_ln: 23 })).resolves.toBeDefined();

    const quote = (values: Record<string, number | string | null>) =>
      postgres.db
        .insertInto("quotes")
        .values({
          instrument_id: instrument.id,
          posted_at: LISTED_AT,
          reason: "requote",
          inventory_cents: "0",
          cap_cents_effective: "2500000",
          flag_state: "normal",
          model_version: "1.0.0",
          rulebook_version: "1.0.0",
          ...values,
        })
        .execute();
    await expect(quote({ mid_ln: 23, bid_ln: 23.1, ask_ln: 22.9 })).rejects.toThrow(/quotes_shape/);
    await expect(quote({ price: 0.2, bid_ln: 22.9 })).rejects.toThrow(/quotes_shape/);
    await expect(quote({ reason: "fill", price: 0.2 })).rejects.toThrow(/quotes_fill_has_trade/);
    // A side that would breach Q is pulled.
    await expect(quote({ mid_ln: 23, bid_ln: 22.95, ask_ln: null })).resolves.toBeDefined();
  });

  it("allows a forward_ln book in the documented shape only", async () => {
    const forward = await insertInstrument({ kind: "forward", entry_ref_ln: 23.03 });
    await expect(insertMarket("forward_ln")).rejects.toThrow(/markets_kind_shape_check/);
    await expect(
      insertMarket("forward_ln", { instrument_id: forward.id, initial_q: [1, 0], q: [1, 0] }),
    ).rejects.toThrow(/markets_kind_shape_check/);
    await expect(
      insertMarket("forward_ln", { instrument_id: forward.id, sigma: 0.35 }),
    ).rejects.toThrow(/markets_kind_shape_check/);
    await expect(
      insertMarket("forward_ln", { instrument_id: forward.id, q: [-1, 0] }),
    ).rejects.toThrow(/markets_kind_shape_check/);
    const book = await insertMarket("forward_ln", { instrument_id: forward.id });
    // One book per instrument.
    await postgres.db
      .updateTable("markets")
      .set({ status: "settled", settled_at: LISTED_AT })
      .where("id", "=", book.id)
      .execute();
    await expect(insertMarket("forward_ln", { instrument_id: forward.id })).rejects.toThrow(
      /markets_instrument_id/,
    );
  });

  it("enforces one open market per company and metric kind", async () => {
    const forward = await insertInstrument({ kind: "forward", entry_ref_ln: 23.03 });
    const binary = await insertInstrument({ kind: "binary" });
    const first = await insertMarket("yes_probability", { instrument_id: binary.id });
    await insertMarket("forward_ln", { instrument_id: forward.id });
    await expect(insertMarket("yes_probability")).rejects.toThrow(
      /markets_one_open_per_company_kind/,
    );
    await postgres.db
      .updateTable("markets")
      .set({ status: "settled", settled_at: LISTED_AT })
      .where("id", "=", first.id)
      .execute();
    await expect(insertMarket("yes_probability")).resolves.toBeDefined();
  });

  it("accepts long and short trades on the ledger", async () => {
    const forward = await insertInstrument({ kind: "forward", entry_ref_ln: 23.03 });
    const book = await insertMarket("forward_ln", { instrument_id: forward.id });
    const tournamentUser = await postgres.db
      .insertInto("tournament_users")
      .defaultValues()
      .returning("id")
      .executeTakeFirstOrThrow();
    const user = await postgres.db
      .insertInto("users")
      .values({ tournament_user_id: tournamentUser.id, cash_balance_cents: "100" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const trade = (side: string) =>
      postgres.db
        .insertInto("trades")
        .values({
          idempotency_key: randomUUID(),
          request_fingerprint: "test",
          user_id: user.id,
          market_id: book.id,
          market_sequence: side === "long" ? "1" : side === "short" ? "2" : "3",
          action: "buy",
          contract_side: side as "long",
          strike_index: -1,
          quantity: 1,
          engine_cost_usd: 1,
          cash_amount_cents: "100",
          delta: [1, 0],
          q_before: [0, 0],
          q_after: [1, 0],
          metric_before: 1,
          metric_after: 1,
          execution_result: {},
          created_at: LISTED_AT,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
    const long = await trade("long");
    await expect(trade("short")).resolves.toBeDefined();
    await expect(trade("sideways")).rejects.toThrow(/trades_contract_side_check/);

    const position = (values: Record<string, unknown>) =>
      postgres.db
        .insertInto("forward_positions")
        .values({
          instrument_id: forward.id,
          user_id: user.id,
          trade_id: long.id,
          side: "long",
          notional_cents: "100",
          entry_ln: 23.08,
          collateral_cents: "100",
          opened_at: LISTED_AT,
          ...values,
        })
        .execute();
    await expect(
      position({
        settled_at: EXPIRES_AT,
        settle_ln: 23.5,
        payout_cents: "42",
        voided_at: EXPIRES_AT,
      }),
    ).rejects.toThrow(/forward_positions_settlement/);
    await expect(position({ notional_cents: "0" })).rejects.toThrow(/forward_positions_amounts/);
    await expect(position({})).resolves.toBeDefined();
    await expect(position({})).rejects.toThrow(/forward_positions_trade_id/);
  });

  it("allows one live instrument per listing and kind", async () => {
    const first = await insertInstrument();
    await insertInstrument({ kind: "forward", entry_ref_ln: 23.03 });
    await expect(insertInstrument({ epoch: 2 })).rejects.toThrow(
      /instruments_one_live_per_listing_kind/,
    );
    await expect(
      insertInstrument({ kind: "binary", entry_ref_ln: 23.03, epoch: 2 }),
    ).rejects.toThrow(/instruments_entry_ref_forward_only/);
    await expect(
      postgres.db
        .updateTable("instruments")
        .set({ state: "resolved" })
        .where("id", "=", first.id)
        .execute(),
    ).rejects.toThrow(/instruments_closed/);
    await postgres.db
      .updateTable("instruments")
      .set({ state: "resolved", closed_at: EXPIRES_AT, resolution_json: { outcome: "yes" } })
      .where("id", "=", first.id)
      .execute();
    await expect(insertInstrument({ epoch: 1 })).rejects.toThrow(/instruments_listing_kind_epoch/);
    await expect(insertInstrument({ epoch: 2 })).resolves.toBeDefined();
  });

  it("allows one active listing per company", async () => {
    const second = postgres.db
      .insertInto("listings")
      .columns([
        "company_id",
        "tier",
        "binary_event",
        "kappa",
        "cap_cents",
        "b_cents",
        "spread_floor",
        "gamma",
        "p_floor",
        "forward_t_days",
        "model_version",
        "anchor_round",
        "anchor_date",
        "anchor_post_money_usd",
        "anchor_source_url",
        "anchor_source_rank",
        "listed_at",
      ])
      .expression((eb) =>
        eb
          .selectFrom("listings")
          .select([
            "company_id",
            "tier",
            "binary_event",
            "kappa",
            "cap_cents",
            "b_cents",
            "spread_floor",
            "gamma",
            "p_floor",
            "forward_t_days",
            "model_version",
            "anchor_round",
            "anchor_date",
            "anchor_post_money_usd",
            "anchor_source_url",
            "anchor_source_rank",
            sql<Date>`listed_at + interval '1 day'`.as("listed_at"),
          ])
          .where("id", "=", listingId),
      );
    await expect(second.execute()).rejects.toThrow(/listings_one_active_per_company/);
    await postgres.db
      .updateTable("listings")
      .set({ delisted_at: new Date(LISTED_AT.getTime() + 86_400_000) })
      .where("id", "=", listingId)
      .execute();
    await expect(second.execute()).resolves.toBeDefined();
  });
});

postgresDescribe(`${suiteName}: down`, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
  }, 30_000);

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  async function relationExists(name: string): Promise<boolean> {
    const { rows } = await sql<{ exists: boolean }>`
      select to_regclass(${`${postgres.schema}.${name}`}) is not null as exists
    `.execute(postgres.db);
    return rows[0]!.exists;
  }

  it("drops every dealer table and restores the ladder's constraints, then re-applies", async () => {
    const migrator = createMigrator(postgres.db, postgres.schema);
    // Down past every later migration to the one before 007.
    const down = await migrator.migrateTo("006_tournament_accounts");
    expect(down.error).toBeUndefined();
    expect(down.results?.map((result) => result.migrationName).at(-1)).toBe("007_dealer");

    for (const table of ["listings", "instruments", "event_flags", "cron_runs", "quotes"]) {
      expect(await relationExists(table), table).toBe(false);
    }
    expect(await relationExists("markets_one_open_per_company")).toBe(true);
    expect(await relationExists("markets_one_open_per_company_kind")).toBe(false);
    const { rows } = await sql<{ definition: string }>`
      select pg_get_constraintdef(oid) as definition from pg_constraint
      where conname = 'trades_contract_side_check'
        and conrelid = to_regclass(${`${postgres.schema}.trades`})
    `.execute(postgres.db);
    expect(rows[0]!.definition).not.toContain("long");

    const up = await migrator.migrateToLatest();
    expect(up.error).toBeUndefined();
    expect(await relationExists("listings")).toBe(true);
  });
});
