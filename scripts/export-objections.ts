/**
 * Writes docs/tradeables/objections-anon.md, the copy of the objection
 * catalog that leaves the repo: Who reduced to role and firm type from
 * docs/tradeables/objections-who.json, the answer column dropped
 * (src/lib/tradeables/objections.ts). A row with no entry in that file stops
 * the export with the Who to add.
 *
 *   npm run export:objections
 */
import { readFileSync, writeFileSync } from "node:fs";

import { renderAnonymizedObjections } from "../src/lib/tradeables/objections.js";

const OUTPUT = "docs/tradeables/objections-anon.md";

try {
  const markdown = renderAnonymizedObjections(
    readFileSync("docs/tradeables/objections.md", "utf8"),
    JSON.parse(readFileSync("docs/tradeables/objections-who.json", "utf8")) as Record<
      string,
      string
    >,
  );
  writeFileSync(OUTPUT, markdown);
  console.log(`wrote ${OUTPUT}`);
} catch (error: unknown) {
  console.error("Objection export failed:", error instanceof Error ? error.message : "");
  process.exitCode = 1;
}
