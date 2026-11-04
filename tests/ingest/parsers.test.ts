import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { searchFullText } from "../../src/lib/ingest/fetch/efts.js";
import type { SecClient } from "../../src/lib/ingest/fetch/sec.js";
import {
  EFTS_HIT_CEILING,
  eftsQueryString,
  filingsFromHits,
  pageOffsets,
  parseEftsPage,
  splitDateRange,
} from "../../src/lib/ingest/parse/efts.js";
import { parseFilerFamilies } from "../../src/lib/ingest/parse/families.js";
import { parseNcen, registrantAdvisers } from "../../src/lib/ingest/parse/ncen.js";
import { matchingHoldings, parseNport } from "../../src/lib/ingest/parse/nport.js";
import { DEFAULT_SOURCE_RANK, SOURCE_CLASSES } from "../../src/lib/ingest/parse/source-class.js";
import { latestFiling, parseSubmissions } from "../../src/lib/ingest/parse/submissions.js";
import { issuerPattern, parseWatchlist } from "../../src/lib/ingest/parse/watchlist.js";
import { decodeEntities } from "../../src/lib/ingest/parse/xml.js";

/** Real documents from EDGAR, trimmed (tests/fixtures/index/README.md). */
const fixture = (name: string) => readFileSync(`tests/fixtures/index/${name}`, "utf8");
const NPORT = fixture("nport-0000035402-26-006778.xml");
const EFTS_PAGE = JSON.parse(fixture("efts-anthropic-nport-page.json")) as unknown;

describe("N-PORT", () => {
  const document = parseNport(NPORT);

  it("reads the registrant, series and report date from genInfo", () => {
    expect(document).toMatchObject({
      submissionType: "NPORT-P",
      registrantName: "Fidelity Mt. Vernon Street Trust",
      registrantCik: "707823",
      seriesName: "Fidelity Equity Growth K6 Fund",
      seriesId: "S000081601",
      reportDate: "2026-08-31",
      fiscalPeriodEnd: "2026-11-30",
    });
    expect(document.holdings).toHaveLength(5);
    expect(document.holdings.map((holding) => holding.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps the issuer's holdings with their figures exactly as filed", () => {
    const anthropic = matchingHoldings(document, issuerPattern("\\bAnthropic\\b"));
    expect(anthropic.map((holding) => holding.title)).toEqual([
      "ANTHROPIC PBC SERIES G-1 PC PP",
      "ANTHROPIC PBC SERIES F-1 PC PP",
      "ANTHROPIC PBC SERIES H-1 PC PP",
    ]);
    expect(anthropic[0]).toEqual({
      index: 2,
      name: "ANTHROPIC PBC",
      title: "ANTHROPIC PBC SERIES G-1 PC PP",
      lei: "984500B6DEB8CEBC4Z70",
      cusip: null,
      assetCategory: "EP",
      balance: "2200.00000000",
      units: "NS",
      valueUsd: "1710566.00000000",
      pctOfNetAssets: "0.457640181288",
      fairValueLevel: "3",
      isRestricted: true,
    });
    expect(matchingHoldings(document, issuerPattern("\\bDatabricks\\b"))).toEqual([]);
  });

  it("refuses a document that is not an N-PORT form", () => {
    expect(() => parseNport("<edgarSubmission/>")).toThrow(/not an N-PORT/);
  });

  it("decodes entities", () => {
    expect(decodeEntities("Fidelity Management &amp; Research &#38; Co &#x41;")).toBe(
      "Fidelity Management & Research & Co A",
    );
  });
});

describe("full-text search", () => {
  const page = parseEftsPage(EFTS_PAGE);

  it("types a page: one hit per file, CIKs unpadded, names without the CIK", () => {
    expect(page.total).toBe(926);
    expect(page.atCeiling).toBe(false);
    expect(page.hits[0]).toEqual({
      accession: "0000035402-26-006778",
      fileName: "QTLY_7524_20260831.htm",
      form: "NPORT-P",
      fileType: "NPORT-EX",
      ciks: ["707823"],
      entityNames: ["FIDELITY MT VERNON STREET TRUST"],
      filedOn: "2026-10-26",
      periodEnding: "2026-08-31",
    });
  });

  it("groups a filing's hits", () => {
    const filings = filingsFromHits(page.hits);
    expect(filings).toHaveLength(4);
    expect(filings.find((filing) => filing.accession === "0000035402-26-006778")).toMatchObject({
      cik: "707823",
      fileNames: ["QTLY_7524_20260831.htm", "primary_doc.xml"],
    });
  });

  it("writes the query as an exact phrase over the forms and dates", () => {
    const query = {
      phrase: "Stripe, Inc.",
      forms: ["NPORT-P"],
      startDate: "2019-01-01",
      endDate: "2026-11-04",
    };
    expect(new URLSearchParams(eftsQueryString(query, 200)).get("q")).toBe('"Stripe, Inc."');
    expect(new URLSearchParams(eftsQueryString(query, 0)).has("from")).toBe(false);
    expect(pageOffsets(250)).toEqual([0, 100, 200]);
    expect(pageOffsets(50_000)).toHaveLength(EFTS_HIT_CEILING / 100);
  });

  it("halves a date range, down to a single day", () => {
    expect(splitDateRange("2024-01-01", "2024-01-10")).toEqual([
      ["2024-01-01", "2024-01-05"],
      ["2024-01-06", "2024-01-10"],
    ]);
    expect(splitDateRange("2024-01-01", "2024-01-02")).toEqual([
      ["2024-01-01", "2024-01-01"],
      ["2024-01-02", "2024-01-02"],
    ]);
    expect(splitDateRange("2024-01-01", "2024-01-01")).toBeNull();
  });

  it("pages a query and narrows one at the ceiling by date", async () => {
    // A stub server: the real page's hits, with its total replaced to model a
    // query at the 10,000 ceiling over any range longer than a month.
    const requested: URLSearchParams[] = [];
    const client: SecClient = {
      userAgent: "test",
      text: async () => "",
      json: async (url) => {
        const params = new URL(url).searchParams;
        requested.push(params);
        const days =
          (Date.parse(params.get("enddt")!) - Date.parse(params.get("startdt")!)) / 86_400_000;
        const body = structuredClone(EFTS_PAGE) as {
          hits: { total: { value: number; relation: string } };
        };
        body.hits.total =
          days > 31 ? { value: 10_000, relation: "gte" } : { value: 5, relation: "eq" };
        return body;
      },
    };
    const result = await searchFullText(client, {
      phrase: "Anthropic",
      forms: ["NPORT-P"],
      startDate: "2026-01-01",
      endDate: "2026-03-31",
    });
    const ranges = requested.map((params) => `${params.get("startdt")}..${params.get("enddt")}`);
    expect(ranges).toEqual([
      "2026-01-01..2026-03-31",
      "2026-01-01..2026-02-14",
      "2026-01-01..2026-01-23",
      "2026-01-24..2026-02-14",
      "2026-02-15..2026-03-31",
      "2026-02-15..2026-03-09",
      "2026-03-10..2026-03-31",
    ]);
    expect(result.truncatedDays).toEqual([]);
    expect(result.hits).toHaveLength(4 * 5);
  });
});

describe("N-CEN and the submissions index", () => {
  it("names each fund's adviser and sub-advisers", () => {
    const report = parseNcen(fixture("ncen-0000035402-26-000575.xml"));
    expect(report.registrantName).toBe("Fidelity Mt Vernon Street Trust");
    expect(report.funds).toHaveLength(2);
    expect(report.funds[0]).toMatchObject({
      name: "Fidelity Growth Company K6 Fund",
      seriesId: "S000065696",
      advisers: [{ name: "Fidelity Management & Research Company LLC", fileNumber: "801-7884" }],
    });
    expect(report.funds[0]!.subAdvisers.map((adviser) => adviser.name)).toContain(
      "FMR Investment Management (UK) Limited",
    );
    expect(registrantAdvisers(report)).toEqual([
      { name: "Fidelity Management & Research Company LLC", fileNumber: "801-7884" },
    ]);
  });

  it("finds the latest N-CEN and its raw document", () => {
    const submissions = parseSubmissions(
      JSON.parse(fixture("submissions-CIK0000707823.json")) as unknown,
    );
    expect(submissions.name).toBe("FIDELITY MT VERNON STREET TRUST");
    expect(latestFiling(submissions, "N-CEN")).toEqual({
      accession: "0000035402-26-000575",
      form: "N-CEN",
      filedOn: "2026-02-11",
      primaryDocument: "primary_doc.xml",
    });
    expect(latestFiling(submissions, "N-CSR")).toBeNull();
  });
});

describe("checked-in data files", () => {
  it("validates the watchlist: twenty names, candidates unwatchlisted, patterns compile", () => {
    const watchlist = parseWatchlist(readFileSync("data/index/watchlist.json", "utf8"));
    expect(watchlist.issuers.filter((issuer) => issuer.watchlisted)).toHaveLength(20);
    expect(watchlist.issuers.filter((issuer) => !issuer.watchlisted).length).toBeGreaterThan(0);
    for (const issuer of watchlist.issuers) {
      expect(() => issuerPattern(issuer.matchPattern), issuer.slug).not.toThrow();
    }
    expect(() =>
      parseWatchlist(
        JSON.stringify({
          version: "0.1.0",
          names: [{ slug: "x", name: "X", search_phrases: ["X"], match_pattern: "(" }],
        }),
      ),
    ).toThrow();
  });

  it("refuses a families file that puts a CIK in two families", () => {
    expect(() =>
      parseFilerFamilies(
        JSON.stringify({
          version: "0.1.0",
          families: [
            { slug: "a", name: "A", ciks: ["1"], evidence: "x" },
            { slug: "b", name: "B", ciks: ["1"], evidence: "x" },
          ],
        }),
      ),
    ).toThrow(/two families/);
  });

  it("ranks the source classes in the brief's order until the rulebook does", () => {
    expect(SOURCE_CLASSES.map((sourceClass) => DEFAULT_SOURCE_RANK[sourceClass])).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(DEFAULT_SOURCE_RANK.nport).toBe(2);
  });
});
