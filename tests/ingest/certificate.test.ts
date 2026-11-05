import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseCertificate } from "../../src/lib/ingest/parse/certificate.js";

/** The schema fixture: an invented issuer, shaped like the schema (tests/fixtures/certificates/README.md). */
const PATH = "tests/fixtures/certificates/example-co/2026-01-15.json";
const TEXT = readFileSync(PATH, "utf8");

function edited(change: (value: Record<string, unknown>) => void): string {
  const value = JSON.parse(TEXT) as Record<string, unknown>;
  change(value);
  return JSON.stringify(value);
}

describe("certificate transcriptions", () => {
  it("reads the schema fixture", () => {
    const certificate = parseCertificate(TEXT, PATH);
    expect(certificate.issuer).toBe("example-co");
    expect(certificate.newest_series).toBe("Series B Preferred");
    expect(certificate.series.map((series) => series.label)).toEqual([
      "Series B Preferred",
      "Series A Preferred",
    ]);
  });

  it("refuses a file at a path that does not match it", () => {
    expect(() => parseCertificate(TEXT, "data/index/certificates/other/2026-01-15.json")).toThrow(
      /must be at/,
    );
  });

  it("refuses labels the methodology would not read, and a newest series not listed", () => {
    expect(() =>
      parseCertificate(
        edited((value) => {
          (value.series as Record<string, unknown>[])[0]!.label = "Series B";
        }),
      ),
    ).toThrow();
    expect(() =>
      parseCertificate(
        edited((value) => {
          value.newest_series = "Series C Preferred";
        }),
      ),
    ).toThrow(/newest_series/);
  });

  it("refuses a cap on a non-participating series, a float amount and an unknown field", () => {
    expect(() =>
      parseCertificate(
        edited((value) => {
          (value.series as Record<string, unknown>[])[0]!.participation_cap_multiple = "2";
        }),
      ),
    ).toThrow(/participating/);
    expect(() =>
      parseCertificate(
        edited((value) => {
          (value.series as Record<string, unknown>[])[0]!.original_issue_price_usd = 4;
        }),
      ),
    ).toThrow();
    expect(() =>
      parseCertificate(
        edited((value) => {
          value.valuation = "1";
        }),
      ),
    ).toThrow();
  });
});
