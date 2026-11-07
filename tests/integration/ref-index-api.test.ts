import { readFileSync } from "node:fs";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SecClient } from "../../src/lib/ingest/fetch/sec.js";
import { parseCertificate } from "../../src/lib/ingest/parse/certificate.js";
import { parseWatchlist } from "../../src/lib/ingest/parse/watchlist.js";
import {
  CERTIFICATE_TERMS_COLUMNS,
  FILER_MARKS_COLUMNS,
  filerMarksCsv,
  SPV_MATCHES_COLUMNS,
} from "../../src/lib/services/index/data-csv.js";
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
  ingestNport,
  loadIndexIssuers,
  type NportCandidate,
} from "../../src/lib/services/index/ingest-nport.js";
import { noMarksReason } from "../../src/lib/services/index/name-coverage.js";
import { PUBLISHED_FILER_FAMILIES } from "../../src/lib/services/index/published-families.js";
import { ENVELOPE_KEYS } from "../../src/lib/services/index/ref-envelope.js";
import { syncWatchlist } from "../../src/lib/services/index/sync-watchlist.js";
import { parseCsv } from "../../src/lib/tradeables/csv.js";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

const runtime = vi.hoisted(() => ({ getRuntimeDatabase: vi.fn() }));
vi.mock("../../src/lib/db/runtime.js", () => runtime);
vi.mock("../../src/lib/logging/server-log.js", () => ({
  logReadRequest: vi.fn(),
  logMutationRequest: vi.fn(),
  logUnexpectedError: vi.fn(),
}));

import { GET as marksRoute } from "../../src/app/api/ref/[slug]/marks/route.js";
import { GET as revisionsRoute } from "../../src/app/api/ref/[slug]/revisions/route.js";
import { GET as nameRoute } from "../../src/app/api/ref/[slug]/route.js";
import { GET as spvRoute } from "../../src/app/api/ref/[slug]/spv/route.js";
import { GET as correctionsRoute } from "../../src/app/api/ref/corrections/route.js";
import { GET as methodologyRoute } from "../../src/app/api/ref/methodology/route.js";
import { GET as namesRoute } from "../../src/app/api/ref/names/route.js";
import { GET as certificateTermsCsv } from "../../src/app/data/certificate-terms.csv/route.js";
import { GET as filerMarksCsvRoute } from "../../src/app/data/filer-marks.csv/route.js";
import { GET as spvMatchesCsv } from "../../src/app/data/spv-matches.csv/route.js";
import { generateApiKey, hashApiKey } from "../../src/lib/auth/api-key.js";
import { METHODOLOGY } from "../../src/lib/engine/index/methodology.js";
import { insertApiKey } from "../../src/lib/services/ref-access.js";

/**
 * The index's reference routes and CSV downloads against PostgreSQL, with
 * rows written by the import services from real EDGAR documents
 * (tests/fixtures/index/README.md: Fidelity's N-PORT with three Anthropic
 * holdings, New Economy Fund's N-PORT and its amendment on Epic Games, two
 * Form Ds) and the real round-history files. The certificate is the schema
 * fixture's invented issuer `example-co` (tests/fixtures/certificates/README.md),
 * corrected twice so the corrections route has rows; no real certificate is
 * in the tree.
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Index reference API (${TEST_DATABASE_SKIP_REASON})`
    : "Index reference API";

const fixture = (path: string) => readFileSync(path, "utf8");
const ORIGIN = "https://openmkt.test";
const ARCHIVES = "https://www.sec.gov/Archives/edgar/data";
const NOW = () => new Date("2026-11-05T12:00:00Z");
const CERTIFICATE_PATH = "tests/fixtures/certificates/example-co/2026-01-15.json";

const NPORT: readonly (NportCandidate & { readonly fixture: string })[] = [
  {
    url: `${ARCHIVES}/707823/000003540226006778/primary_doc.xml`,
    accession: "0000035402-26-006778",
    cik: "707823",
    filerName: "FIDELITY MT VERNON STREET TRUST",
    form: "NPORT-P",
    filedOn: "2026-10-26",
    issuerSlugs: ["anthropic"],
    fixture: "nport-0000035402-26-006778.xml",
  },
  {
    url: `${ARCHIVES}/719608/000114554922024223/primary_doc.xml`,
    accession: "0001145549-22-024223",
    cik: "719608",
    filerName: "NEW ECONOMY FUND",
    form: "NPORT-P",
    filedOn: "2022-04-27",
    issuerSlugs: ["epic-games"],
    fixture: "nport-719608-000114554922024223.xml",
  },
  {
    url: `${ARCHIVES}/719608/000114554922028055/primary_doc.xml`,
    accession: "0001145549-22-028055",
    cik: "719608",
    filerName: "NEW ECONOMY FUND",
    form: "NPORT-P/A",
    filedOn: "2022-05-19",
    issuerSlugs: ["epic-games"],
    fixture: "nport-719608-000114554922028055.xml",
  },
];

const client: SecClient = {
  userAgent: "test",
  async text(url) {
    const document = NPORT.find((candidate) => candidate.url === url);
    if (document === undefined) throw new Error(`404 from ${url}`);
    return fixture(`tests/fixtures/index/${document.fixture}`);
  },
  async json() {
    throw new Error("the search is not called when candidates are given");
  },
};

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
    url: `${ARCHIVES}/${cik}/${accession.replaceAll("-", "")}/primary_doc.xml`,
    accession,
    cik,
    filerName: "",
    form: "D",
    filedOn,
    foundBy: [foundBy],
  };
}

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, { headers });
}

function slug(value: string) {
  return { params: Promise.resolve({ slug: value }) };
}

// biome-ignore lint/suspicious/noExplicitAny: test payloads are read as JSON.
async function published(response: Response): Promise<any> {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
  const body = await response.json();
  expect(Object.keys(body).slice(0, ENVELOPE_KEYS.length)).toEqual([...ENVELOPE_KEYS]);
  expect(body).toMatchObject({
    methodology_version: "0.2.0",
    ce_version: "0.1.0",
    rulebook_version: "2.1.0",
  });
  return body;
}

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
    runtime.getRuntimeDatabase.mockImplementation(() => postgres.db);
  }, 30_000);

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  beforeEach(async () => {
    const db = postgres.db;
    await resetPostgresTestDatabase(db);
    await syncWatchlist(db, parseWatchlist(watchlistText()));
    for (const candidate of NPORT) {
      await ingestNport(db, client, {
        since: "2019-01-01",
        until: "2026-11-04",
        candidates: [candidate],
      });
    }
    const issuers = await loadIndexIssuers(db);
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
    // The schema fixture's certificate, then two corrected transcriptions of it.
    const text = fixture(CERTIFICATE_PATH);
    await importCertificate(db, parseCertificate(text, CERTIFICATE_PATH), text, NOW);
    for (const [index, multiple] of ["2", "3"].entries()) {
      const changed = text.replace(
        '"liquidation_multiple": "1",',
        `"liquidation_multiple": "${multiple}",`,
      );
      const at = () => new Date(NOW().getTime() + (index + 1) * 60_000);
      await importCertificate(db, parseCertificate(changed, CERTIFICATE_PATH), changed, at);
    }
    await linkCertificatePrints(db);
  }, 30_000);

  it("lists every watchlisted name under the published families", async () => {
    const body = await published(await namesRoute(get("/api/ref/names")));
    expect(body.families_version).toBe(PUBLISHED_FILER_FAMILIES.version);
    const anthropic = body.names.find((name: { slug: string }) => name.slug === "anthropic");
    expect(anthropic).toMatchObject({
      as_of: null,
      consensus_usd: null,
      n_families: null,
      dispersion_pct: null,
      no_headline: { code: "too_few_families" },
      latest_filed_on: "2026-10-26",
      live_marks: 3,
      spv_vehicles: 1,
    });
    // The amendment's row is the live one; the original's is superseded.
    const epic = body.names.find((name: { slug: string }) => name.slug === "epic-games");
    expect(epic).toMatchObject({ live_marks: 1, latest_filed_on: "2022-05-19" });
  });

  it("serves one name with every family mark's filing, and 404s an unknown slug", async () => {
    const body = await published(await nameRoute(get("/api/ref/anthropic"), slug("anthropic")));
    expect(body.issuer.slug).toBe("anthropic");
    // One family (Fidelity) marks it here: too few for a headline.
    expect(body.headline).toBeNull();
    expect(body.no_headline).toMatchObject({ code: "too_few_families" });
    for (const label of body.labels) {
      for (const mark of label.family_marks) {
        for (const document of mark.documents) {
          expect(document).toMatchObject({
            accession: "0000035402-26-006778",
            document_url: NPORT[0]!.url,
          });
        }
      }
    }

    const missing = await nameRoute(get("/api/ref/no-such-name"), slug("no-such-name"));
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    expect((await missing.json()).error.code).toBe("NAME_NOT_FOUND");
    for (const route of [marksRoute, revisionsRoute, spvRoute]) {
      const response = await route(get("/api/ref/no-such-name/x"), slug("no-such-name"));
      expect(response.status).toBe(404);
    }
    expect((await nameRoute(get("/api/ref/Bad_Slug"), slug("Bad_Slug"))).status).toBe(400);
  });

  it("pages a name's marks by keyset, every row with its document", async () => {
    const first = await published(
      await marksRoute(get("/api/ref/anthropic/marks?limit=2"), slug("anthropic")),
    );
    expect(first).toMatchObject({ include: "live", security_label: null });
    expect(first.marks).toHaveLength(2);
    expect(first.next_cursor).toEqual(expect.any(String));
    const second = await published(
      await marksRoute(
        get(`/api/ref/anthropic/marks?limit=2&cursor=${first.next_cursor}`),
        slug("anthropic"),
      ),
    );
    expect(second.marks).toHaveLength(1);
    expect(second.next_cursor).toBeNull();
    const all = [...first.marks, ...second.marks];
    expect(new Set(all.map((mark: { mark_id: string }) => mark.mark_id)).size).toBe(3);
    expect(all.map((mark: { security_label: string }) => mark.security_label).sort()).toEqual([
      "Series F-1 Preferred",
      "Series G-1 Preferred",
      "Series H-1 Preferred",
    ]);
    for (const mark of all) {
      expect(mark).toMatchObject({
        status: "live",
        superseded_by: null,
        series_status: "in_series",
        as_of: "2026-08-31",
        document: {
          source_class: "nport",
          source_rank: 2,
          accession: "0000035402-26-006778",
          document_url: NPORT[0]!.url,
          filer_cik: "707823",
          form_type: "NPORT-P",
        },
      });
      expect(mark.mark_per_share_usd).toMatch(/^777\.530*$/);
      expect(mark.family.family_slug).not.toMatch(/^cik-/);
    }

    const label = await published(
      await marksRoute(
        get("/api/ref/anthropic/marks?label=Series%20G-1%20Preferred"),
        slug("anthropic"),
      ),
    );
    expect(label.marks).toHaveLength(1);
    expect(label.marks[0].holding_title).toContain("G-1");

    const bad = await marksRoute(get("/api/ref/anthropic/marks?cursor=nope"), slug("anthropic"));
    expect(bad.status).toBe(400);
  });

  it("shows supersession: live rows by default, the replaced row on include=superseded", async () => {
    const live = await published(
      await marksRoute(get("/api/ref/epic-games/marks"), slug("epic-games")),
    );
    expect(live.marks).toHaveLength(1);
    const amendment = live.marks[0];
    expect(amendment.document.accession).toBe("0001145549-22-028055");

    const all = await published(
      await marksRoute(get("/api/ref/epic-games/marks?include=superseded"), slug("epic-games")),
    );
    expect(all.include).toBe("superseded");
    expect(all.marks).toHaveLength(2);
    const original = all.marks.find(
      (mark: { document: { accession: string } }) =>
        mark.document.accession === "0001145549-22-024223",
    );
    expect(original).toMatchObject({
      status: "superseded",
      superseded_by: amendment.mark_id,
      series_status: null,
    });
    // The title names only the issuer: published, but in no per-share series.
    expect(amendment).toMatchObject({ status: "live", series_status: "not_comparable_label" });
  });

  it("serves revisions and the SPV panel as slices of the name", async () => {
    const revisions = await published(
      await revisionsRoute(get("/api/ref/anthropic/revisions"), slug("anthropic")),
    );
    expect(revisions).toMatchObject({
      issuer: { slug: "anthropic", name: "Anthropic" },
      rule: {
        revision_threshold_ln: METHODOLOGY.revision_threshold_ln,
        leader_window_days: METHODOLOGY.leader_window_days,
      },
      // One filing per family: nothing to revise from.
      revisions: [],
    });

    const spv = await published(await spvRoute(get("/api/ref/anthropic/spv"), slug("anthropic")));
    expect(spv.headline).toBeNull();
    expect(spv.vehicles).toEqual([
      expect.objectContaining({
        vehicle_cik: "2136346",
        match_method: "alias",
        latest_filing: expect.objectContaining({
          accession: "0002136346-26-000001",
          document_url: `${ARCHIVES}/2136346/000213634626000001/primary_doc.xml`,
        }),
      }),
    ]);
    expect(spv.quotes).toEqual([]);
  });

  it("publishes the methodology's constants and the data its rules read", async () => {
    const body = await published(await methodologyRoute(get("/api/ref/methodology")));
    expect(body.methodology).toEqual({ ...METHODOLOGY });
    expect(body.security_labels.not_per_share).toContain("SPV interest");
    expect(
      new RegExp(body.security_labels.per_share_series_pattern).test("Series F-1 Preferred"),
    ).toBe(true);
    expect(body.listings).toEqual([
      expect.objectContaining({ slug: "spacex", listed_on: "2026-06-12" }),
    ]);
    expect(body.families).toMatchObject({
      version: PUBLISHED_FILER_FAMILIES.version,
      n_families: PUBLISHED_FILER_FAMILIES.families.length,
    });
    expect(body.families).not.toHaveProperty("list");
    const withList = await published(
      await methodologyRoute(get("/api/ref/methodology?include=families")),
    );
    expect(withList.families.list).toHaveLength(PUBLISHED_FILER_FAMILIES.families.length);
  });

  it("lists corrections newest first, one page at a time", async () => {
    const first = await published(await correctionsRoute(get("/api/ref/corrections?limit=1")));
    expect(first.corrections).toHaveLength(1);
    expect(first.corrections[0]).toMatchObject({
      kind: "row",
      methodology_version: "0.2.0",
      rows_written: { filer_marks: 0, certificates: 1 },
    });
    const second = await published(
      await correctionsRoute(get(`/api/ref/corrections?limit=1&cursor=${first.next_cursor}`)),
    );
    expect(second.corrections).toHaveLength(1);
    expect(second.corrections[0].published_at < first.corrections[0].published_at).toBe(true);
    // Two corrected transcriptions, two corrections: the second page is the last.
    expect(second.next_cursor).toBeNull();
  });

  it("downloads the filer marks as CSV, each row with its accession and URL", async () => {
    const response = await filerMarksCsvRoute(get("/data/filer-marks.csv"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
    expect(response.headers.get("link")).toBe(`<${ORIGIN}/data/LICENSE>; rel="license"`);
    expect(response.headers.get("openmarket-families-version")).toBe(
      PUBLISHED_FILER_FAMILIES.version,
    );
    const text = await response.text();
    expect(text.split("\r\n")[0]).toBe(FILER_MARKS_COLUMNS.join(","));
    const live = parseCsv(text);
    expect(live).toHaveLength(4);
    for (const row of live) {
      expect(row.status).toBe("live");
      expect(row.accession).toMatch(/^\d{10}-\d{2}-\d{6}$/);
      expect(row.document_url).toMatch(/^https:\/\/www\.sec\.gov\/Archives\//);
    }
    expect(live.filter((row) => row.issuer_slug === "anthropic")).toHaveLength(3);

    const all = parseCsv(
      await (await filerMarksCsvRoute(get("/data/filer-marks.csv?include=superseded"))).text(),
    );
    expect(all).toHaveLength(5);
    const original = all.find((row) => row.accession === "0001145549-22-024223")!;
    const amendment = all.find((row) => row.accession === "0001145549-22-028055")!;
    expect(original).toMatchObject({ status: "superseded", superseded_by: amendment.mark_id });
  });

  it("reads the filer marks in keyset batches without repeating or dropping a row", async () => {
    const rows: string[] = [];
    const table = filerMarksCsv(postgres.db, { now: NOW(), includeSuperseded: true, batchSize: 2 });
    let batches = 0;
    for await (const batch of table.batches) {
      batches += 1;
      for (const row of batch) rows.push(String(row[0]));
    }
    expect(batches).toBe(3);
    expect(new Set(rows).size).toBe(5);
  });

  it("downloads the certificate terms and the SPV matches", async () => {
    const terms = await certificateTermsCsv(get("/data/certificate-terms.csv"));
    expect(terms.headers.get("link")).toBe(`<${ORIGIN}/data/LICENSE>; rel="license"`);
    const termsText = await terms.text();
    expect(termsText.split("\r\n")[0]).toBe(CERTIFICATE_TERMS_COLUMNS.join(","));
    const live = parseCsv(termsText);
    expect(live.length).toBeGreaterThan(0);
    expect(new Set(live.map((row) => row.certificate_id)).size).toBe(1);
    for (const row of live) {
      expect(row).toMatchObject({ issuer_slug: "example-co", status: "live" });
      expect(row.document_url).toMatch(/^https:\/\//);
    }
    expect(live.find((row) => row.seniority === "1")?.liquidation_multiple).toBe("3");
    const every = parseCsv(
      await (
        await certificateTermsCsv(get("/data/certificate-terms.csv?include=superseded"))
      ).text(),
    );
    expect(new Set(every.map((row) => row.certificate_id)).size).toBe(3);

    const spvText = await (await spvMatchesCsv(get("/data/spv-matches.csv"))).text();
    expect(spvText.split("\r\n")[0]).toBe(SPV_MATCHES_COLUMNS.join(","));
    const vehicles = parseCsv(spvText);
    const stored = await postgres.db.selectFrom("spv_vehicles").select("id").execute();
    expect(vehicles).toHaveLength(stored.length);
    expect(vehicles).toContainEqual(
      expect.objectContaining({
        vehicle_cik: "2136346",
        issuer_slug: "anthropic",
        accession: "0002136346-26-000001",
      }),
    );
  });

  it("downloads one name's filer marks and SPV matches, and refuses an unknown issuer", async () => {
    const response = await filerMarksCsvRoute(get("/data/filer-marks.csv?issuer=anthropic"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="filer-marks-anthropic.csv"',
    );
    const rows = parseCsv(await response.text());
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.issuer_slug))).toEqual(new Set(["anthropic"]));
    const vehicles = parseCsv(
      await (await spvMatchesCsv(get("/data/spv-matches.csv?issuer=anthropic"))).text(),
    );
    expect(vehicles.length).toBeGreaterThan(0);
    expect(new Set(vehicles.map((row) => row.issuer_slug))).toEqual(new Set(["anthropic"]));

    const unknown = await filerMarksCsvRoute(get("/data/filer-marks.csv?issuer=no-such-name"));
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe("NAME_NOT_FOUND");
    expect((await filerMarksCsvRoute(get("/data/filer-marks.csv?issuer=Bad_Slug"))).status).toBe(
      400,
    );
  });

  it("refuses a malformed query before drawing on the quota", async () => {
    const key = generateApiKey();
    await insertApiKey(postgres.db, { name: "Desk", keyHash: hashApiKey(key), quotaPerMinute: 1 });
    const headers = { authorization: `Bearer ${key}` };
    for (const path of ["/api/ref/anthropic/marks?limit=0", "/api/ref/anthropic/marks?include=x"]) {
      const refused = await marksRoute(get(path, headers), slug("anthropic"));
      expect(refused.status).toBe(400);
    }
    expect((await nameRoute(get("/api/ref/Bad_Slug", headers), slug("Bad_Slug"))).status).toBe(400);
    expect(
      (await filerMarksCsvRoute(get("/data/filer-marks.csv?include=all", headers))).status,
    ).toBe(400);
    // The key's one request a minute is still unspent.
    const served = await marksRoute(get("/api/ref/anthropic/marks", headers), slug("anthropic"));
    expect(served.status).toBe(200);
    const spent = await marksRoute(get("/api/ref/anthropic/marks", headers), slug("anthropic"));
    expect(spent.status).toBe(429);
  });

  it("says why a name has no filer marks, from the search's counts", async () => {
    const body = await published(await namesRoute(get("/api/ref/names")));
    const row = (value: string) => body.names.find((name: { slug: string }) => name.slug === value);
    expect(row("anthropic").no_marks).toBeNull();
    expect(row("anthropic").coverage).toMatchObject({ nport_filings: expect.any(Number) });
    expect(row("scale-ai").no_marks.code).toBe("named_in_ncsr_only");
    expect(row("anysphere")).toMatchObject({
      live_marks: 0,
      no_marks: { code: "named_in_ncsr_only" },
    });
    // No watchlisted name is named in no fund filing since watchlist 0.2.0;
    // Modal, now a candidate, still is.
    expect(row("modal")).toBeUndefined();
    expect((await noMarksReason(postgres.db, "modal")).code).toBe("named_in_no_fund_filing");
    // Powerlaw's N-PORT names Rippling; this database has not read it.
    expect(row("rippling").no_marks).toMatchObject({
      code: "not_ingested",
      filings: [{ accession: "0002052053-26-000004", read: false }],
    });
  });

  it("publishes the marks that enter no series as filed, with the reason", async () => {
    const body = await published(await nameRoute(get("/api/ref/epic-games"), slug("epic-games")));
    expect(body.marks_summary.in_series).toBe(0);
    expect(body.out_of_series).toHaveLength(1);
    const [group] = body.out_of_series;
    expect(group).toMatchObject({ n_marks: 1, n_filers: 1, latest_as_of: "2022-02-28" });
    expect(group.reason).toContain("METHODOLOGY.md");
    expect(group.recent[0]).toMatchObject({
      accession: "0001145549-22-028055",
      as_of: "2022-02-28",
    });
  });

  it("keeps a keyed download private", async () => {
    const key = generateApiKey();
    await insertApiKey(postgres.db, { name: "Desk", keyHash: hashApiKey(key), quotaPerMinute: 5 });
    const response = await spvMatchesCsv(
      get("/data/spv-matches.csv", { authorization: `Bearer ${key}` }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
  });
});
