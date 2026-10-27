import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import params from "../../backtest/out/params.json";
import RefPage from "../../src/app/ref/page.js";
import FeedTrialPage from "../../src/app/ref/trial/page.js";
import { RULEBOOK_VERSION } from "../../src/lib/engine/dealer/rulebook.js";
import { REF_ROUTES, WITHHELD_KEYS, withholdKeys } from "../../src/lib/tradeables/ref-docs.js";

const html = renderToStaticMarkup(RefPage());
const examples = readFileSync("docs/tradeables/ref-examples.json", "utf8");

/** The construction's names as the API spells them, and as params.json does. */
const CONSTRUCTION_NAMES = [
  ...Object.keys(params.dealer),
  ...Object.keys(params.prior),
  "sigma_tier",
  "spread_floor",
  "lambda_months",
  "max_weight",
  "v0_usd",
  "n_min",
  "n0",
];

describe("/ref", () => {
  it("documents every reference route with a captured example", () => {
    const captured = JSON.parse(examples) as { examples: Record<string, unknown> };
    for (const route of REF_ROUTES) {
      expect(html).toContain(`GET ${route.path}`);
      expect(captured.examples[route.example]).toBeDefined();
    }
  });

  it("shows none of the withheld keys or the construction's names", () => {
    for (const text of [html, examples]) {
      for (const key of WITHHELD_KEYS) {
        expect(text).not.toContain(`"${key}":`);
        expect(text).not.toContain(`&quot;${key}&quot;:`);
        expect(text).not.toContain(`<code>${key}</code>`);
      }
      for (const name of CONSTRUCTION_NAMES) {
        expect(new RegExp(`\\b${name}\\b`).test(text), name).toBe(false);
      }
    }
  });

  it("withholds keys at any depth", () => {
    expect(
      withholdKeys({ a: [{ weights: 1, inputs: { k: 2 }, ok: true }], parameters: {}, b: 1 }),
    ).toEqual({ a: [{ ok: true }], b: 1 });
  });

  it("states the quotas, the key tiers and the live versions", () => {
    expect(html).toContain("60 requests a minute per network");
    expect(html).toContain("600 a minute by default");
    expect(html).toContain("expire 365 days after they are");
    expect(html).toContain("API_KEY_EXPIRED");
    expect(html).toContain(RULEBOOK_VERSION);
    expect(html).toContain('href="/data/round-history.csv"');
    expect(html).toContain("/api/t/questions/{slug}/forecasts");
  });

  it("has no em-dash", () => {
    expect(html).not.toContain("—");
    expect(examples).not.toContain("—");
  });
});

describe("/ref/trial", () => {
  it("renders docs/tradeables/feed-trial.md with its title and sections", () => {
    const trial = renderToStaticMarkup(FeedTrialPage());
    expect(trial).toContain("<h1>Reference feed, design-partner trial</h1>");
    for (const id of ["what-you-get", "what-you-agree-to", "what-it-is-not", "how-to-start"]) {
      expect(trial).toContain(`id="${id}"`);
    }
    expect(trial).toContain('href="/ref"');
    expect(trial).not.toContain("—");
  });
});
