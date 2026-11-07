import { readFileSync } from "node:fs";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { parseWatchlist } from "../../src/lib/ingest/parse/watchlist.js";
import {
  ingestNportDocument,
  loadIndexIssuers,
} from "../../src/lib/services/index/ingest-nport.js";
import { relabelMarks } from "../../src/lib/services/index/relabel-marks.js";
import { syncWatchlist } from "../../src/lib/services/index/sync-watchlist.js";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

/**
 * A label correction: rows read by one classifier, re-read by another, are
 * corrected as new rows with a `parser` correction, never edited in place.
 * The rows come from a real N-PORT (tests/fixtures/index/README.md) through
 * the ingest service.
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Label corrections (${TEST_DATABASE_SKIP_REASON})`
    : "Label corrections";

const URL_ = "https://www.sec.gov/Archives/edgar/data/707823/000003540226006778/primary_doc.xml";

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
    await syncWatchlist(
      postgres.db,
      parseWatchlist(readFileSync("data/index/watchlist.json", "utf8")),
    );
    const issuers = await loadIndexIssuers(postgres.db, ["anthropic"]);
    await ingestNportDocument(
      postgres.db,
      {
        url: URL_,
        accession: "0000035402-26-006778",
        cik: "707823",
        filerName: "FIDELITY MT VERNON STREET TRUST",
        form: "NPORT-P",
        filedOn: "2026-10-26",
        issuerSlugs: ["anthropic"],
      },
      readFileSync("tests/fixtures/index/nport-0000035402-26-006778.xml", "utf8"),
      issuers,
      new Date("2026-11-04T00:00:00Z"),
    );
  });

  async function live() {
    return postgres.db
      .selectFrom("filer_marks")
      .select([
        "id",
        "holding_index",
        "security_label",
        "security_kind",
        "mark_per_share_usd",
        "value_usd",
        "correction_id",
      ])
      .where("superseded_by", "is", null)
      .orderBy("holding_index")
      .execute();
  }

  it("writes nothing when every live row reads as stored", async () => {
    const report = await relabelMarks(postgres.db);
    expect(report).toMatchObject({ liveRows: 3, changedRows: 0, correctionId: null });
    const corrections = await postgres.db.selectFrom("corrections").selectAll().execute();
    expect(corrections).toEqual([]);
  });

  it("corrects a reading with new rows, a parser correction and superseded old rows", async () => {
    const asFiled = await live();
    expect(asFiled.map((row) => row.security_label)).toContain("Series F-1 Preferred");

    const coarse = await relabelMarks(postgres.db, {
      classify: () => ({ label: "Unclassified", kind: "unknown" }),
      parser: "a test classifier",
      now: () => new Date("2026-11-05T00:00:00Z"),
    });
    expect(coarse.changedRows).toBe(3);
    const correction = await postgres.db
      .selectFrom("corrections")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(correction).toMatchObject({ kind: "parser", methodology_version: "0.2.0" });
    expect(correction.diff_md).toContain("| anthropic | Series F-1 Preferred (preferred) |");

    const corrected = await live();
    expect(corrected.every((row) => row.correction_id === correction.id)).toBe(true);
    expect(corrected.map((row) => row.security_label)).toEqual([
      "Unclassified",
      "Unclassified",
      "Unclassified",
    ]);
    // The filer's figures are copied as filed.
    expect(corrected.map((row) => [row.value_usd, row.mark_per_share_usd])).toEqual(
      asFiled.map((row) => [row.value_usd, row.mark_per_share_usd]),
    );
    const old = await postgres.db
      .selectFrom("filer_marks")
      .select(["id", "superseded_by"])
      .where(
        "id",
        "in",
        asFiled.map((row) => row.id),
      )
      .execute();
    expect(old.every((row) => row.superseded_by !== null)).toBe(true);

    // The methodology's classifier reads them back, as a second correction; then nothing.
    const back = await relabelMarks(postgres.db);
    expect(back.changedRows).toBe(3);
    expect((await live()).map((row) => row.security_label)).toEqual(
      asFiled.map((row) => row.security_label),
    );
    expect((await relabelMarks(postgres.db)).changedRows).toBe(0);
    expect(await postgres.db.selectFrom("filer_marks").select("id").execute()).toHaveLength(9);
  });

  it("does not re-insert a corrected holding when its filing is ingested again", async () => {
    await relabelMarks(postgres.db, {
      classify: () => ({ label: "Unclassified", kind: "unknown" }),
    });
    const issuers = await loadIndexIssuers(postgres.db, ["anthropic"]);
    const outcome = await ingestNportDocument(
      postgres.db,
      {
        url: URL_,
        accession: "0000035402-26-006778",
        cik: "707823",
        filerName: "FIDELITY MT VERNON STREET TRUST",
        form: "NPORT-P",
        filedOn: "2026-10-26",
        issuerSlugs: ["anthropic"],
      },
      readFileSync("tests/fixtures/index/nport-0000035402-26-006778.xml", "utf8"),
      issuers,
      new Date("2026-11-06T00:00:00Z"),
    );
    expect(outcome.marksByIssuer.get("anthropic")?.marks).toBe(0);
    expect(await live()).toHaveLength(3);
  });
});
