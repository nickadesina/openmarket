/**
 * A development convenience for the ingest scripts (`--cache=<dir>`): keeps
 * every EDGAR response on disk by the SHA-256 of its URL, so a rerun reads
 * what it already fetched instead of asking SEC again. Never used by the cron
 * job; a cached search response goes stale as EDGAR indexes new filings.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { SecClient } from "./sec.js";

export function withDiskCache(client: SecClient, directory: string): SecClient {
  mkdirSync(directory, { recursive: true });
  async function cached(url: string): Promise<string> {
    const path = join(directory, createHash("sha256").update(url).digest("hex"));
    if (existsSync(path)) return readFileSync(path, "utf8");
    const text = await client.text(url);
    writeFileSync(path, text);
    return text;
  }
  return {
    userAgent: client.userAgent,
    text: cached,
    async json(url) {
      return JSON.parse(await cached(url)) as unknown;
    },
  };
}
