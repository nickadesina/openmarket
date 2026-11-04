import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { SecClient } from "../../src/lib/ingest/fetch/sec.js";
import { familyLookup, parseFilerFamilies } from "../../src/lib/ingest/parse/families.js";
import type { WatchlistIssuer } from "../../src/lib/ingest/parse/watchlist.js";
import {
  buildFamilies,
  type RegistrantAdviser,
  registrantAdviser,
} from "../../src/lib/services/index/build-families.js";
import {
  byDensity,
  FILINGS_CSV_COLUMNS,
  filerCountsMarkdown,
  filingsCsv,
  issuerCounts,
  searchIssuers,
} from "../../src/lib/services/index/search-filings.js";

/** Real EDGAR responses, trimmed (tests/fixtures/index/README.md). */
const fixture = (name: string) => readFileSync(`tests/fixtures/index/${name}`, "utf8");

const ANTHROPIC: WatchlistIssuer = {
  slug: "anthropic",
  name: "Anthropic",
  legalName: "Anthropic, PBC",
  searchPhrases: ["Anthropic"],
  matchPattern: "\\bAnthropic\\b",
  watchlisted: true,
};

/** Serves the real search page for NPORT-P queries and an empty page for the other forms. */
function searchClient(): SecClient & { urls: string[] } {
  const urls: string[] = [];
  const page = JSON.parse(fixture("efts-anthropic-nport-page.json")) as {
    hits: { total: { value: number }; hits: unknown[] };
  };
  return {
    urls,
    userAgent: "test",
    text: async () => "",
    json: async (url) => {
      urls.push(url);
      const forms = new URL(url).searchParams.get("forms");
      if (forms !== "NPORT-P") {
        return { hits: { total: { value: 0, relation: "eq" }, hits: [] } };
      }
      return { ...page, hits: { ...page.hits, total: { value: 5, relation: "eq" } } };
    },
  };
}

describe("index:search", () => {
  it("searches each form for each phrase and writes one row per issuer and filing", async () => {
    const client = searchClient();
    const searches = await searchIssuers(client, [ANTHROPIC], {
      startDate: "2019-01-01",
      endDate: "2026-11-04",
    });
    expect(client.urls.map((url) => new URL(url).searchParams.get("forms"))).toEqual([
      "NPORT-P",
      "N-CSR",
      "N-CSRS",
    ]);
    const familyOf = familyLookup({
      version: "0.1.0",
      families: [
        {
          slug: "fidelity-fmr",
          name: "Fidelity (FMR)",
          ciks: ["707823", "315700", "722574"],
          evidence: "test",
        },
      ],
    });
    const csv = filingsCsv(searches, familyOf);
    const [header, ...rows] = csv.trimEnd().split("\n");
    expect(header).toBe(FILINGS_CSV_COLUMNS.join(","));
    expect(rows).toHaveLength(4);
    expect(rows).toContain(
      "anthropic,NPORT-P,FIDELITY MT VERNON STREET TRUST,707823,fidelity-fmr,2026-10-26,2026-08-31,0000035402-26-006778,https://www.sec.gov/Archives/edgar/data/707823/000003540226006778/primary_doc.xml",
    );
    // Fixed order (filed date, then accession) and the same bytes on a rerun.
    expect(rows.map((row) => row.split(",")[5])).toEqual(
      [...rows.map((row) => row.split(",")[5])].sort(),
    );
    expect(filingsCsv(searches, familyOf)).toBe(csv);

    const [counts] = issuerCounts(searches, familyOf);
    expect(counts).toMatchObject({
      slug: "anthropic",
      byForm: { "NPORT-P": 4, "N-CSR": 0, "N-CSRS": 0 },
      filings: 4,
      registrants: 4,
      families: 2,
      nportFamilies: 2,
      latestFiled: "2026-10-26",
    });
    const markdown = filerCountsMarkdown([counts!], {
      fetchedAt: "2026-11-04T00:00:00.000Z",
      startDate: "2019-01-01",
      endDate: "2026-11-04",
      familiesVersion: "0.1.0",
    });
    expect(markdown).toContain("Fetched 2026-11-04T00:00:00.000Z");
    expect(markdown).toContain("1. Anthropic: 2 families file N-PORT naming it");
    expect(markdown).toContain(
      "| Anthropic | `anthropic` | yes | 4 | 0 | 0 | 4 | 4 | 2 | 2 | 2026-10-26 |",
    );
  });

  it("ranks by families filing N-PORT first", () => {
    const base = {
      name: "x",
      watchlisted: true,
      byForm: { "NPORT-P": 0, "N-CSR": 0, "N-CSRS": 0 },
      filings: 0,
      registrants: 0,
      latestFiled: null,
      truncatedDays: [],
    };
    const ranked = byDensity([
      { ...base, slug: "commentary", families: 50, nportFamilies: 1 },
      { ...base, slug: "held", families: 10, nportFamilies: 9 },
    ]);
    expect(ranked.map((count) => count.slug)).toEqual(["held", "commentary"]);
  });
});

describe("index:families", () => {
  it("reads the adviser from the registrant's latest N-CEN", async () => {
    const client: SecClient = {
      userAgent: "test",
      json: async () => JSON.parse(fixture("submissions-CIK0000707823.json")) as unknown,
      text: async (url) => {
        expect(url).toBe(
          "https://www.sec.gov/Archives/edgar/data/707823/000003540226000575/primary_doc.xml",
        );
        return fixture("ncen-0000035402-26-000575.xml");
      },
    };
    const found = await registrantAdviser(client, "707823", "FIDELITY MT VERNON STREET TRUST");
    expect(found).toEqual({
      cik: "707823",
      registrantName: "FIDELITY MT VERNON STREET TRUST",
      ncen: { accession: "0000035402-26-000575", filedOn: "2026-02-11" },
      advisers: [{ name: "Fidelity Management & Research Company LLC", fileNumber: "801-7884" }],
    });

    const families = buildFamilies(
      {
        version: "0.1.0",
        families: [{ slug: "kept", name: "Kept as edited", ciks: ["1"], evidence: "by hand" }],
      },
      [
        found,
        { cik: "1", registrantName: "Already placed", ncen: null, advisers: [] },
        { cik: "2", registrantName: "No Report Trust", ncen: null, advisers: [] },
      ] satisfies RegistrantAdviser[],
      "0.1.0",
    );
    expect(families.families.map((family) => [family.slug, family.ciks])).toEqual([
      ["fidelity-fmr", ["707823"]],
      ["kept", ["1"]],
      ["no-report-trust", ["2"]],
    ]);
    expect(families.families[0]!.evidence).toContain(
      "Fidelity Management & Research Company LLC (SEC file 801-7884)",
    );
    expect(families.families[0]!.evidence).toContain("N-CEN 0000035402-26-000575 filed 2026-02-11");
    expect(families.families[2]!.evidence).toMatch(/^Its own family: no N-CEN/);
  });
});

describe("data/index/filer-families.json", () => {
  it("is valid, places every registrant of the search, and defaults others to themselves", () => {
    const families = parseFilerFamilies(readFileSync("data/index/filer-families.json", "utf8"));
    const familyOf = familyLookup(families);
    expect(familyOf("0000707823")).toBe("fidelity-fmr");
    expect(familyOf("999999999")).toBe("cik-999999999");
    const placed = new Set(families.families.flatMap((family) => family.ciks));
    const searched = readFileSync("data/index/filings-by-name.csv", "utf8")
      .trimEnd()
      .split("\n")
      .slice(1)
      .map((row) => /,(\d+),[a-z0-9-]+,\d{4}-/.exec(row)?.[1]);
    expect(searched.every((cik) => cik !== undefined && placed.has(cik))).toBe(true);
  });
});
