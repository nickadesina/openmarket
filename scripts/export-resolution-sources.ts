/**
 * Regenerates docs/tradeables/resolution-sources.md from
 * docs/tradeables/resolution-sources.json and the rulebook (OpenMarket's row
 * is computed, never typed). The same text is served at /resolution-sources.md.
 *
 *   npm run export:resolution-sources
 *   npm run export:resolution-sources -- --check   # exit 1 if the file is stale
 */
import { readFileSync, writeFileSync } from "node:fs";

import { renderResolutionSourcesMarkdown } from "../src/lib/tradeables/resolution-sources.js";

const OUTPUT = "docs/tradeables/resolution-sources.md";

const markdown = renderResolutionSourcesMarkdown();
if (process.argv.includes("--check")) {
  if (readFileSync(OUTPUT, "utf8") !== markdown) {
    console.error(`${OUTPUT} is stale; run npm run export:resolution-sources`);
    process.exitCode = 1;
  } else {
    console.log(`${OUTPUT} is current`);
  }
} else {
  writeFileSync(OUTPUT, markdown);
  console.log(`wrote ${OUTPUT}`);
}
