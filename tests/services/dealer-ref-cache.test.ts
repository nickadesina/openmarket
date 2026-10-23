import { describe, expect, it, vi } from "vitest";
import { afterPosition } from "../../src/lib/services/dealer/ref-common.js";

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
  it.each([
    { at: "2026-10-20T00:00:00.000000Z", key: "0-0", type: "uuid" as const },
    { at: "2026-10-20T00:00:00.000000Z", key: "9223372036854775808", type: "bigint" as const },
    { at: "2026-02-30T00:00:00.000000Z", key: "1", type: "bigint" as const },
  ])("returns 400 for an invalid $type reference cursor", async ({ at, key, type }) => {
    const response = await withRefRoute(
      new Request("https://example.test/api/ref/test/history"),
      [],
      () => afterPosition("at", "id", { at, key }, type),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
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
