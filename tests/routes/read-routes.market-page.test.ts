import { expect, it, vi } from "vitest";
import { ServiceError } from "../../src/lib/api/errors.js";

const mocks = vi.hoisted(() => ({ getMarket: vi.fn() }));
vi.mock("../../src/lib/db/runtime.js", () => ({ getRuntimeDatabase: () => ({}) }));
vi.mock("../../src/lib/services/get-market.js", () => ({ getMarket: mocks.getMarket }));
vi.mock("../../src/lib/services/get-activity.js", () => ({
  getActivity: async () => ({ items: [] }),
}));

import MarketPage from "../../src/app/m/[slug]/page.js";

it("returns the Next not-found boundary for an unknown market", async () => {
  mocks.getMarket.mockRejectedValue(new ServiceError("MARKET_NOT_FOUND", "Missing"));
  await expect(MarketPage({ params: Promise.resolve({ slug: "missing" }) })).rejects.toThrow(
    "NEXT_HTTP_ERROR_FALLBACK;404",
  );
});
