/**
 * Captures one real response from each /api/ref/* route of a running server
 * into docs/tradeables/ref-examples.json, which the /ref docs page renders.
 * Run it against a dev server on a database with listings and at least one
 * dealer run (README section 4):
 *
 *   npm run dev                                  # in another shell
 *   npm run export:ref-examples                  # http://localhost:3000
 *   npm run export:ref-examples -- --origin=http://localhost:3100 --slug=anthropic
 *
 * The withheld keys (src/lib/tradeables/ref-docs.ts) are removed before the
 * file is written, and each array keeps its first two entries.
 */
import { writeFileSync } from "node:fs";

import { firstEntries, WITHHELD_KEYS, withholdKeys } from "../src/lib/tradeables/ref-docs.js";

const OUTPUT = "docs/tradeables/ref-examples.json";
const ENTRIES = 2;

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function fetchJson(origin: string, path: string): Promise<unknown> {
  const response = await fetch(new URL(path, origin));
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return response.json();
}

async function main(): Promise<void> {
  const origin = argument("origin") ?? "http://localhost:3000";
  const listings = (await fetchJson(origin, "/api/ref/listings")) as {
    readonly listings: readonly { readonly slug: string }[];
  };
  const slug = argument("slug") ?? listings.listings[0]?.slug;
  if (slug === undefined)
    throw new Error("no listings: run npm run seed:listings and a dealer run");

  const paths = {
    listings: "/api/ref/listings",
    reference: `/api/ref/${slug}`,
    history: `/api/ref/${slug}/history?limit=${ENTRIES}`,
    mids: `/api/ref/${slug}/mids?limit=${ENTRIES}`,
    flags: `/api/ref/${slug}/flags?limit=${ENTRIES}`,
    rulebook: "/api/ref/rulebook",
  };
  const examples: Record<string, { readonly request: string; readonly response: unknown }> = {};
  for (const [name, path] of Object.entries(paths)) {
    examples[name] = {
      request: `GET ${path}`,
      response: firstEntries(withholdKeys(await fetchJson(origin, path)), ENTRIES),
    };
  }
  const file = {
    captured_at: new Date().toISOString(),
    slug,
    note: `Real responses from a development server. Keys withheld: ${WITHHELD_KEYS.join(", ")}. Arrays keep their first ${ENTRIES} entries.`,
    examples,
  };
  writeFileSync(OUTPUT, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`wrote ${OUTPUT} from ${origin} (${slug})`);
}

try {
  await main();
} catch (error: unknown) {
  console.error("Reference example capture failed:", error instanceof Error ? error.message : "");
  process.exitCode = 1;
}
