/**
 * Validates every certificate transcription under data/index/certificates/
 * (`<slug>/<filed_on>.json`, schema src/lib/ingest/parse/certificate.ts)
 * and imports it, then links each to the round it prices:
 * `npm run index:certificates [-- --check]` (`--check` validates only, no
 * database). A changed transcription of an imported certificate is
 * published as a correction. Uses DATABASE_URL_UNPOOLED.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createDirectDatabase, destroyDatabase } from "../src/lib/db/client.js";
import { type Certificate, parseCertificate } from "../src/lib/ingest/parse/certificate.js";
import {
  importCertificate,
  linkCertificatePrints,
} from "../src/lib/services/index/import-certificates.js";

const ROOT = "data/index/certificates";

function transcriptions(): { path: string; text: string; certificate: Certificate }[] {
  if (!existsSync(ROOT)) return [];
  const found: { path: string; text: string; certificate: Certificate }[] = [];
  for (const slug of readdirSync(ROOT, { withFileTypes: true })) {
    if (!slug.isDirectory()) continue;
    for (const file of readdirSync(join(ROOT, slug.name)).filter((name) =>
      name.endsWith(".json"),
    )) {
      const path = join(ROOT, slug.name, file);
      const text = readFileSync(path, "utf8");
      try {
        found.push({ path, text, certificate: parseCertificate(text, path) });
      } catch (error) {
        throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

async function main(): Promise<void> {
  const files = transcriptions();
  console.log(`certificates: ${files.length} transcriptions valid`);
  if (process.argv.includes("--check")) return;
  const db = createDirectDatabase();
  try {
    for (const { path, text, certificate } of files) {
      const result = await importCertificate(db, certificate, text);
      console.log(`${path}: ${result.status}`);
    }
    for (const link of await linkCertificatePrints(db)) {
      console.log(
        `print for ${link.issuer} ${link.certificateFiledOn} (${link.seriesLabel} at $${link.pricePerShareUsd}): ${link.reason} ${link.roundName ?? ""}`,
      );
    }
  } finally {
    await destroyDatabase(db);
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error("index:certificates failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
