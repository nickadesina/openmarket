import { expect, type Page, test } from "@playwright/test";

import {
  adminPassphrase,
  type ErrorEnvelope,
  type ExecutionResponse,
  expectNoHorizontalOverflow,
  formatCents,
  isApiResponse,
  json,
  type PortfolioResponse,
  skipWithoutDatabase,
  type TradeRequest,
  uniqueNames,
} from "./helpers.js";

skipWithoutDatabase();

interface MarketResponse {
  readonly status: "open" | "settled";
  readonly sequence: string;
  readonly metric: { readonly current: number };
  readonly settlement: null | { readonly settledValueUsd: string };
}

interface ActivityResponse {
  readonly items: ReadonlyArray<{
    readonly marketSequence: string;
    readonly action: "buy" | "sell";
    readonly side: "yes" | "no";
  }>;
}

async function startAdminSession(page: Page): Promise<void> {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Market administration" })).toBeVisible();
  await page.getByLabel("Admin passphrase").fill(adminPassphrase());
  await page.getByRole("button", { name: "Start admin session" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Admin session authenticated" }),
  ).toBeVisible();
}

test("admin seed through settled portfolio with authoritative idempotent replay", async ({
  page,
  baseURL,
}, testInfo) => {
  const mobile = testInfo.project.name.includes("mobile");
  const { slug, companyName, username } = uniqueNames("critical", testInfo);
  const origin = new URL(baseURL ?? "").origin;

  await test.step("seed a binary market through the admin UI", async () => {
    await startAdminSession(page);
    await page.getByLabel("Binary probability").check();
    await page.getByLabel("Company name").fill(companyName);
    await page.getByLabel("Company slug").fill(slug);
    await page.getByLabel("Logo path").fill("/browser-proof.svg");
    await page.getByLabel("Liquidity parameter (b)").fill("250");
    await page.getByLabel("Initial YES probability").fill("0.50");

    const seedResponsePromise = page.waitForResponse((response) =>
      isApiResponse(response, "POST", "/api/admin/seed"),
    );
    await page.getByRole("button", { name: "Seed market" }).click();
    expect((await seedResponsePromise).status()).toBe(200);
    await expect(page.getByRole("status").filter({ hasText: `${slug} is open` })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  const ticket = page.getByRole("region", { name: "Trade ticket" });

  await test.step("quote anonymously; execution demands a username", async () => {
    await page.goto(`/m/${slug}`);
    await expect(page.getByRole("heading", { name: companyName })).toBeVisible();
    await expect(page.getByText("No trades yet", { exact: true })).toBeVisible();

    await page
      .getByRole("region", { name: "Outcome contract" })
      .getByRole("button", { name: /^YES/ })
      .click();
    await expect(ticket).toBeVisible();
    if (mobile) {
      await expect(page.getByRole("dialog", { name: `Trade ${companyName}` })).toBeVisible();
    }

    await ticket.getByRole("spinbutton", { name: "Spend" }).fill("125.00");
    const quotePromise = page.waitForResponse((response) =>
      isApiResponse(response, "POST", "/api/quote"),
    );
    await ticket.getByRole("button", { name: "Preview buy" }).click();
    const quoteResponse = await quotePromise;
    expect(quoteResponse.status()).toBe(200);
    expect(quoteResponse.request().postDataJSON()).toEqual({
      slug,
      action: "buy",
      side: "yes",
      strike_index: 0,
      spend_usd: "125.00",
    });
    expect(
      (await page.context().cookies()).some((cookie) => cookie.name === "openmarket_user"),
    ).toBe(false);
    await expect(ticket.getByText("Cost", { exact: true })).toBeVisible();

    const rejectedTradePromise = page.waitForResponse((response) =>
      isApiResponse(response, "POST", "/api/trade"),
    );
    await ticket.getByRole("button", { name: "Confirm buy" }).click();
    const rejectedTrade = await rejectedTradePromise;
    expect(rejectedTrade.status()).toBe(401);
    expect((await json<ErrorEnvelope>(rejectedTrade)).error.code).toBe("USER_REQUIRED");
    await expect(ticket.getByText("Username required", { exact: true })).toBeVisible();
  });

  let originalTradeRequest: TradeRequest | undefined;
  let firstExecution: ExecutionResponse | undefined;
  let replayedExecution!: ExecutionResponse;

  await test.step("a trade whose delivery is reset replays under the same idempotency key", async () => {
    await ticket.getByLabel("Username").fill(username);
    await page.route("**/api/trade", async (route) => {
      originalTradeRequest = route.request().postDataJSON() as TradeRequest;
      const upstream = await route.fetch();
      expect(upstream.status()).toBe(200);
      expect(upstream.headers()["idempotent-replayed"]).toBeUndefined();
      firstExecution = await json<ExecutionResponse>(upstream);
      // The server executed the real request; only its delivery is reset so the UI must safely replay it.
      await route.abort("connectionreset");
    });

    const userResponsePromise = page.waitForResponse((response) =>
      isApiResponse(response, "POST", "/api/user"),
    );
    await ticket.getByRole("button", { name: "Save username and trade" }).click();
    const userResponse = await userResponsePromise;
    expect(userResponse.status()).toBe(200);

    await expect(ticket.getByRole("button", { name: "Retry same trade" })).toBeVisible();
    await expect
      .poll(() => originalTradeRequest !== undefined && firstExecution !== undefined)
      .toBe(true);
    expect(originalTradeRequest).toMatchObject({
      slug,
      action: "buy",
      side: "yes",
      strike_index: 0,
      spend_usd: "125.00",
    });
    expect(originalTradeRequest?.idempotency_key).toBe(firstExecution?.idempotency_key);

    await page.unroute("**/api/trade");
    const replayPromise = page.waitForResponse((response) =>
      isApiResponse(response, "POST", "/api/trade"),
    );
    const marketRefreshPromise = page.waitForResponse(
      (response) =>
        isApiResponse(response, "GET", `/api/markets/${slug}`) && response.status() === 200,
    );
    const activityRefreshPromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "GET" &&
        url.pathname === "/api/activity" &&
        url.searchParams.get("slug") === slug &&
        response.status() === 200
      );
    });

    await ticket.getByRole("button", { name: "Retry same trade" }).click();
    const [replayResponse, marketRefresh, activityRefresh] = await Promise.all([
      replayPromise,
      marketRefreshPromise,
      activityRefreshPromise,
    ]);
    expect(replayResponse.status()).toBe(200);
    expect(replayResponse.headers()["idempotent-replayed"]).toBe("true");
    expect(replayResponse.request().postDataJSON()).toEqual(originalTradeRequest);
    replayedExecution = await json<ExecutionResponse>(replayResponse);
    expect(replayedExecution).toEqual(firstExecution);
    expect(replayedExecution.market_sequence).toBe("1");
    await expect(ticket.getByText("Trade completed", { exact: true })).toBeVisible();

    const refreshedMarket = await json<MarketResponse>(marketRefresh);
    expect(refreshedMarket.sequence).toBe("1");
    expect(refreshedMarket.metric.current).toBe(replayedExecution.current_metric);
    const refreshedActivity = await json<ActivityResponse>(activityRefresh);
    expect(refreshedActivity.items).toHaveLength(1);
    expect(refreshedActivity.items[0]).toMatchObject({
      marketSequence: "1",
      action: "buy",
      side: "yes",
    });
  });

  await test.step("the workspace reflects the executed trade", async () => {
    if (mobile) {
      await ticket.getByRole("button", { name: "Close trade ticket" }).click();
      await expect(page.getByRole("dialog", { name: `Trade ${companyName}` })).toBeHidden();
    }
    await expect(
      page.getByLabel("Current market metrics").getByText(/Moved up|Moved down|Unchanged/),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Market activity" }).getByText(/^Bought .* YES$/),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Market history" })
        .getByText(
          /YES probability (?:increased|decreased|was unchanged).*current 60-minute mark/i,
        ),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  let saleBalanceCents!: string;

  await test.step("part of the position sells from the portfolio", async () => {
    await page.goto("/portfolio");
    await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
    await expect(page.getByLabel("Portfolio summary").locator("div").first()).toContainText(
      formatCents(replayedExecution.cash_balance_cents),
    );

    const marketArticle = page.locator("article").filter({
      has: page.getByRole("link", { name: companyName, exact: true }),
    });
    await marketArticle.getByRole("button", { name: "Sell", exact: true }).click();
    const sellFlow = page.locator('[aria-label="Sell YES"]');
    const partialQuantity = Number((replayedExecution.shares / 2).toFixed(6));
    await sellFlow.getByLabel("Quantity", { exact: true }).fill(String(partialQuantity));
    await sellFlow.getByRole("button", { name: "Review sale" }).click();

    const salePromise = page.waitForResponse((response) =>
      isApiResponse(response, "POST", "/api/trade"),
    );
    await sellFlow.getByRole("button", { name: "Sell shares" }).click();
    const saleResponse = await salePromise;
    expect(saleResponse.status()).toBe(200);
    const sale = await json<ExecutionResponse>(saleResponse);
    expect(sale).toMatchObject({
      action: "sell",
      side: "yes",
      market_sequence: "2",
      shares: partialQuantity,
    });
    saleBalanceCents = sale.cash_balance_cents;
    await expect(page.getByRole("status").filter({ hasText: "Sale completed" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  await test.step("a sell quote by spend is rejected by input validation", async () => {
    const rejected = await page.request.post("/api/quote", {
      headers: { Origin: origin },
      data: { slug, action: "sell", side: "yes", strike_index: 0, spend_usd: "10.00" },
    });
    expect(rejected.status()).toBe(400);
    expect((await json<ErrorEnvelope>(rejected)).error).toMatchObject({
      code: "INVALID_INPUT",
      message: "Request body is invalid.",
    });
  });

  await test.step("settlement requires slug confirmation and credits the holder", async () => {
    await startAdminSession(page);
    await page.getByLabel("Market slug").fill(slug);
    await page.getByLabel("Settlement value (USD)").fill("1.00");
    await page.getByLabel("Public source URL").fill("https://example.com/openmarket-browser-proof");
    await page.getByLabel("Source description").fill("Browser proof confirmed outcome");
    await page.getByRole("button", { name: "Review settlement" }).click();
    await expect(page.getByRole("heading", { name: "Review the permanent outcome" })).toBeVisible();

    const settleButton = page.getByRole("button", { name: "Settle market permanently" });
    await page.getByLabel(/Retype .* exactly to confirm/).fill(`${slug}-typo`);
    await expect(settleButton).toBeDisabled();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "The confirmation must exactly match the market slug." }),
    ).toBeVisible();

    await page.getByLabel(/Retype .* exactly to confirm/).fill(slug);
    const settlementPromise = page.waitForResponse((response) =>
      isApiResponse(response, "POST", "/api/admin/settle"),
    );
    await settleButton.click();
    const settlementResponse = await settlementPromise;
    expect(settlementResponse.status()).toBe(200);
    expect(await settlementResponse.json()).toMatchObject({
      slug,
      settled_value_usd: "1.00",
      credited_users: 1,
    });
    await expect(page.getByRole("status").filter({ hasText: `${slug} settled` })).toBeVisible();
  });

  await test.step("the settled market is closed to trading", async () => {
    await page.goto(`/m/${slug}`);
    await expect(page.getByRole("heading", { name: companyName })).toBeVisible();
    await expect(page.getByText("Settled", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Settlement outcome")).toContainText("Resolved at $1");
    await expect(
      page
        .getByLabel("Settlement outcome")
        .getByRole("link", { name: "Browser proof confirmed outcome" }),
    ).toHaveAttribute("href", "https://example.com/openmarket-browser-proof");
    await expect(
      page.getByRole("region", { name: "Outcome contract" }).getByRole("button", { name: /^YES/ }),
    ).toBeDisabled();
    await expect(page.getByText("Trading closed", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Trade rail")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Trade ticket" })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    const settledMarket = await json<MarketResponse>(
      await page.request.get(`/api/markets/${slug}`),
    );
    expect(settledMarket.status).toBe("settled");
    expect(settledMarket.sequence).toBe("2");
    expect(settledMarket.settlement?.settledValueUsd).toBe("1.00");
  });

  await test.step("the payout lands in the portfolio", async () => {
    await page.goto("/portfolio");
    await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No open exposure" })).toBeVisible();

    const settledPortfolio = await json<PortfolioResponse>(
      await page.request.get("/api/portfolio?offset=0&limit=20"),
    );
    expect(settledPortfolio.tradeHistory.items).toHaveLength(2);
    expect(Number(settledPortfolio.cashBalanceCents)).toBeGreaterThan(Number(saleBalanceCents));
    await expect(page.getByLabel("Portfolio summary").locator("div").first()).toContainText(
      formatCents(settledPortfolio.cashBalanceCents),
    );
    await expectNoHorizontalOverflow(page);
  });
});
