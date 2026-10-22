import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/services/dealer/ref-access.js", () => ({ consumeRefQuota: vi.fn() }));

import { withRefRoute } from "../../src/lib/api/ref-route.js";

describe("reference cache policy", () => {
  it("keeps authenticated responses out of shared caches", async () => {
    const response = await withRefRoute(
      new Request("https://example.test/api/ref/rulebook", {
        headers: { authorization: "Bearer test" },
      }),
      [],
      () => ({ ok: true }),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
  });
  it("varies public cached responses on authorization too", async () => {
    const response = await withRefRoute(
      new Request("https://example.test/api/ref/rulebook"),
      [],
      () => ({ ok: true }),
    );
    expect(response.headers.get("cache-control")).toContain("s-maxage=60");
    expect(response.headers.get("vary")).toBe("Authorization");
  });
});
