import { METHODOLOGY } from "../engine/index/methodology.js";

/**
 * METHODOLOGY.md as /methodology renders it: the file as written, with its
 * Constants table rebuilt from the engine's `METHODOLOGY`, so the page shows
 * the values the code computes with. Each row keeps the file's meaning for
 * its constant; a constant the file does not describe is listed with
 * "Not described in METHODOLOGY.md", so a drift between the two shows on the
 * page (tests/engine/index/methodology.test.ts holds them equal).
 */
export const METHODOLOGY_PATH = "METHODOLOGY.md";

const CONSTANTS_HEAD = "| Constant | Value | Meaning |";

function liveValue(value: unknown): string {
  return `\`${typeof value === "string" ? value : JSON.stringify(value)}\``;
}

export function withLiveConstants(source: string): string {
  const lines = source.split("\n");
  const head = lines.indexOf(CONSTANTS_HEAD);
  if (head === -1) return source;
  let end = head + 2;
  const meanings = new Map<string, string>();
  while (end < lines.length && lines[end]!.startsWith("|")) {
    const [, name, , meaning] = lines[end]!.split(/(?<!\\)\|/).map((cell) => cell.trim());
    if (name !== undefined) meanings.set(name.replaceAll("`", ""), meaning ?? "");
    end += 1;
  }
  const rows = Object.entries(METHODOLOGY).map(
    ([name, value]) =>
      `| \`${name}\` | ${liveValue(value)} | ${meanings.get(name) ?? "Not described in METHODOLOGY.md."} |`,
  );
  return [...lines.slice(0, head + 2), ...rows, ...lines.slice(end)].join("\n");
}
