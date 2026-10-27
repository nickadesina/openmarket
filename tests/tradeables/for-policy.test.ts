import { existsSync, readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ForPolicyPage from "../../src/app/for-policy/page.js";
import { RULEBOOK_VERSION } from "../../src/lib/engine/dealer/rulebook.js";

const html = renderToStaticMarkup(ForPolicyPage());
const caseStudy = readFileSync("docs/tradeables/case-study.md", "utf8");

/** A site path resolves when public/ serves it or src/app has a page or route for it. */
function resolves(path: string): boolean {
  const clean = path.split("#")[0]!.replace(/\/$/, "");
  if (existsSync(`public${clean}`)) return true;
  const app = `src/app${clean}`;
  return ["page.tsx", "route.ts"].some((file) => existsSync(`${app}/${file}`));
}

describe("/for-policy", () => {
  it("renders the case study with the live rulebook version", () => {
    expect(html).toContain("A US founder building valuation contracts on private companies");
    expect(html).toContain('id="the-question-a-founder-cannot-answer-alone"');
    expect(html).toContain(`<dd>${RULEBOOK_VERSION}</dd>`);
    expect(html).toContain(`Rulebook v${RULEBOOK_VERSION}`);
  });

  it("links only paths the site serves", () => {
    const paths = [...html.matchAll(/href="(\/[^"]*)"/g)].map((match) => match[1]!);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/rulebook",
        "/data/round-history.csv",
        "/resolution-sources",
        "/ref",
      ]),
    );
    for (const path of paths) expect(resolves(path), path).toBe(true);
  });

  it("fills the dataset figures from the committed export", () => {
    const header = JSON.parse(readFileSync("public/data/round-history.json", "utf8")) as {
      rows: number;
      as_of: string;
    };
    expect(html).toContain(`${header.rows} rows through ${header.as_of}`);
    expect(html).toContain("CC BY 4.0, cite OpenMarket");
  });

  it("keeps every section of the case study but its Links", () => {
    for (const [, heading] of caseStudy.matchAll(/^## (.+)$/gm)) {
      expect(html).toContain(`>${heading!.replaceAll("'", "&#x27;")}<`);
    }
    expect(html).not.toContain("—");
  });
});
