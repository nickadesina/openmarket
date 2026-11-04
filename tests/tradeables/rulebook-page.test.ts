import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import RulebookChangelogPage from "../../src/app/rulebook/changelog/page.js";
import RulebookPage from "../../src/app/rulebook/page.js";
import { NOT_BUILT, RULEBOOK, RULEBOOK_VERSION } from "../../src/lib/engine/rulebook.js";
import { getRulebook } from "../../src/lib/services/get-rulebook.js";
import {
  anchorOf,
  leafRules,
  RULEBOOK_SECTIONS,
  ruleAt,
} from "../../src/lib/tradeables/rulebook-sections.js";

const html = renderToStaticMarkup(RulebookPage());

describe("/rulebook", () => {
  it("places every rule in RULEBOOK in a section", () => {
    const placed = RULEBOOK_SECTIONS.flatMap((section) =>
      section.rules.map((path) => path.join(".")),
    );
    const missing = leafRules()
      .map((path) => path.join("."))
      .filter((rule) => rule !== "version")
      .filter((rule) => !placed.some((path) => rule === path || rule.startsWith(`${path}.`)));
    expect(missing).toEqual([]);
    for (const section of RULEBOOK_SECTIONS) {
      for (const path of section.rules) expect(() => ruleAt(path)).not.toThrow();
    }
  });

  it("gives each rule a unique anchor a reviewer can link", () => {
    const anchors = RULEBOOK_SECTIONS.flatMap((section) => section.rules.map(anchorOf));
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const anchor of anchors) expect(html).toContain(`id="${anchor}"`);
    expect(html).toContain('id="forward-acquisition"');
  });

  it("renders each rule's text from RULEBOOK", () => {
    expect(html).toContain(RULEBOOK.print.definition);
    expect(html).toContain(RULEBOOK.forward.acquisition);
    for (const outlet of RULEBOOK.tier1_outlets) expect(html).toContain(outlet);
    expect(html).toContain(`${RULEBOOK.revision_window_days} days`);
  });

  it("marks the not-built rules from NOT_BUILT, each a real rule", () => {
    expect(NOT_BUILT.map((entry) => entry.rule)).toEqual(["charter", "review", "revision"]);
    for (const entry of NOT_BUILT) {
      expect(() => ruleAt(entry.rule.split("."))).not.toThrow();
      expect(html).toContain(entry.note);
    }
    expect(html).toContain("the code does not enforce them yet");
  });

  it("carries the version /api/ref/rulebook carries", () => {
    const payload = getRulebook(new Date("2026-10-27T00:00:00Z"));
    expect(payload.rulebook_version).toBe(RULEBOOK_VERSION);
    expect(payload.not_built).toBe(NOT_BUILT);
    expect(html).toContain(`<dd>${payload.rulebook_version}</dd>`);
    expect(payload).not.toHaveProperty("model_version");
  });

  it("renders the reviewers file under Reviewed by and links the changelog", () => {
    expect(html).toContain('id="reviewed-by"');
    expect(html).toContain('<th scope="col">What they challenged</th>');
    expect(html).toContain('href="/rulebook/changelog"');
    expect(renderToStaticMarkup(RulebookChangelogPage())).toContain(`${RULEBOOK_VERSION} (`);
  });

  it("has no em-dash", () => {
    expect(html).not.toContain("—");
  });
});
