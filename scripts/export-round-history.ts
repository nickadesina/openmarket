/**
 * Writes public/data/round-history.csv and .json from
 * data/round-history/events.csv and data/round-history/sources.csv
 * (src/lib/tradeables/round-history.ts says how they join).
 *
 *   npm run export:round-history
 *   npm run export:round-history -- --check   # exit 1 if a file is stale
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { RULEBOOK_VERSION } from "../src/lib/engine/rulebook.js";
import {
  DATA_THROUGH,
  EVENTS_CSV_PATH,
  MEGA_THRESHOLD_USD,
  renderRoundHistoryCsv,
  renderRoundHistoryJson,
  roundHistoryRows,
  SOURCES_CSV_PATH,
} from "../src/lib/tradeables/round-history.js";

const eventsCsv = readFileSync(EVENTS_CSV_PATH, "utf8");
const inputs = {
  eventsCsv,
  sourcesCsv: readFileSync(SOURCES_CSV_PATH, "utf8"),
  dataThrough: DATA_THROUGH,
  eventsSha256: createHash("sha256").update(eventsCsv).digest("hex"),
  megaThresholdUsd: MEGA_THRESHOLD_USD,
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
