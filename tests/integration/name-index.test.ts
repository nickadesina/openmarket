import { readFileSync } from "node:fs";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { parseFilerFamilies } from "../../src/lib/engine/index/families.js";
import { parseCertificate } from "../../src/lib/ingest/parse/certificate.js";
import { parseWatchlist } from "../../src/lib/ingest/parse/watchlist.js";
import { getNameIndex } from "../../src/lib/services/index/get-name-index.js";
import {
  importCertificate,
  linkCertificatePrints,
} from "../../src/lib/services/index/import-certificates.js";
import { importPrints, printCandidates } from "../../src/lib/services/index/import-prints.js";
import {
  type FormDCandidate,
  ingestFormDDocument,
} from "../../src/lib/services/index/ingest-form-d.js";
import {
  ingestNportDocument,
  loadIndexIssuers,
} from "../../src/lib/services/index/ingest-nport.js";
import { listNames } from "../../src/lib/services/index/list-names.js";
import { syncWatchlist } from "../../src/lib/services/index/sync-watchlist.js";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

/**
 * The read services against PostgreSQL, with rows written by the import
 * services from real documents (tests/fixtures/index/README.md) and the
 * real round-history files. The certificate is the schema fixture's
 * invented issuer `example-co` (tests/fixtures/certificates/README.md), with
 * an invented round for it to price; no real certificate is in the tree.
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Name index read services (${TEST_DATABASE_SKIP_REASON})`
    : "Name index read services";

const fixture = (path: string) => readFileSync(path, "utf8");
const FAMILIES = parseFilerFamilies({ version: "test", families: [] });
const NOW = () => new Date("2026-11-05T12:00:00Z");
const CERTIFICATE_PATH = "tests/fixtures/certificates/example-co/2026-01-15.json";

/** The real watchlist, plus the schema fixture's invented issuer. */
function watchlistText(): string {
  const file = JSON.parse(fixture("data/index/watchlist.json")) as { names: unknown[] };
  file.names.push({
    slug: "example-co",
    name: "Example Co",
    legal_name: "Example Co, Inc.",
    search_phrases: ["Example Co"],
    match_pattern: "\\bExample Co\\b",
  });
  return JSON.stringify(file);
}

function formD(accession: string, cik: string, filedOn: string, foundBy: string): FormDCandidate {
  return {
    url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replaceAll("-", "")}/primary_doc.xml`,
    accession,
    cik,
    filerName: "",
    form: "D",
    filedOn,
    foundBy: [foundBy],
  };
}

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
  }, 30_000);

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  beforeEach(async () => {
    const db = postgres.db;
    await resetPostgresTestDatabase(db);
    await syncWatchlist(db, parseWatchlist(watchlistText()));
    const issuers = await loadIndexIssuers(db);
    await ingestNportDocument(
      db,
      {
        url: "https://www.sec.gov/Archives/edgar/data/707823/000003540226006778/primary_doc.xml",
        accession: "0000035402-26-006778",
        cik: "707823",
        filerName: "FIDELITY MT VERNON STREET TRUST",
        form: "NPORT-P",
        filedOn: "2026-10-26",
        issuerSlugs: ["anthropic"],
      },
      fixture("tests/fixtures/index/nport-0000035402-26-006778.xml"),
      issuers,
      NOW(),
    );
    const { candidates } = printCandidates(
      fixture("data/round-history/events.csv"),
      fixture("data/round-history/sources.csv"),
      issuers,
    );
    await importPrints(db, candidates);
    await ingestFormDDocument(
      db,
      formD("0002136346-26-000001", "2136346", "2026-05-26", "anthropic"),
      fixture("tests/fixtures/index/form-d-0002136346-26-000001.xml"),
      issuers,
      NOW(),
    );
    await ingestFormDDocument(
      db,
      formD("0001493152-24-009735", "2014185", "2024-03-13", "figure-ai"),
      fixture("tests/fixtures/index/form-d-0001493152-24-009735.xml"),
      issuers,
      NOW(),
    );
  });

  it("serves one name: labels, family marks with their filing, prints and SPVs", async () => {
    const index = await getNameIndex(postgres.db, "anthropic", { families: FAMILIES, now: NOW });
    expect(index).toMatchObject({
      methodology_version: "0.2.0",
      ce_version: "0.1.0",
      rulebook_version: "2.1.0",
      as_of: "2026-11-05T12:00:00.000Z",
      issuer: { slug: "anthropic", listed_on: null },
      marks_summary: { live: 3, in_series: 3, after_listing: 0, latest_as_of: "2026-08-31" },
      structure: null,
    });
    expect(index!.labels.map((label) => label.security_label)).toEqual([
      "Series F-1 Preferred",
      "Series G-1 Preferred",
      "Series H-1 Preferred",
    ]);
    const f1 = index!.labels[0]!;
    expect(f1.consensus).toHaveLength(1);
    // One family on the date: its mark is published, with no consensus (METHODOLOGY.md, three families).
    expect(f1.consensus[0]).toMatchObject({
      as_of: "2026-08-31",
      consensus_usd: null,
      n_families: 1,
      dispersion: null,
      mark_vs_print: { status: "none", reason: "no_consensus" },
    });
    expect(f1.family_marks[0]!.mark_vs_print).toEqual({
      status: "none",
      reason: "no_certificate_price",
    });
    expect(index!.headline).toBeNull();
    expect(index!.no_headline).toEqual({
      code: "too_few_families",
      reason:
        "No as-of date has 3 families on one security; the most is 1 family (Series F-1 Preferred, 2026-08-31).",
    });
    expect(f1.family_marks[0]!.documents[0]).toMatchObject({
      accession: "0000035402-26-006778",
      holding_title: "ANTHROPIC PBC SERIES F-1 PC PP",
      balance: "1000.00000000",
      value_usd: "777530.00000000",
    });
    // The latest priced round in events.csv on or before the payload's date.
    expect(index!.last_print).toMatchObject({ round_name: "Series H", event_type: "priced_round" });
    expect(index!.prints.every((print) => print.origin === "events.csv")).toBe(true);
    expect(index!.spv.vehicles).toHaveLength(1);
    expect(index!.spv.vehicles[0]).toMatchObject({
      vehicle_name: "Granada Anthropic SPV, a Series of Decile SPV, LLC",
      vehicle_cik: "2136346",
      match_method: "alias",
      latest_filing: { total_sold_usd: "1099001", first_sale_on: "2026-05-07" },
      n_filings: 1,
    });
    expect(index!.spv.vehicles[0]!.match_note).toContain('"Anthropic"');
    expect(await getNameIndex(postgres.db, "no-such-name", { families: FAMILIES })).toBeNull();
  });

  it("records an issuer's own Form D as its state and as round evidence", async () => {
    const index = await getNameIndex(postgres.db, "figure-ai", { families: FAMILIES, now: NOW });
    expect(index!.issuer.incorporation_state).toBe("DELAWARE");
    expect(index!.issuer.incorporation_source?.accession).toBe("0001493152-24-009735");
    expect(index!.prints).toEqual([
      expect.objectContaining({
        round_name: "Form D offering, first sale 2024-02-27",
        event_type: "form_d_offering",
        amount_raised_usd: "674981967",
        origin: "form_d",
      }),
    ]);
    // Form D evidence is not a print.
    expect(index!.last_print).toBeNull();
  });

  it("imports prints idempotently", async () => {
    const issuers = await loadIndexIssuers(postgres.db);
    const { candidates } = printCandidates(
      fixture("data/round-history/events.csv"),
      fixture("data/round-history/sources.csv"),
      issuers,
    );
    const again = await importPrints(postgres.db, candidates);
    expect(again).toMatchObject({ inserted: 0, unchanged: candidates.length, differing: [] });
  });

  it("imports a certificate, links the round it prices, and corrects a changed transcription", async () => {
    const text = fixture(CERTIFICATE_PATH);
    const certificate = parseCertificate(text, CERTIFICATE_PATH);
    expect((await importCertificate(postgres.db, certificate, text, NOW)).status).toBe("new");
    expect((await importCertificate(postgres.db, certificate, text, NOW)).status).toBe("unchanged");

    // An invented round for the invented issuer, 30 days after the filing.
    await importPrints(postgres.db, [
      {
        issuerSlug: "example-co",
        roundName: "Series B (schema fixture)",
        eventType: "priced_round",
        announcedOn: "2026-02-14",
        postMoneyUsd: "100000000",
        amountRaisedUsd: "20000000",
        sourceUrl: null,
        sourceRank: null,
      },
    ]);
    const links = await linkCertificatePrints(postgres.db);
    expect(links).toEqual([
      expect.objectContaining({
        issuer: "example-co",
        reason: "linked",
        seriesLabel: "Series B Preferred",
      }),
    ]);
    expect((await linkCertificatePrints(postgres.db))[0]!.reason).toBe("already_linked");

    const index = await getNameIndex(postgres.db, "example-co", { families: FAMILIES, now: NOW });
    expect(index!.last_print).toMatchObject({
      series_label: "Series B Preferred",
      price_per_share_usd: "4.00",
    });
    expect(index!.structure?.certificate.series).toHaveLength(2);
    expect(index!.structure?.common_equivalent.status).toBe("ok");
    expect(index!.structure?.structure_gap).toMatchObject({ status: "ok", basis: "authorized" });

    const changed = text.replace('"liquidation_multiple": "1",', '"liquidation_multiple": "2",');
    const corrected = await importCertificate(
      postgres.db,
      parseCertificate(changed, CERTIFICATE_PATH),
      changed,
      NOW,
    );
    expect(corrected.status).toBe("corrected");
    const rows = await postgres.db
      .selectFrom("certificates")
      .select(["id", "superseded_by", "correction_id"])
      .execute();
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.superseded_by === null)).toEqual([
      expect.objectContaining({ id: corrected.certificateId }),
    ]);
    const correction = await postgres.db
      .selectFrom("corrections")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(correction.kind).toBe("row");
    const after = await getNameIndex(postgres.db, "example-co", { families: FAMILIES, now: NOW });
    expect(after!.structure?.certificate.series[0]?.liquidation_multiple).toBe("2");
  });

  it("lists every watchlisted name with its headline", async () => {
    const list = await listNames(postgres.db, { families: FAMILIES, now: NOW });
    expect(list.methodology_version).toBe("0.2.0");
    const anthropic = list.names.find((name) => name.slug === "anthropic");
    // Fidelity alone marks Anthropic here: one family, so no headline, and the row says why.
    expect(anthropic).toMatchObject({
      security_label: null,
      as_of: null,
      consensus_usd: null,
      n_families: null,
      dispersion_pct: null,
      no_headline: { code: "too_few_families" },
      latest_filed_on: "2026-10-26",
      live_marks: 3,
      labels: 3,
      spv_vehicles: 1,
    });
    const openai = list.names.find((name) => name.slug === "openai");
    expect(openai).toMatchObject({
      security_label: null,
      live_marks: 0,
      spv_vehicles: 0,
      no_headline: { code: "no_marks" },
    });
    expect(openai!.last_print).not.toBeNull();
  });
});
