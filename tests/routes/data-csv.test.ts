import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/logging/server-log.js", () => ({
  logReadRequest: vi.fn(),
  logMutationRequest: vi.fn(),
  logUnexpectedError: vi.fn(),
}));

const runtime = vi.hoisted(() => ({ getRuntimeDatabase: vi.fn(() => ({ fake: "db" })) }));
vi.mock("../../src/lib/db/runtime.js", () => runtime);

const tables = vi.hoisted(() => ({
  filerMarksCsv: vi.fn(),
  certificateTermsCsv: vi.fn(),
  spvMatchesCsv: vi.fn(),
}));
vi.mock("../../src/lib/services/index/data-csv.js", () => tables);

import { GET as certificateTerms } from "../../src/app/data/certificate-terms.csv/route.js";
import { GET as filerMarks } from "../../src/app/data/filer-marks.csv/route.js";
import { GET as spvMatches } from "../../src/app/data/spv-matches.csv/route.js";
import type { CsvRow, CsvTable } from "../../src/lib/services/index/data-csv.js";
import { parseCsv } from "../../src/lib/tradeables/csv.js";

function table(batches: readonly (readonly CsvRow[])[], fail?: Error): CsvTable {
  return {
    filename: "filer-marks.csv",
    columns: ["mark_id", "holding_title", "value_usd", "accession", "document_url"],
    batches: (async function* () {
      for (const batch of batches) yield batch;
      if (fail !== undefined) throw fail;
    })(),
    versions: { methodology_version: "0.1.0", families_version: "0.1.0" },
  };
}

const URL_A = "https://www.sec.gov/Archives/edgar/data/707823/000003540226006778/primary_doc.xml";

afterEach(() => {
  for (const fn of Object.values(tables)) fn.mockReset();
});

describe("the CSV downloads", () => {
  it("stream every batch under one header, with the licence link, cache and versions", async () => {
    tables.filerMarksCsv.mockReturnValue(
      table([
        [["m1", "ANTHROPIC PBC SERIES F-1 PC PP", "777530.00", "0000035402-26-006778", URL_A]],
        [["m2", 'Anthropic PBC, "Series F-1"', null, null, URL_A]],
      ]),
    );
    const response = await filerMarks(
      new Request("https://openmarket.systems/data/filer-marks.csv"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
    expect(response.headers.get("link")).toBe(
      '<https://openmarket.systems/data/LICENSE>; rel="license"',
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="filer-marks.csv"',
    );
    expect(response.headers.get("openmarket-methodology-version")).toBe("0.1.0");
    expect(response.headers.get("openmarket-families-version")).toBe("0.1.0");
    const text = await response.text();
    expect(text.split("\r\n")[0]).toBe("mark_id,holding_title,value_usd,accession,document_url");
    expect(parseCsv(text)).toEqual([
      {
        mark_id: "m1",
        holding_title: "ANTHROPIC PBC SERIES F-1 PC PP",
        value_usd: "777530.00",
        accession: "0000035402-26-006778",
        document_url: URL_A,
      },
      {
        mark_id: "m2",
        holding_title: 'Anthropic PBC, "Series F-1"',
        value_usd: "",
        accession: "",
        document_url: URL_A,
      },
    ]);
    expect(tables.filerMarksCsv.mock.calls[0]![1]).toMatchObject({ includeSuperseded: false });
  });

  it("serve the header alone for an empty table", async () => {
    tables.certificateTermsCsv.mockReturnValue(table([]));
    const response = await certificateTerms(
      new Request("http://localhost:3000/data/certificate-terms.csv?include=superseded"),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      "mark_id,holding_title,value_usd,accession,document_url\r\n",
    );
    expect(tables.certificateTermsCsv.mock.calls[0]![1]).toMatchObject({
      includeSuperseded: true,
    });
  });

  it("answer a failure before the first row with the JSON error envelope", async () => {
    tables.spvMatchesCsv.mockReturnValue(table([], new Error("connection refused")));
    const response = await spvMatches(new Request("http://localhost:3000/data/spv-matches.csv"));
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).error.code).toBe("INTERNAL_ERROR");
  });

  it("end the stream with an error on a failure after the first batch", async () => {
    tables.filerMarksCsv.mockReturnValue(
      table([[["m1", "t", "1", "0000035402-26-006778", URL_A]]], new Error("lost")),
    );
    const response = await filerMarks(new Request("http://localhost:3000/data/filer-marks.csv"));
    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toThrow("lost");
  });

  it.each([
    "/data/filer-marks.csv?include=all",
    "/data/filer-marks.csv?limit=5",
    "/data/spv-matches.csv?include=superseded",
  ])("refuse %s with 400 INVALID_INPUT", async (path) => {
    tables.filerMarksCsv.mockReturnValue(table([]));
    tables.spvMatchesCsv.mockReturnValue(table([]));
    const route = path.startsWith("/data/spv") ? spvMatches : filerMarks;
    const response = await route(new Request(`http://localhost:3000${path}`));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_INPUT");
  });

  it("refuse a malformed key before anything is read", async () => {
    tables.spvMatchesCsv.mockReturnValue(table([]));
    const response = await spvMatches(
      new Request("http://localhost:3000/data/spv-matches.csv", {
        headers: { authorization: "Bearer om_x" },
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(tables.spvMatchesCsv).not.toHaveBeenCalled();
  });
});
