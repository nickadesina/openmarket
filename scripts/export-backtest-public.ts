/**
 * Writes public/data/backtest/ from backtest/out/calibration.csv,
 * backtest/out/summary.csv and tests/fixtures/rulebook-events.json
 * (src/lib/tradeables/backtest-public.ts says what each file keeps and drops).
 *
 *   npm run export:backtest-public
 *   npm run export:backtest-public -- --check   # exit 1 if a file is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import params from "../backtest/out/params.json";
import { DEALER_PARAMS } from "../src/lib/config/dealer.js";
import { RULEBOOK_VERSION } from "../src/lib/engine/dealer/rulebook.js";
import {
  backtestPublicFiles,
  type RulebookFixture,
} from "../src/lib/tradeables/backtest-public.js";
import fixture from "../tests/fixtures/rulebook-events.json";

const OUTPUT = "public/data/backtest";

const files = backtestPublicFiles({
  calibrationCsv: readFileSync("backtest/out/calibration.csv", "utf8"),
  summaryCsv: readFileSync("backtest/out/summary.csv", "utf8"),
  fixture: fixture as RulebookFixture,
  dataThrough: params.data_through,
  rulebookVersion: RULEBOOK_VERSION,
  kappa: DEALER_PARAMS.dealer.kappa,
});

const check = process.argv.includes("--check");
for (const [name, text] of Object.entries(files)) {
  const path = join(OUTPUT, name);
  if (!check) {
    writeFileSync(path, text);
    console.log(`wrote ${path}`);
  } else if (readFileSync(path, "utf8") !== text) {
    console.error(`${path} is stale; run npm run export:backtest-public`);
    process.exitCode = 1;
  } else {
    console.log(`${path} is current`);
  }
}
