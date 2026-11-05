/**
 * Seeds DATABASE_URL_TEST for the browser specs through the import services,
 * from real documents (tests/fixtures/index/README.md): the real watchlist;
 * Fidelity Equity Growth K6 Fund's N-PORT with its three Anthropic holdings;
 * New Economy Fund's N-PORT and its amendment on Epic Games (the holding
 * titled "EPIC GAMES INC PP", Unclassified); the real round-history files;
 * Granada Anthropic SPV's Form D and Figure AI's own Form D. Migrates first,
 * then replaces the index tables' rows (the v2 tables only; the integration
 * suites use their own schemas).
 *
 *   DATABASE_URL_TEST=postgresql://... tsx tests/browser/seed.ts
 *
 * Run by tests/browser/global-setup.ts before the specs.
 */
import { readFileSync } from "node:fs";

import { sql } from "kysely";

import { createDirectDatabase, destroyDatabase } from "../../src/lib/db/client.js";
import { migrateToLatest } from "../../src/lib/db/migrator.js";
import type { SecClient } from "../../src/lib/ingest/fetch/sec.js";
import { parseWatchlist } from "../../src/lib/ingest/parse/watchlist.js";
import { importPrints, printCandidates } from "../../src/lib/services/index/import-prints.js";
import { ingestFormDDocument } from "../../src/lib/services/index/ingest-form-d.js";
import {
  ingestNport,
  loadIndexIssuers,
  type NportCandidate,
} from "../../src/lib/services/index/ingest-nport.js";
import { syncWatchlist } from "../../src/lib/services/index/sync-watchlist.js";

const ARCHIVES = "https://www.sec.gov/Archives/edgar/data";
const NOW = new Date("2026-11-05T12:00:00Z");
const fixture = (path: string) => readFileSync(path, "utf8");

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

/** Serves the fixtures in place of EDGAR; nothing is fetched. */
const client: SecClient = {
  userAgent: "OpenMarket-Index/0.1 (+https://openmarket.systems)",
  async text(url) {
    const document = NPORT.find((candidate) => candidate.url === url);
    if (document === undefined) throw new Error(`no fixture for ${url}`);
    return fixture(`tests/fixtures/index/${document.fixture}`);
  },
  async json() {
    throw new Error("the search is not called when candidates are given");
  },
};

function formD(accession: string, cik: string, filedOn: string, foundBy: string) {
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

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_TEST?.trim();
  if (!url) throw new Error("DATABASE_URL_TEST is required");
  const db = createDirectDatabase(url);
  try {
    const { error } = await migrateToLatest(db);
    if (error !== undefined) throw error;
    await sql`
      truncate table ingest_runs, spv_quotes, spv_vehicles, certificate_series, certificates,
        prints, filer_marks, corrections, issuers, source_documents
      restart identity cascade
    `.execute(db);
    await syncWatchlist(db, parseWatchlist(fixture("data/index/watchlist.json")));
    for (const candidate of NPORT) {
      await ingestNport(db, client, {
        since: "2019-01-01",
        until: "2026-11-04",
        candidates: [candidate],
        now: () => NOW,
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
      NOW,
    );
    await ingestFormDDocument(
      db,
      formD("0001493152-24-009735", "2014185", "2024-03-13", "figure-ai"),
      fixture("tests/fixtures/index/form-d-0001493152-24-009735.xml"),
      issuers,
      NOW,
    );
    console.log("browser seed: watchlist, 3 N-PORT filings, prints, 2 Form Ds");
  } finally {
    await destroyDatabase(db);
  }
}

await main();
