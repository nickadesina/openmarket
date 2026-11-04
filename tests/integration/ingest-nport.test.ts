import { readFileSync } from "node:fs";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { SecClient } from "../../src/lib/ingest/fetch/sec.js";
import { parseWatchlist } from "../../src/lib/ingest/parse/watchlist.js";
import { ingestNport, type NportCandidate } from "../../src/lib/services/index/ingest-nport.js";
import {
  INGEST_HISTORY_START,
  incrementalSince,
  runScheduledIngest,
} from "../../src/lib/services/index/run-scheduled-ingest.js";
import { syncWatchlist } from "../../src/lib/services/index/sync-watchlist.js";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

/**
 * N-PORT ingest against PostgreSQL with the fetcher injected: real filings,
 * trimmed (tests/fixtures/index/README.md), and no network.
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `N-PORT ingest PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "N-PORT ingest PostgreSQL integration";

const ARCHIVES = "https://www.sec.gov/Archives/edgar/data";
const fixture = (name: string) => readFileSync(`tests/fixtures/index/${name}`, "utf8");

const FIDELITY: NportCandidate = {
  url: `${ARCHIVES}/707823/000003540226006778/primary_doc.xml`,
  accession: "0000035402-26-006778",
  cik: "707823",
  filerName: "FIDELITY MT VERNON STREET TRUST",
  form: "NPORT-P",
  filedOn: "2026-10-26",
  issuerSlugs: ["anthropic"],
};
const ORIGINAL: NportCandidate = {
  url: `${ARCHIVES}/719608/000114554922024223/primary_doc.xml`,
  accession: "0001145549-22-024223",
  cik: "719608",
  filerName: "NEW ECONOMY FUND",
  form: "NPORT-P",
  filedOn: "2022-04-27",
  issuerSlugs: ["epic-games"],
};
const AMENDMENT: NportCandidate = {
  url: `${ARCHIVES}/719608/000114554922028055/primary_doc.xml`,
  accession: "0001145549-22-028055",
  cik: "719608",
  filerName: "NEW ECONOMY FUND",
  form: "NPORT-P/A",
  filedOn: "2022-05-19",
  issuerSlugs: ["epic-games"],
};

const DOCUMENTS = new Map([
  [FIDELITY.url, fixture("nport-0000035402-26-006778.xml")],
  [ORIGINAL.url, fixture("nport-719608-000114554922024223.xml")],
  [AMENDMENT.url, fixture("nport-719608-000114554922028055.xml")],
]);

function stubClient(fetched: string[] = []): SecClient {
  return {
    userAgent: "test",
    async text(url) {
      fetched.push(url);
      const text = DOCUMENTS.get(url);
      if (text === undefined) throw new Error(`404 from ${url}`);
      return text;
    },
    async json() {
      throw new Error("the search is not called when candidates are given");
    },
  };
}

const RUN = { since: "2019-01-01", until: "2026-11-04" } as const;

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
  });

  async function marks() {
    return postgres.db
      .selectFrom("filer_marks")
      .innerJoin("source_documents", "source_documents.id", "filer_marks.document_id")
      .innerJoin("issuers", "issuers.id", "filer_marks.issuer_id")
      .select([
        "filer_marks.id",
        "issuers.slug",
        "source_documents.accession",
        "filer_marks.holding_index",
        "filer_marks.security_label",
        "filer_marks.value_usd",
        "filer_marks.balance",
        "filer_marks.mark_per_share_usd",
        "filer_marks.as_of",
        "filer_marks.superseded_by",
      ])
      .orderBy("source_documents.accession")
      .orderBy("filer_marks.holding_index")
      .execute();
  }

  it("stores each document once and each matching holding as filed", async () => {
    const report = await ingestNport(postgres.db, stubClient(), {
      ...RUN,
      candidates: [ORIGINAL, AMENDMENT, FIDELITY],
    });
    expect(report).toMatchObject({
      status: "ok",
      error: null,
      documentsSeen: 3,
      documentsNew: 3,
      marksNew: 5,
      supersededNew: 1,
    });
    expect(report.perIssuer.anthropic).toEqual({ documents: 1, marks: 3, perShareMarks: 3 });
    expect(report.perIssuer["epic-games"]).toEqual({ documents: 2, marks: 2, perShareMarks: 2 });

    const document = await postgres.db
      .selectFrom("source_documents")
      .selectAll()
      .where("accession", "=", FIDELITY.accession)
      .executeTakeFirstOrThrow();
    expect(document).toMatchObject({
      source_class: "nport",
      source_rank: 2,
      filer_cik: "707823",
      filer_name: "Fidelity Mt. Vernon Street Trust",
      fund_series_id: "S000081601",
      fund_series_name: "Fidelity Equity Growth K6 Fund",
      form_type: "NPORT-P",
      filed_on: "2026-10-26",
      period_end: "2026-08-31",
      parser_version: "nport-0.1.0",
    });
    expect(document.content_sha256).toMatch(/^[0-9a-f]{64}$/);

    const anthropic = (await marks()).filter((row) => row.slug === "anthropic");
    expect(anthropic.map((row) => row.security_label)).toEqual([
      "Series G-1 Preferred",
      "Series F-1 Preferred",
      "Series H-1 Preferred",
    ]);
    expect(anthropic[0]).toMatchObject({
      holding_index: 2,
      value_usd: "1710566.00000000",
      balance: "2200.00000000",
      as_of: "2026-08-31",
      superseded_by: null,
    });
    // 1,710,566 / 2,200 in numeric arithmetic, never a float.
    expect(anthropic[0]!.mark_per_share_usd).toMatch(/^777\.530*$/);

    const runs = await postgres.db.selectFrom("ingest_runs").selectAll().execute();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      source_class: "nport",
      status: "ok",
      documents_seen: 3,
      documents_new: 3,
      marks_new: 5,
      error: null,
    });
  });

  it("supersedes the original's marks with the amendment's, in either order", async () => {
    for (const order of [
      [ORIGINAL, AMENDMENT],
      [AMENDMENT, ORIGINAL],
    ]) {
      await resetPostgresTestDatabase(postgres.db);
      await syncWatchlist(
        postgres.db,
        parseWatchlist(readFileSync("data/index/watchlist.json", "utf8")),
      );
      for (const candidate of order) {
        await ingestNport(postgres.db, stubClient(), { ...RUN, candidates: [candidate] });
      }
      const epic = (await marks()).filter((row) => row.slug === "epic-games");
      expect(epic).toHaveLength(2);
      const original = epic.find((row) => row.accession === ORIGINAL.accession)!;
      const amendment = epic.find((row) => row.accession === AMENDMENT.accession)!;
      expect(original.superseded_by).toBe(amendment.id);
      expect(amendment.superseded_by).toBeNull();
      expect(original.security_label).toBe("Common");
    }
  });

  it("is idempotent: a rerun fetches nothing it has and writes nothing twice", async () => {
    await ingestNport(postgres.db, stubClient(), {
      ...RUN,
      candidates: [FIDELITY, ORIGINAL, AMENDMENT],
    });
    const before = await marks();
    const fetched: string[] = [];
    const rerun = await ingestNport(postgres.db, stubClient(fetched), {
      ...RUN,
      candidates: [FIDELITY, ORIGINAL, AMENDMENT],
    });
    expect(fetched).toEqual([]);
    expect(rerun).toMatchObject({
      status: "ok",
      documentsSeen: 3,
      documentsSkipped: 3,
      documentsNew: 0,
      marksNew: 0,
    });
    expect(await marks()).toEqual(before);

    // A document the search attributes to an issuer with no mark from it yet
    // is read again; the stored rows are reused, not duplicated.
    const widened = await ingestNport(postgres.db, stubClient(fetched), {
      ...RUN,
      candidates: [{ ...FIDELITY, issuerSlugs: ["anthropic", "openai"] }],
    });
    expect(fetched).toEqual([FIDELITY.url]);
    expect(widened).toMatchObject({ documentsNew: 0, marksNew: 0 });
    expect(widened.phraseOnly).toEqual([{ url: FIDELITY.url, issuerSlug: "openai" }]);
    expect(await marks()).toEqual(before);
    const documents = await postgres.db.selectFrom("source_documents").select("id").execute();
    expect(documents).toHaveLength(3);
  });

  it("records what it could not read and stops cleanly at the deadline", async () => {
    const missing = { ...FIDELITY, url: `${ARCHIVES}/1/000000000126000001/primary_doc.xml` };
    const partial = await ingestNport(postgres.db, stubClient(), {
      ...RUN,
      candidates: [missing, ORIGINAL],
    });
    expect(partial.status).toBe("ok");
    expect(partial.failures).toEqual([{ url: missing.url, reason: `404 from ${missing.url}` }]);

    const stopped = await ingestNport(postgres.db, stubClient(), {
      ...RUN,
      candidates: [AMENDMENT, FIDELITY],
      deadlineMs: 0,
    });
    expect(stopped).toMatchObject({ status: "failed", documentsSeen: 0 });
    expect(stopped.error).toMatch(/stopped at the time limit with 2 documents left/);

    const runs = await postgres.db
      .selectFrom("ingest_runs")
      .select(["status", "error"])
      .orderBy("started_at")
      .execute();
    expect(runs.map((run) => run.status)).toEqual(["ok", "failed"]);
    expect(runs[0]!.error).toMatch(/^1 documents unread/);
  });

  it("runs incrementally from a week before the last ok run", async () => {
    expect(await incrementalSince(postgres.db, "nport")).toBe(INGEST_HISTORY_START);
    const searched: URLSearchParams[] = [];
    const empty: SecClient = {
      userAgent: "test",
      text: async () => {
        throw new Error("nothing to fetch");
      },
      json: async (url) => {
        searched.push(new URL(url).searchParams);
        return { hits: { total: { value: 0, relation: "eq" }, hits: [] } };
      },
    };
    const startedAt = new Date("2026-11-04T07:23:00Z");
    const first = await runScheduledIngest(postgres.db, {
      startedAt,
      client: empty,
      now: () => startedAt,
    });
    expect(
      first.sources.map(({ source, since, report }) => [source, since, report.status]),
    ).toEqual([["nport", INGEST_HISTORY_START, "ok"]]);
    // Every watchlisted name's phrases, NPORT-P only, through the run's day.
    expect(new Set(searched.map((params) => params.get("forms")))).toEqual(new Set(["NPORT-P"]));
    expect(new Set(searched.map((params) => params.get("enddt")))).toEqual(new Set(["2026-11-04"]));
    expect(await incrementalSince(postgres.db, "nport")).toBe("2026-10-28");
  });
});
