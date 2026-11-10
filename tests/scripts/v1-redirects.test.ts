import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config.js";

const ARCHIVE = "https://v1.openmarket.systems";

describe("v1's paths", () => {
  it("send the bare path to the archive without a trailing slash, and subpaths after it", async () => {
    const redirects = (await nextConfig.redirects?.()) ?? [];
    for (const path of ["/m", "/t", "/portfolio", "/admin", "/for-policy"]) {
      expect(redirects).toContainEqual({
        source: path,
        destination: `${ARCHIVE}${path}`,
        permanent: false,
      });
      expect(redirects).toContainEqual({
        source: `${path}/:path+`,
        destination: `${ARCHIVE}${path}/:path+`,
        permanent: false,
      });
    }
  });
});
