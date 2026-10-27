import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseObjections,
  renderAnonymizedObjections,
} from "../../src/lib/tradeables/objections.js";

const catalog = readFileSync("docs/tradeables/objections.md", "utf8");
const whoMap = JSON.parse(readFileSync("docs/tradeables/objections-who.json", "utf8")) as Record<
  string,
  string
>;
const exported = renderAnonymizedObjections(catalog, whoMap);

/**
 * What in a Who cell can identify the speaker: names and firms (capitalised
 * words), handles, domains, quoted titles, and the cell's first segment.
 * A word the anonymised form itself uses ("president") is a role, not a name.
 */
function identifiers(who: string, anonymized: string): string[] {
  const tokens = [
    ...(who.match(/[A-Z][\w.]*|@\w+|\w+\.\w+|"[^"]+"/g) ?? []),
    who.split(/[,(]/)[0]!.trim(),
  ];
  return tokens.filter((token) => !anonymized.toLowerCase().includes(token.toLowerCase()));
}

describe("docs/tradeables/objections-anon.md", () => {
  it("is what scripts/export-objections.ts writes", () => {
    expect(readFileSync("docs/tradeables/objections-anon.md", "utf8")).toBe(exported);
  });

  it("names no speaker and no speaker's firm", () => {
    for (const [who, anonymized] of Object.entries(whoMap)) {
      for (const identifier of identifiers(who, anonymized)) {
        expect(exported, `${identifier} from "${who}"`).not.toContain(identifier);
      }
    }
    for (const known of [
      "Pantera",
      "Jay Yu",
      "dingaling",
      "Predict.fun",
      "a16z",
      "Speedrun",
      "Nick",
    ]) {
      expect(exported).not.toContain(known);
    }
  });

  it("drops the answer column and keeps every objection", () => {
    const rows = parseObjections(catalog);
    for (const row of rows) {
      expect(exported).not.toContain(row.answer);
      expect(exported).toContain(`| ${row.objection} |`);
    }
    expect(exported).not.toContain("Current answer");
    expect(exported).not.toContain("—");
  });

  it("refuses a row whose speaker has no role and firm type yet", () => {
    const added = `${catalog.trimEnd()}\n| 2026-10-27 | Jane Doe, Example Capital | A new objection. | depth | An answer. | open |\n`;
    expect(() => renderAnonymizedObjections(added, whoMap)).toThrow(/Jane Doe, Example Capital/);
  });
});
