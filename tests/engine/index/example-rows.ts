/**
 * The real rows behind METHODOLOGY.md's worked examples
 * (tests/fixtures/index/anthropic-series-f1-2026.json: Anthropic PBC Series
 * F-1 preferred in eight N-PORT-P filings, fetched from EDGAR 2026-11-04),
 * mapped onto the engine's input the way the services map `filer_marks`.
 */
import { readFileSync } from "node:fs";

import type { FilerFamilies, FundMarkInput } from "../../../src/lib/engine/index/families.js";
import { parseFilerFamilies } from "../../../src/lib/engine/index/families.js";
import { perShareMark } from "../../../src/lib/engine/index/mark.js";
import { classifySecurity } from "../../../src/lib/engine/index/series.js";

export interface ExampleRow {
  readonly accession: string;
  readonly cik: string;
  readonly registrant: string;
  readonly series: string;
  readonly series_id: string;
  readonly period_end: string;
  readonly holding_name: string;
  readonly holding_title: string;
  readonly asset_category: string;
  readonly balance: string;
  readonly units: string;
  readonly value_usd: string;
}

export const EXAMPLE_ROWS = (
  JSON.parse(
    readFileSync(
      new URL("../../fixtures/index/anthropic-series-f1-2026.json", import.meta.url),
      "utf8",
    ),
  ) as { readonly holdings: readonly ExampleRow[] }
).holdings;

export function toFundMark(row: ExampleRow): FundMarkInput {
  return {
    id: `${row.accession}:${row.series_id}`,
    filerCik: row.cik,
    filerName: row.registrant,
    fundSeriesId: row.series_id,
    securityLabel: classifySecurity(row.holding_title, row.holding_name, row.asset_category).label,
    asOf: row.period_end,
    markPerShareUsd: perShareMark({
      valueUsd: Number(row.value_usd),
      balance: Number(row.balance),
      units: row.units,
    }),
  };
}

/**
 * Growth Fund of America and New Economy Fund are both Capital Group's
 * American Funds. Test data only: the published grouping is
 * data/index/filer-families.json.
 */
export const EXAMPLE_FAMILIES: FilerFamilies = parseFilerFamilies({
  version: "test",
  families: [
    {
      slug: "capital-group",
      name: "Capital Group",
      ciks: ["0000044201", "0000719608"],
      evidence:
        "Both registrants are American Funds advised by Capital Research and Management Company.",
    },
  ],
});
