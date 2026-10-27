/**
 * Writes public/data/round-history.csv and .json from backtest/events.csv,
 * backtest/data/sources.csv and backtest/out/params.json
 * (src/lib/tradeables/round-history.ts says how they join).
 *
 *   npm run export:round-history
 *   npm run export:round-history -- --check   # exit 1 if a file is stale
 */
import { readFileSync, writeFileSync } from "node:fs";

import params from "../backtest/out/params.json";
import { DEALER_PARAMS } from "../src/lib/config/dealer.js";
import { EVENTS_CSV_PATH, SOURCES_CSV_PATH } from "../src/lib/config/listing-anchors.js";
import { RULEBOOK_VERSION } from "../src/lib/engine/dealer/rulebook.js";
import {
  renderRoundHistoryCsv,
  renderRoundHistoryJson,
  roundHistoryRows,
} from "../src/lib/tradeables/round-history.js";

const inputs = {
  eventsCsv: readFileSync(EVENTS_CSV_PATH, "utf8"),
  sourcesCsv: readFileSync(SOURCES_CSV_PATH, "utf8"),
  dataThrough: params.data_through,
  eventsSha256: params.inputs_sha256["events.csv"],
  megaThresholdUsd: DEALER_PARAMS.tier.mega_threshold_usd,
  rulebookVersion: RULEBOOK_VERSION,
};
const rows = roundHistoryRows(inputs);
const outputs = {
  "public/data/round-history.csv": renderRoundHistoryCsv(rows),
  "public/data/round-history.json": renderRoundHistoryJson(rows, inputs),
};

const check = process.argv.includes("--check");
for (const [path, text] of Object.entries(outputs)) {
  if (!check) {
    writeFileSync(path, text);
    console.log(`wrote ${path} (${rows.length} rows)`);
  } else if (readFileSync(path, "utf8") !== text) {
    console.error(`${path} is stale; run npm run export:round-history`);
    process.exitCode = 1;
  } else {
    console.log(`${path} is current`);
  }
}
