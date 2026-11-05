/**
 * Regenerates docs/tradeables/ref-examples.json, the example payloads /ref
 * renders, from a database: each route's service is called as the route
 * calls it, under the published families, and the payload is cut for
 * reading (arrays keep their first entries, long strings end in "…"; every
 * cut is recorded with the original length). Nothing in the file is typed
 * by hand.
 *
 *   npm run export:ref-examples [-- --slug=anthropic]
 *
 * Uses DATABASE_URL_UNPOOLED (the local development database with ingested
 * data; see README).
 */
import { writeFileSync } from "node:fs";

import { createDirectDatabase, destroyDatabase } from "../src/lib/db/client.js";
import { getRefCorrections } from "../src/lib/services/index/ref-corrections.js";
import { getRefMarks } from "../src/lib/services/index/ref-marks.js";
import { getRefMethodology } from "../src/lib/services/index/ref-methodology.js";
import { getRefName } from "../src/lib/services/index/ref-name.js";
import { getRefNames } from "../src/lib/services/index/ref-names.js";
import { getRefRevisions } from "../src/lib/services/index/ref-revisions.js";
import { getRefSpv } from "../src/lib/services/index/ref-spv.js";

const OUTPUT = "docs/tradeables/ref-examples.json";
const KEEP_ENTRIES = 2;
const KEEP_CHARACTERS = 400;

interface Cut {
  readonly path: string;
  readonly length: number;
}

/** The value cut for reading, with each cut's path and original length. */
export function cutForReading(value: unknown, path = "", cuts: Cut[] = []): unknown {
  if (Array.isArray(value)) {
    if (value.length > KEEP_ENTRIES) cuts.push({ path: path || "$", length: value.length });
    return value
      .slice(0, KEEP_ENTRIES)
      .map((entry, index) => cutForReading(entry, `${path}[${index}]`, cuts));
  }
  if (typeof value === "string" && value.length > KEEP_CHARACTERS) {
    cuts.push({ path, length: value.length });
    return `${value.slice(0, KEEP_CHARACTERS)}…`;
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        cutForReading(entry, path === "" ? key : `${path}.${key}`, cuts),
      ]),
    );
  }
  return value;
}

function example(request: string, payload: unknown) {
  const cuts: Cut[] = [];
  const response = cutForReading(JSON.parse(JSON.stringify(payload)), "", cuts);
  return { request, response, cuts };
}

async function main(): Promise<void> {
  const slug =
    process.argv.find((arg) => arg.startsWith("--slug="))?.slice("--slug=".length) ?? "anthropic";
  const db = createDirectDatabase();
  const now = new Date();
  try {
    const marks = await getRefMarks(db, slug, { limit: 2, include: "live" }, { now });
    const file = {
      generated_at: now.toISOString(),
      generated_by: "npm run export:ref-examples",
      slug,
      note: `Payloads from the route services against the development database with ingested EDGAR data. Arrays keep their first ${KEEP_ENTRIES} entries and strings their first ${KEEP_CHARACTERS} characters; each example's cuts list what was cut and its length.`,
      examples: {
        names: example("GET /api/ref/names", await getRefNames(db, { now })),
        name: example(`GET /api/ref/${slug}`, await getRefName(db, slug, { now })),
        marks: example(`GET /api/ref/${slug}/marks?limit=2`, marks),
        revisions: example(
          `GET /api/ref/${slug}/revisions`,
          await getRefRevisions(db, slug, { now }),
        ),
        spv: example(`GET /api/ref/${slug}/spv`, await getRefSpv(db, slug, { now })),
        methodology: example(
          "GET /api/ref/methodology",
          await getRefMethodology(db, { includeFamilies: false }, { now }),
        ),
        corrections: example(
          "GET /api/ref/corrections?limit=1",
          await getRefCorrections(db, { limit: 1 }, { now }),
        ),
      },
    };
    writeFileSync(OUTPUT, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`wrote ${OUTPUT} (${slug}, ${marks.marks.length} marks on the first page)`);
  } finally {
    await destroyDatabase(db);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (error: unknown) {
    console.error("export:ref-examples failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
