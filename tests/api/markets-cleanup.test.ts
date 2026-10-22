import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeDistribution } from "../../src/components/home-distribution/home-distribution.js";
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
