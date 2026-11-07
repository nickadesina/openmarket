import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as index from "../../../src/lib/engine/index/index.js";
import { METHODOLOGY, METHODOLOGY_VERSION } from "../../../src/lib/engine/index/methodology.js";
import { CE_VERSION } from "../../../src/lib/engine/index/waterfall.js";

const DOC = readFileSync(new URL("../../../METHODOLOGY.md", import.meta.url), "utf8");

/** The `| `key` | `value` | … |` rows of METHODOLOGY.md's Constants section. */
function documentedConstants(): Map<string, string> {
  const section = DOC.split(/^## /m).find((part) => part.startsWith("Constants\n"));
  if (section === undefined) throw new Error("METHODOLOGY.md has no Constants section");
  const rows = new Map<string, string>();
  for (const match of section.matchAll(/^\| `([a-z_]+)` \| `([^`]+)` \|/gm)) {
    if (rows.has(match[1]!)) throw new Error(`${match[1]} is documented twice`);
    rows.set(match[1]!, match[2]!);
  }
  return rows;
}

describe("METHODOLOGY", () => {
  it("is frozen and versioned", () => {
    expect(Object.isFrozen(METHODOLOGY)).toBe(true);
    expect(METHODOLOGY_VERSION).toBe("0.2.0");
    expect(METHODOLOGY.methodology_version).toBe(METHODOLOGY_VERSION);
    expect(METHODOLOGY.ce_version).toBe(CE_VERSION);
    expect(index.METHODOLOGY).toBe(METHODOLOGY);
  });

  it("holds the constants the brief sets", () => {
    expect(METHODOLOGY).toMatchObject({
      revision_threshold_ln: 0.005,
      leader_window_days: 180,
      intra_family_split_tolerance: 0.001,
      min_families_for_consensus: 3,
      min_families_for_dispersion: 3,
    });
  });

  it("is stated in METHODOLOGY.md exactly: every constant, and nothing else", () => {
    const documented = documentedConstants();
    const exported = new Map(
      Object.entries(METHODOLOGY).map(([key, value]) => [key, String(value)]),
    );
    expect(documented).toEqual(exported);
  });

  it("marks the document as the draft of its version", () => {
    expect(DOC).toContain(
      `**v${METHODOLOGY_VERSION} — draft, Nick's to sign before the first post.**`,
    );
  });
});
