/**
 * Validates and imports every SPV unit-quote capture under
 * data/index/spv-quotes/ (`<slug>/*.json`, schema
 * src/lib/ingest/parse/spv-quote.ts): `npm run index:spv-quotes [-- --check]`.
 * Idempotent. Uses DATABASE_URL_UNPOOLED.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createDirectDatabase, destroyDatabase } from "../src/lib/db/client.js";
import { parseSpvQuote, type SpvQuote } from "../src/lib/ingest/parse/spv-quote.js";
import { importSpvQuote } from "../src/lib/services/index/import-spv-quotes.js";

const ROOT = "data/index/spv-quotes";

function captures(): { path: string; quote: SpvQuote }[] {
  if (!existsSync(ROOT)) return [];
  const found: { path: string; quote: SpvQuote }[] = [];
  for (const slug of readdirSync(ROOT, { withFileTypes: true })) {
    if (!slug.isDirectory()) continue;
    for (const file of readdirSync(join(ROOT, slug.name)).filter((name) =>
      name.endsWith(".json"),
    )) {
      const path = join(ROOT, slug.name, file);
      try {
        const quote = parseSpvQuote(readFileSync(path, "utf8"));
        if (quote.issuer !== slug.name) throw new Error(`issuer ${quote.issuer} in ${slug.name}/`);
        found.push({ path, quote });
      } catch (error) {
        throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

async function main(): Promise<void> {
  const files = captures();
  console.log(`spv-quotes: ${files.length} captures valid`);
  if (process.argv.includes("--check") || files.length === 0) return;
  const db = createDirectDatabase();
  try {
    for (const { path, quote } of files) console.log(`${path}: ${await importSpvQuote(db, quote)}`);
  } finally {
    await destroyDatabase(db);
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error("index:spv-quotes failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
