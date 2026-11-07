import { readFileSync } from "node:fs";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { parseFilerFamilies } from "../../src/lib/engine/index/families.js";
import { METHODOLOGY } from "../../src/lib/engine/index/methodology.js";
import { parseWatchlist } from "../../src/lib/ingest/parse/watchlist.js";
import {
  ingestNportDocument,
  loadIndexIssuers,
} from "../../src/lib/services/index/ingest-nport.js";
import { recordMethodologyCorrection } from "../../src/lib/services/index/record-correction.js";
import { getRefCorrections } from "../../src/lib/services/index/ref-corrections.js";
import { syncWatchlist } from "../../src/lib/services/index/sync-watchlist.js";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

/**
 * A methodology change published as a correction: one `corrections` row of
 * kind `methodology` under the new version, with the diff and every
 * watchlisted name's headline recomputed under it; a rerun writes nothing.
 * The marks come from a real N-PORT (tests/fixtures/index/README.md).
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Methodology corrections (${TEST_DATABASE_SKIP_REASON})`
    : "Methodology corrections";

const FAMILIES = parseFilerFamilies({ version: "test", families: [] });
const DIFF = readFileSync("docs/corrections/methodology-0.2.0.md", "utf8");

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
    await ingestNportDocument(
      postgres.db,
      {
        url: "https://www.sec.gov/Archives/edgar/data/707823/000003540226006778/primary_doc.xml",
        accession: "0000035402-26-006778",
        cik: "707823",
        filerName: "FIDELITY MT VERNON STREET TRUST",
        form: "NPORT-P",
        filedOn: "2026-10-26",
        issuerSlugs: ["anthropic"],
      },
      readFileSync("tests/fixtures/index/nport-0000035402-26-006778.xml", "utf8"),
      await loadIndexIssuers(postgres.db, ["anthropic"]),
      new Date("2026-11-04T00:00:00Z"),
    );
  });

  const input = {
    version: METHODOLOGY.methodology_version,
    summary: "Families are compared on one as-of date, from three.",
    diffMd: DIFF,
    diffPath: "docs/corrections/methodology-0.2.0.md",
    families: FAMILIES,
    now: () => new Date("2026-11-07T12:00:00Z"),
  };

  it("publishes one methodology correction per version, idempotently", async () => {
    const first = await recordMethodologyCorrection(postgres.db, input);
    expect(first.status).toBe("inserted");
    const again = await recordMethodologyCorrection(postgres.db, input);
    expect(again).toMatchObject({ status: "exists" });
    expect(again.correctionId).toBe(first.correctionId);

    const { corrections } = await getRefCorrections(
      postgres.db,
      { limit: 10 },
      { now: new Date("2026-11-07T12:00:00Z") },
    );
    expect(corrections).toHaveLength(1);
    const [correction] = corrections;
    expect(correction).toMatchObject({
      kind: "methodology",
      methodology_version: METHODOLOGY.methodology_version,
      published_at: "2026-11-07T12:00:00.000000Z",
      diff_md: DIFF,
      rows_written: { filer_marks: 0, certificates: 0 },
    });
    const affected = correction!.affected as {
      constants: Record<string, unknown>;
      headlines: { slug: string; no_headline: string | null }[];
    };
    expect(affected.constants).toEqual({ ...METHODOLOGY });
    // Fidelity alone marks Anthropic in this filing: one family, no headline.
    expect(affected.headlines.find((row) => row.slug === "anthropic")).toMatchObject({
      no_headline: "too_few_families",
    });
  });

  it("refuses a version other than the one in force", async () => {
    await expect(
      recordMethodologyCorrection(postgres.db, { ...input, version: "0.1.0" }),
    ).rejects.toThrow(/not the methodology in force/);
  });
});
