/**
 * What the research scripts share: polite HTTP with retries, and CSV and
 * README writing. Their outputs go under docs/research/ and are private until
 * Nick reads them (docs/prompts/tradeables, "Research scripts").
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * GET with a minimum gap between requests (a token-bucket of one) and up to
 * four retries on 429, 5xx or a network error, backing off 2, 4, 8, 16 s.
 */
export function politeFetcher(options: {
  readonly minGapMs: number;
  readonly headers?: Readonly<Record<string, string>>;
}) {
  let next = 0;
  return async function get(url: string): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const wait = next - Date.now();
      if (wait > 0) await sleep(wait);
      next = Date.now() + options.minGapMs;
      try {
        const response = await fetch(url, { headers: options.headers ?? {} });
        if (response.status !== 429 && response.status < 500) return response;
        if (attempt >= 4) return response;
      } catch (error) {
        if (attempt >= 4) throw error;
      }
      await sleep(2_000 * 2 ** attempt);
    }
  };
}

export async function getJson<T>(get: (url: string) => Promise<Response>, url: string): Promise<T> {
  const response = await get(url);
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  return (await response.json()) as T;
}

function csvField(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function writeCsv(
  path: string,
  columns: readonly string[],
  rows: readonly Readonly<Record<string, unknown>>[],
): void {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [columns, ...rows.map((row) => columns.map((column) => row[column]))].map(
    (fields) => fields.map(csvField).join(","),
  );
  writeFileSync(path, `${lines.join("\n")}\n`);
}

export function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
