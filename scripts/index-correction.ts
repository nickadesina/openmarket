/**
 * Publishes a methodology change as one `corrections` row
 * (src/lib/services/index/record-correction.ts):
 *
 *   npm run index:correction -- --kind=methodology --version=0.2.0 \
 *     --summary="..." --diff=docs/corrections/methodology-0.2.0.md
 *
 * `--version` must be the methodology in force (METHODOLOGY_VERSION). The
 * row's `affected` records that version's constants and every watchlisted
 * name's headline recomputed under it. Idempotent: a correction of the same
 * kind and version already published is reported and nothing is written.
 * Only `methodology` is accepted: row and parser corrections are written
 * with the rows they correct (`index:certificates`, `index:relabel`).
 * Uses DATABASE_URL_UNPOOLED.
 */
import { readFileSync } from "node:fs";

import { createDirectDatabase, destroyDatabase } from "../src/lib/db/client.js";
import { recordMethodologyCorrection } from "../src/lib/services/index/record-correction.js";

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function required(name: string): string {
  const value = option(name)?.trim();
  if (value === undefined || value === "") throw new Error(`--${name}= is required`);
  return value;
}

async function main(): Promise<void> {
  const kind = required("kind");
  if (kind !== "methodology") {
    throw new Error(
      `--kind=${kind}: only methodology corrections are recorded here; row and parser corrections are written with their rows (index:certificates, index:relabel)`,
    );
  }
  const version = required("version");
  const summary = required("summary");
  const diffPath = required("diff");
  const diffMd = readFileSync(diffPath, "utf8");
  const db = createDirectDatabase();
  try {
    const result = await recordMethodologyCorrection(db, { version, summary, diffMd, diffPath });
    if (result.status === "exists") {
      console.log(
        `a methodology correction for ${version} is already published (${result.correctionId}, ${result.publishedAt.toISOString()}); nothing written`,
      );
    } else {
      console.log(
        `published methodology correction ${result.correctionId} for ${version} (${result.names} names' headlines recorded)`,
      );
    }
  } finally {
    await destroyDatabase(db);
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error("index:correction failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
