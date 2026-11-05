import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createPostgresTestDatabase,
  migrateTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

/** Migration 020: the marks index's tables, their enums and the write rules they hold. */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Marks index schema (${TEST_DATABASE_SKIP_REASON})`
    : "Marks index schema";

const SHA = "a".repeat(64);

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
  }, 30_000);

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  beforeEach(async () => {
    await resetPostgresTestDatabase(postgres.db);
  });

  async function document(overrides: Record<string, unknown> = {}) {
    return postgres.db
      .insertInto("source_documents")
      .values({
        source_class: "nport",
        source_rank: 2,
        accession: "0000035402-26-006778",
        document_url:
          "https://www.sec.gov/Archives/edgar/data/707823/000003540226006778/primary_doc.xml",
        filer_cik: "707823",
        filer_name: "Fidelity Mt. Vernon Street Trust",
        fetched_at: new Date(),
        content_sha256: SHA,
        parser_version: "nport-0.1.0",
        ...overrides,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
  }

  async function issuer() {
    return postgres.db
      .insertInto("issuers")
      .values({
        slug: "anthropic",
        name: "Anthropic",
        search_phrases: JSON.stringify(["Anthropic"]),
        match_pattern: "\\bAnthropic\\b",
        watchlisted: true,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
  }

  function mark(documentId: string, issuerId: string, overrides: Record<string, unknown> = {}) {
    return postgres.db
      .insertInto("filer_marks")
      .values({
        document_id: documentId,
        issuer_id: issuerId,
        holding_index: 0,
        holding_name: "ANTHROPIC PBC",
        holding_title: "ANTHROPIC PBC SERIES F-1 PC PP",
        security_label: "Series F-1 Preferred",
        security_kind: "preferred",
        balance: "1000",
        units: "NS",
        value_usd: "777530",
        mark_per_share_usd: "777.53",
        as_of: "2026-08-31",
        ...overrides,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
  }

  it("creates every table of the v2 data model with its read-path indexes", async () => {
    for (const table of [
      "issuers",
      "source_documents",
      "filer_marks",
      "prints",
      "certificates",
      "certificate_series",
      "spv_vehicles",
      "spv_quotes",
      "corrections",
      "ingest_runs",
    ]) {
      const found = await sql<{ present: boolean }>`
        select to_regclass(${`${postgres.schema}.${table}`}) is not null as present
      `.execute(postgres.db);
      expect(found.rows[0]?.present, table).toBe(true);
    }
    const indexes = await sql<{ indexname: string }>`
      select indexname from pg_indexes where schemaname = ${postgres.schema}
    `.execute(postgres.db);
    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining(["filer_marks_issuer_label_as_of", "source_documents_class_filed"]),
    );
  });

  it("holds the enums and the per-share rule", async () => {
    await expect(document({ source_class: "forge" })).rejects.toThrow(/check constraint/);
    const { id: documentId } = await document();
    const { id: issuerId } = await issuer();
    await expect(mark(documentId, issuerId, { security_kind: "token" })).rejects.toThrow(
      /check constraint/,
    );
    await expect(
      mark(documentId, issuerId, { units: "PA", mark_per_share_usd: "1.00" }),
    ).rejects.toThrow(/filer_marks_per_share/);
    await expect(
      mark(documentId, issuerId, { balance: "0", mark_per_share_usd: "1.00" }),
    ).rejects.toThrow(/filer_marks_per_share/);
    const first = await mark(documentId, issuerId);
    await expect(mark(documentId, issuerId)).rejects.toThrow(/filer_marks_document_issuer_holding/);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    const stored = await postgres.db
      .selectFrom("filer_marks")
      .select(["mark_per_share_usd", "value_usd"])
      .executeTakeFirstOrThrow();
    expect(stored).toEqual({ mark_per_share_usd: "777.53", value_usd: "777530" });
  });

  it("keeps documents append-only and lets a mark change only by being superseded once", async () => {
    const { id: documentId } = await document();
    const { id: issuerId } = await issuer();
    const old = await mark(documentId, issuerId);
    const replacement = await mark(documentId, issuerId, { holding_index: 1 });

    await expect(
      postgres.db
        .updateTable("source_documents")
        .set({ filer_name: "x" } as never)
        .where("id", "=", documentId)
        .execute(),
    ).rejects.toThrow(/append-only/);
    await expect(
      postgres.db.deleteFrom("source_documents").where("id", "=", documentId).execute(),
    ).rejects.toThrow(/append-only/);
    await expect(
      postgres.db
        .updateTable("filer_marks")
        .set({ value_usd: "1" } as never)
        .where("id", "=", old.id)
        .execute(),
    ).rejects.toThrow(/only by being superseded/);

    await postgres.db
      .updateTable("filer_marks")
      .set({ superseded_by: replacement.id })
      .where("id", "=", old.id)
      .execute();
    await expect(
      postgres.db
        .updateTable("filer_marks")
        .set({ superseded_by: old.id })
        .where("id", "=", old.id)
        .execute(),
    ).rejects.toThrow(/only by being superseded/);
    await expect(
      postgres.db.deleteFrom("filer_marks").where("id", "=", replacement.id).execute(),
    ).rejects.toThrow(/only by being superseded/);
  });

  it("records a state of incorporation only with its filing", async () => {
    await expect(
      postgres.db
        .insertInto("issuers")
        .values({
          slug: "spacex",
          name: "SpaceX",
          search_phrases: JSON.stringify(["SpaceX"]),
          match_pattern: "SpaceX",
          incorporation_state: "DE",
        })
        .execute(),
    ).rejects.toThrow(/issuers_incorporation_sourced/);
    await expect(
      postgres.db
        .insertInto("issuers")
        .values({
          slug: "Bad Slug",
          name: "x",
          search_phrases: JSON.stringify([]),
          match_pattern: "x",
        })
        .execute(),
    ).rejects.toThrow(/check constraint/);
  });

  it("requires a finished run to say when, and a failed one to say why", async () => {
    await expect(
      postgres.db
        .insertInto("ingest_runs")
        .values({ source_class: "nport", status: "ok" })
        .execute(),
    ).rejects.toThrow(/ingest_runs_finished/);
    await expect(
      postgres.db
        .insertInto("ingest_runs")
        .values({ source_class: "nport", status: "failed", finished_at: new Date() })
        .execute(),
    ).rejects.toThrow(/ingest_runs_failed_has_error/);
    await postgres.db
      .insertInto("ingest_runs")
      .values({ source_class: "nport", status: "running" })
      .execute();
  });

  it("matches an SPV to an issuer or says it is unmatched", async () => {
    const { id: documentId } = await document({
      source_class: "form_d",
      accession: "0001234567-26-000001",
      document_url: "https://www.sec.gov/Archives/edgar/data/1/000123456726000001/primary_doc.xml",
    });
    await expect(
      postgres.db
        .insertInto("spv_vehicles")
        .values({
          document_id: documentId,
          vehicle_name: "Example SPV LLC",
          vehicle_cik: "1",
          match_method: "alias",
        })
        .execute(),
    ).rejects.toThrow(/spv_vehicles_matched/);
  });

  it("migrates down and back up", async () => {
    const down = await migrateTestDatabase(postgres, "019_tournament_proposed_by");
    expect(down.error).toBeUndefined();
    const gone = await sql<{ present: boolean }>`
      select to_regclass(${`${postgres.schema}.filer_marks`}) is not null as present
    `.execute(postgres.db);
    expect(gone.rows[0]?.present).toBe(false);
    const up = await migrateTestDatabase(postgres, "latest");
    expect(up.error).toBeUndefined();
  });
});
