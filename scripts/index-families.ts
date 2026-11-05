/**
 * Drafts data/index/filer-families.json from the registrants in
 * data/index/filings-by-name.csv and each one's latest N-CEN:
 *
 *   SEC_USER_AGENT="OpenMarket-Index/0.1 (+https://openmarket.systems)" \
 *     npm run index:families [-- --cache=<dir>]
 *
 * Families already in the file are kept as they are; new CIKs are placed by
 * their N-CEN adviser (src/lib/services/index/build-families.ts says how).
 * Rerun `npm run index:search` afterwards so the CSV's family column follows.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { withDiskCache } from "../src/lib/ingest/fetch/disk-cache.js";
import { createSecClient } from "../src/lib/ingest/fetch/sec.js";
import {
  buildFamilies,
  type RegistrantAdviser,
  registrantAdviser,
} from "../src/lib/services/index/build-families.js";
import {
  FILER_FAMILIES_PATH,
  FILINGS_CSV_PATH,
  loadFilerFamilies,
} from "../src/lib/services/index/data-files.js";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

/** CIK → the filer name of its latest filing in the search output. */
function registrants(csv: string): Map<string, string> {
  const latest = new Map<string, { name: string; filed: string }>();
  for (const line of csv.trim().split("\n").slice(1)) {
    const fields: string[] = [];
    for (const match of line.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)) {
      fields.push(match[1]!.replace(/^"|"$/g, "").replaceAll('""', '"'));
      if (match[2] === "") break;
    }
    const [, , filer, cik, , filed] = fields;
    if (cik === undefined || filer === undefined) continue;
    const previous = latest.get(cik);
    if (previous === undefined || (filed ?? "") > previous.filed) {
      latest.set(cik, { name: filer, filed: filed ?? "" });
    }
  }
  return new Map([...latest].map(([cik, { name }]) => [cik, name]));
}

async function main(): Promise<void> {
  const cache = argument("cache");
  const secClient = createSecClient();
  const client = cache === undefined ? secClient : withDiskCache(secClient, cache);
  const existing = loadFilerFamilies();
  const placed = new Set(existing.families.flatMap((family) => family.ciks));
  const pending = [...registrants(readFileSync(FILINGS_CSV_PATH, "utf8"))].filter(
    ([cik]) => !placed.has(cik),
  );
  console.log(`${pending.length} registrants to place`);
  const found: RegistrantAdviser[] = [];
  for (const [index, [cik, name]] of pending.entries()) {
    try {
      found.push(await registrantAdviser(client, cik, name));
    } catch (error) {
      console.warn(`${cik} ${name}: ${error instanceof Error ? error.message : error}`);
      found.push({ cik, registrantName: name, ncen: null, advisers: [] });
    }
    if ((index + 1) % 50 === 0) console.log(`${index + 1} of ${pending.length}`);
  }
  const version = existing.families.length === 0 ? "0.1.0" : existing.version;
  const families = buildFamilies(
    {
      ...existing,
      note:
        existing.note ??
        "Registrant CIKs grouped by the adviser firm their latest N-CEN names for their funds (drafted by npm run index:families from EDGAR; edited by hand where a registrant files no N-CEN). A CIK in no family is its own family. P3's engine reads this file.",
    },
    found,
    version,
  );
  writeFileSync(FILER_FAMILIES_PATH, `${JSON.stringify(families, null, 2)}\n`);
  const multi = families.families.filter((family) => family.ciks.length > 1);
  console.log(
    `wrote ${FILER_FAMILIES_PATH}: ${families.families.length} families, ${multi.length} with more than one registrant`,
  );
}

try {
  await main();
} catch (error: unknown) {
  console.error("index:families failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
