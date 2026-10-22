import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeDistribution } from "../../src/components/home-distribution/home-distribution.js";
import { MarketBoard } from "../../src/components/market-board/market-board.js";
import { PortfolioPage } from "../../src/components/portfolio/portfolio-page.js";
import { queryKeys } from "../../src/lib/client/query-keys.js";

describe("markets cleanup states", () => {
  it("does not dereference a signed-out identity cached before header sign-in", () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.portfolio, null);
    client.setQueryData([...queryKeys.portfolio, 0, 20], { userId: "new-user" });
    expect(() =>
      renderToStaticMarkup(
        createElement(QueryClientProvider, { client }, createElement(PortfolioPage)),
      ),
    ).not.toThrow();
  });
  it("renders a loading state for the distribution tab", () => {
    const client = new QueryClient();
    const html = renderToStaticMarkup(
      createElement(QueryClientProvider, { client }, createElement(HomeDistribution)),
    );
    expect(html).toContain("Loading distributions");
  });
});

it("keeps the last confirmed board prices after a poll fails", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.markets, {
    listings: [
      {
        listingId: "saved",
        company: { name: "Saved listing", slug: "saved", logoPath: "/logos/modal.svg" },
        tier: "mega",
        vsLastRound: 0,
        forward: { mid_usd: 1e9, bid_usd: 9e8, ask_usd: 1.1e9 },
        binary: null,
        openInterest: { totalUsd: 0 },
      },
    ],
  });
  await client
    .fetchQuery({
      queryKey: queryKeys.markets,
      queryFn: async () => {
        throw new Error("Offline");
      },
    })
    .catch(() => undefined);
  const html = renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(MarketBoard)),
  );
  expect(html).toContain("Saved listing");
  expect(html).toContain("$1B");
});
