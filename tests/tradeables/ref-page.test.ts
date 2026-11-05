import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import RefPage from "../../src/app/ref/page.js";
import { METHODOLOGY_VERSION } from "../../src/lib/engine/index/methodology.js";
import { RULEBOOK_VERSION } from "../../src/lib/engine/rulebook.js";
import { ENVELOPE_KEYS, LAG_NOTE } from "../../src/lib/services/index/ref-envelope.js";
import { ATTRIBUTION, DATASETS, REF_ROUTES } from "../../src/lib/tradeables/ref-docs.js";

const html = renderToStaticMarkup(RefPage());
const examples = JSON.parse(readFileSync("docs/tradeables/ref-examples.json", "utf8")) as {
  generated_by: string;
  examples: Record<string, { request: string; response: Record<string, unknown> }>;
};

describe("/ref", () => {
  it("documents every reference route and dataset", () => {
    expect(REF_ROUTES.map((route) => route.path)).toEqual([
      "/api/ref/names",
      "/api/ref/{slug}",
      "/api/ref/{slug}/marks",
      "/api/ref/{slug}/revisions",
      "/api/ref/{slug}/spv",
      "/api/ref/methodology",
      "/api/ref/corrections",
      "/api/ref/rulebook",
    ]);
    for (const route of REF_ROUTES) expect(html).toContain(`GET ${route.path}`);
    for (const dataset of DATASETS) expect(html).toContain(`href="${dataset.path}"`);
    expect(html).toContain('href="/data/round-history.csv"');
  });

  it("renders a generated example for every index route, each opening with the envelope", () => {
    expect(examples.generated_by).toBe("npm run export:ref-examples");
    for (const route of REF_ROUTES.filter((entry) => entry.example !== undefined)) {
      const example = examples.examples[route.example!];
      expect(example, route.path).toBeDefined();
      expect(Object.keys(example!.response).slice(0, ENVELOPE_KEYS.length)).toEqual([
        ...ENVELOPE_KEYS,
      ]);
      expect(html).toContain(example!.request);
      // Every field the docs list is in the generated payload, and nothing undocumented is.
      expect(Object.keys(example!.response).sort()).toEqual(Object.keys(route.fields).sort());
    }
  });

  it("lists no route v1's dealer or tournament served", () => {
    for (const path of ["/api/ref/listings", "/api/t/", "/ref/trial"]) {
      expect(html).not.toContain(path);
    }
    for (const word of ["model_version", "blend_version", "dealer", "tournament"]) {
      expect(html).not.toContain(word);
    }
  });

  it("states the lag, the quotas, the key tiers, the licence and the live versions", () => {
    expect(html).toContain(LAG_NOTE);
    expect(html).toContain("60 requests a minute per network");
    expect(html).toContain("600 a minute by default");
    expect(html).toContain("expire 365 days after they are");
    expect(html).toContain("npm run api-key:create");
    expect(html).toContain("API_KEY_EXPIRED");
    expect(html).toContain("NAME_NOT_FOUND");
    expect(html).toContain(ATTRIBUTION);
    expect(html).toContain('href="/data/LICENSE"');
    expect(html).toContain(RULEBOOK_VERSION);
    expect(html).toContain(METHODOLOGY_VERSION);
  });

  it("has no em-dash", () => {
    expect(html).not.toContain("—");
  });
});
