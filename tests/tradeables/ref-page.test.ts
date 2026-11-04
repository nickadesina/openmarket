import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import RefPage from "../../src/app/ref/page.js";
import { RULEBOOK_VERSION } from "../../src/lib/engine/rulebook.js";
import { REF_ROUTES } from "../../src/lib/tradeables/ref-docs.js";

const html = renderToStaticMarkup(RefPage());

describe("/ref", () => {
  it("documents every reference route", () => {
    for (const route of REF_ROUTES) expect(html).toContain(`GET ${route.path}`);
  });

  it("lists no route v1's dealer or tournament served", () => {
    expect(REF_ROUTES.map((route) => route.path)).toEqual(["/api/ref/rulebook"]);
    for (const path of ["/api/ref/listings", "/api/ref/{slug}", "/api/t/", "/ref/trial"]) {
      expect(html).not.toContain(path);
    }
    for (const word of ["model_version", "blend_version", "dealer", "tournament"]) {
      expect(html).not.toContain(word);
    }
  });

  it("states the quotas, the key tiers and the live version", () => {
    expect(html).toContain("60 requests a minute per network");
    expect(html).toContain("600 a minute by default");
    expect(html).toContain("expire 365 days after they are");
    expect(html).toContain("API_KEY_EXPIRED");
    expect(html).toContain(RULEBOOK_VERSION);
    expect(html).toContain('href="/data/round-history.csv"');
  });

  it("has no em-dash", () => {
    expect(html).not.toContain("—");
  });
});
