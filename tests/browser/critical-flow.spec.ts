import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type APIResponse,
  type Page,
  type Response as BrowserResponse,
} from "@playwright/test";

const databaseAvailable = Boolean(process.env.DATABASE_URL_TEST);
test.skip(
  !databaseAvailable,
  "DATABASE_URL_TEST is required for the real-route browser flow; local runs skip without it.",
);

test.describe.configure({ mode: "serial" });

interface UserResponse {
  readonly username: string;
  readonly cash_balance_cents: string;
}

interface QuoteResponse {
  readonly action: "buy" | "sell";
  readonly side: "yes" | "no";
  readonly strike_index: number;
  readonly quantity: number;
  readonly cash_amount_cents: string;
}

interface TradeRequest {
  readonly slug: string;
  readonly action: "buy" | "sell";
  readonly side: "yes" | "no";
  readonly strike_index: number;
  readonly idempotency_key: string;
  readonly spend_usd?: string;
  readonly quantity?: number;
  readonly max_cost_usd?: string;
  readonly min_proceeds_usd?: string;
}

interface ExecutionResponse {
  readonly trade_id: string;
  readonly idempotency_key: string;
  readonly market_sequence: string;
  readonly action: "buy" | "sell";
  readonly side: "yes" | "no";
  readonly strike_index: number;
  readonly shares: number;
  readonly cash_amount_cents: string;
  readonly average_price: number;
  readonly current_metric: number;
  readonly cash_balance_cents: string;
  readonly sellable_quantity: number;
}

interface MarketResponse {
  readonly status: "open" | "settled";
  readonly sequence: string;
  readonly metric: {
    readonly current: number;
  };
  readonly settlement: null | {
    readonly settledValueUsd: string;
  };
}

interface ActivityResponse {
  readonly items: ReadonlyArray<{
    readonly marketSequence: string;
    readonly action: "buy" | "sell";
    readonly side: "yes" | "no";
  }>;
}

interface MarksResponse {
  readonly points: ReadonlyArray<unknown>;
}

interface PortfolioResponse {
  readonly username: string;
  readonly cashBalanceCents: string;
  readonly markets: ReadonlyArray<{
    readonly status: "open" | "settled";
    readonly company: { readonly slug: string };
    readonly positions: ReadonlyArray<{
      readonly side: "yes" | "no";
      readonly strikeIndex: number;
      readonly quantity: number;
      readonly sellableQuantity: number;
    }>;
  }>;
  readonly tradeHistory: {
    readonly items: ReadonlyArray<{
      readonly action: "buy" | "sell";
      readonly marketSequence: string;
    }>;
  };
}

interface SettlementResponse {
  readonly slug: string;
  readonly settled_value_usd: string;
  readonly credited_users: number;
}

interface ErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

function adminPassphrase(): string {
  const value = process.env.PLAYWRIGHT_ADMIN_PASSPHRASE;
  if (value === undefined || value.length === 0) {
    throw new Error("PLAYWRIGHT_ADMIN_PASSPHRASE was not configured by playwright.config.ts");
  }
  return value;
}

function isApiResponse(
  response: BrowserResponse,
  method: string,
  pathname: string,
): boolean {
  return response.request().method() === method
    && new URL(response.url()).pathname === pathname;
}

async function json<T>(response: BrowserResponse | APIResponse): Promise<T> {
  return response.json() as Promise<T>;
}

function formatCents(cents: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(cents) / 100);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    const documentWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    );
    return documentWidth <= document.documentElement.clientWidth + 1;
  })).toBe(true);
}

test("admin seed through settled portfolio with authoritative idempotent refresh", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name.includes("mobile");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const slug = `browser-proof-${mobile ? "mobile" : "desktop"}-${suffix}`;
  const companyName = `Browser Proof ${mobile ? "Mobile" : "Desktop"} ${suffix}`;
  const username = `reader_${suffix}`;

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Market administration" })).toBeVisible();
  await page.getByLabel("Admin passphrase").fill(adminPassphrase());
  await page.getByRole("button", { name: "Start admin session" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Admin session authenticated" })).toBeVisible();

  await page.getByLabel("Binary probability").check();
  await page.getByLabel("Company name").fill(companyName);
  await page.getByLabel("Company slug").fill(slug);
  await page.getByLabel("Logo path").fill("/browser-proof.svg");
  await page.getByLabel("Liquidity parameter (b)").fill("250");
  await page.getByLabel("Initial YES probability").fill("0.50");

  const seedResponsePromise = page.waitForResponse(
    (response) => isApiResponse(response, "POST", "/api/admin/seed"),
  );
  await page.getByRole("button", { name: "Seed market" }).click();
  const seedResponse = await seedResponsePromise;
  expect(seedResponse.status()).toBe(200);
  await expect(page.getByRole("status").filter({ hasText: `${slug} is open` })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto(`/m/${slug}`);
  await expect(page.getByRole("heading", { name: companyName })).toBeVisible();
  await expect(page.getByText("No trades yet", { exact: true })).toBeVisible();
  const liveMetric = page.getByLabel("Current market metrics").locator("strong").first();
  const metricBeforeQuote = await liveMetric.innerText();

  const ladder = page.getByRole("region", { name: "Outcome contract" });
  const yesButton = ladder.getByRole("button", { name: /YES$/ });
  await yesButton.click();

  const ticket = page.getByRole("region", { name: "Trade ticket" });
  await expect(ticket).toBeVisible();
  if (mobile) {
    await expect(page.getByRole("dialog", { name: `Trade ${companyName}` })).toBeVisible();
  }
  await ticket.getByLabel("Spend").fill("125.00");

  const anonymousQuotePromise = page.waitForResponse(
    (response) => isApiResponse(response, "POST", "/api/quote"),
  );
  await ticket.getByRole("button", { name: "Preview buy" }).click();
  const anonymousQuoteResponse = await anonymousQuotePromise;
  expect(anonymousQuoteResponse.request().postDataJSON()).toEqual({
    slug,
    action: "buy",
    side: "yes",
    strike_index: 0,
    spend_usd: "125.00",
  });
  expect(anonymousQuoteResponse.status()).toBe(200);
  const anonymousQuote = await json<QuoteResponse>(anonymousQuoteResponse);
  expect(anonymousQuote).toMatchObject({
    action: "buy",
    side: "yes",
    strike_index: 0,
  });
  expect(anonymousQuote.quantity).toBeGreaterThan(0);
  await expect(liveMetric).toHaveText(metricBeforeQuote);
  expect((await page.context().cookies()).some((cookie) => cookie.name === "openmarket_user")).toBe(false);
  await expect(ticket.getByText("Cost", { exact: true })).toBeVisible();

  const anonymousExecutionPromise = page.waitForResponse(
    (response) => isApiResponse(response, "POST", "/api/trade"),
  );
  await ticket.getByRole("button", { name: "Confirm buy" }).click();
  const anonymousExecutionResponse = await anonymousExecutionPromise;
  expect(anonymousExecutionResponse.status()).toBe(401);
  expect((await json<ErrorResponse>(anonymousExecutionResponse)).error.code).toBe("USER_REQUIRED");
  await expect(ticket.getByText("Username required", { exact: true })).toBeVisible();
  await ticket.getByLabel("Username").fill(username);

  let originalTradeRequest: TradeRequest | undefined;
  let firstExecution: ExecutionResponse | undefined;
  await page.route("**/api/trade", async (route) => {
    originalTradeRequest = route.request().postDataJSON() as TradeRequest;
    const upstream = await route.fetch();
    expect(upstream.status()).toBe(200);
    expect(upstream.headers()["idempotent-replayed"]).toBeUndefined();
    firstExecution = await json<ExecutionResponse>(upstream);
    // The server executes the real request; only its delivery is reset so the UI must safely replay it.
    await route.abort("connectionreset");
  });

  const userResponsePromise = page.waitForResponse(
    (response) => isApiResponse(response, "POST", "/api/user"),
  );
  await ticket.getByRole("button", { name: "Save username and trade" }).click();
  const userResponse = await userResponsePromise;
  expect(userResponse.status()).toBe(200);
  expect(await json<UserResponse>(userResponse)).toEqual({
    username,
    cash_balance_cents: "10000000",
  });

  await expect(ticket.getByRole("button", { name: "Retry same trade" })).toBeVisible();
  await expect.poll(() => originalTradeRequest !== undefined && firstExecution !== undefined).toBe(true);
  expect(originalTradeRequest).toMatchObject({
    slug,
    action: "buy",
    side: "yes",
    strike_index: 0,
    spend_usd: "125.00",
  });
  expect(originalTradeRequest?.idempotency_key).toBe(firstExecution?.idempotency_key);

  await page.unroute("**/api/trade");
  const replayResponsePromise = page.waitForResponse(
    (response) => isApiResponse(response, "POST", "/api/trade"),
  );
  const marketRefreshPromise = page.waitForResponse(
    (response) => isApiResponse(response, "GET", `/api/markets/${slug}`) && response.status() === 200,
  );
  const marksRefreshPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === `/api/markets/${slug}/marks`
      && response.status() === 200;
  });
  const activityRefreshPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/activity"
      && url.searchParams.get("slug") === slug
      && response.status() === 200;
  });

  await ticket.getByRole("button", { name: "Retry same trade" }).click();
  const [replayResponse, marketRefresh, marksRefresh, activityRefresh] = await Promise.all([
    replayResponsePromise,
    marketRefreshPromise,
    marksRefreshPromise,
    activityRefreshPromise,
  ]);
  expect(replayResponse.status()).toBe(200);
  expect(replayResponse.headers()["idempotent-replayed"]).toBe("true");
  expect(replayResponse.request().postDataJSON()).toEqual(originalTradeRequest);
  const replayedExecution = await json<ExecutionResponse>(replayResponse);
  expect(replayedExecution).toEqual(firstExecution);
  expect(replayedExecution.market_sequence).toBe("1");

  const refreshedMarket = await json<MarketResponse>(marketRefresh);
  const refreshedMarks = await json<MarksResponse>(marksRefresh);
  const refreshedActivity = await json<ActivityResponse>(activityRefresh);
  expect(refreshedMarket.sequence).toBe("1");
  expect(refreshedMarket.metric.current).toBe(replayedExecution.current_metric);
  expect(refreshedMarks.points.length).toBeGreaterThanOrEqual(2);
  expect(refreshedActivity.items).toHaveLength(1);
  expect(refreshedActivity.items[0]).toMatchObject({
    marketSequence: "1",
    action: "buy",
    side: "yes",
  });
  await expect(ticket.getByText("Trade completed", { exact: true })).toBeVisible();

  if (mobile) {
    await ticket.getByRole("button", { name: "Close trade ticket" }).click();
    await expect(page.getByRole("dialog", { name: `Trade ${companyName}` })).toBeHidden();
  }

  const currentMetrics = page.getByLabel("Current market metrics");
  await expect(currentMetrics.getByText(/Moved up|Moved down|Unchanged/)).toBeVisible();
  const activityRegion = page.getByRole("region", { name: "Market activity" });
  await expect(activityRegion.getByText(/^Bought .* YES$/)).toBeVisible();
  const chartRegion = page.getByRole("region", { name: "Market history" });
  await expect(chartRegion.getByText(/YES probability (?:increased|decreased|was unchanged).*current 60-minute mark/i)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const directMarketResponse = await page.request.get(`/api/markets/${slug}`);
  const directActivityResponse = await page.request.get(`/api/activity?slug=${slug}&limit=25`);
  expect(directMarketResponse.status()).toBe(200);
  expect(directActivityResponse.status()).toBe(200);
  expect((await json<MarketResponse>(directMarketResponse)).sequence).toBe("1");
  expect((await json<ActivityResponse>(directActivityResponse)).items).toHaveLength(1);

  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
  const buyPortfolioResponse = await page.request.get("/api/portfolio?offset=0&limit=20");
  expect(buyPortfolioResponse.status()).toBe(200);
  const buyPortfolio = await json<PortfolioResponse>(buyPortfolioResponse);
  expect(buyPortfolio.username).toBe(username);
  expect(buyPortfolio.cashBalanceCents).toBe(replayedExecution.cash_balance_cents);
  expect(buyPortfolio.tradeHistory.items).toHaveLength(1);
  expect(buyPortfolio.tradeHistory.items[0]).toMatchObject({ action: "buy", marketSequence: "1" });

  const summary = page.getByLabel("Portfolio summary");
  await expect(summary.locator("div").first()).toContainText(formatCents(replayedExecution.cash_balance_cents));
  const marketArticle = page.locator("article").filter({
    has: page.getByRole("link", { name: companyName, exact: true }),
  });
  await expect(marketArticle).toBeVisible();
  await expect(marketArticle.getByText(/shares$/).first()).toBeVisible();

  const positionRow = marketArticle.locator("li").filter({ hasText: "YES" }).first();
  await positionRow.getByRole("button", { name: "Sell", exact: true }).click();
  const sellFlow = page.locator('[aria-label="Sell YES"]');
  await expect(sellFlow).toBeVisible();
  const partialQuantity = Number((replayedExecution.shares / 2).toFixed(6));
  expect(partialQuantity).toBeGreaterThan(0.000001);
  await sellFlow.getByLabel("Quantity").fill(String(partialQuantity));

  const sellQuotePromise = page.waitForResponse(
    (response) => isApiResponse(response, "POST", "/api/quote"),
  );
  await sellFlow.getByRole("button", { name: "Review sale" }).click();
  const sellQuoteResponse = await sellQuotePromise;
  expect(sellQuoteResponse.status()).toBe(200);
  const sellQuote = await json<QuoteResponse>(sellQuoteResponse);
  const sellQuoteRequest = sellQuoteResponse.request().postDataJSON() as Record<string, unknown>;
  expect(sellQuoteRequest).toMatchObject({
    slug,
    action: "sell",
    side: "yes",
    strike_index: 0,
    quantity: partialQuantity,
  });
  expect(sellQuoteRequest).not.toHaveProperty("spend_usd");
  expect(sellQuote.quantity).toBe(partialQuantity);

  const sellExecutionPromise = page.waitForResponse(
    (response) => isApiResponse(response, "POST", "/api/trade"),
  );
  await sellFlow.getByRole("button", { name: "Sell shares" }).click();
  const sellExecutionResponse = await sellExecutionPromise;
  expect(sellExecutionResponse.status()).toBe(200);
  const sellExecution = await json<ExecutionResponse>(sellExecutionResponse);
  expect(sellExecution).toMatchObject({
    action: "sell",
    side: "yes",
    market_sequence: "2",
    shares: partialQuantity,
  });
  await expect(page.getByRole("status").filter({ hasText: "Sale completed" })).toBeVisible();

  const afterSellResponse = await page.request.get("/api/portfolio?offset=0&limit=20");
  expect(afterSellResponse.status()).toBe(200);
  const afterSell = await json<PortfolioResponse>(afterSellResponse);
  expect(afterSell.cashBalanceCents).toBe(sellExecution.cash_balance_cents);
  expect(afterSell.tradeHistory.items).toHaveLength(2);
  const afterSellMarket = afterSell.markets.find((market) => market.company.slug === slug);
  const afterSellYes = afterSellMarket?.positions.find(
    (position) => position.side === "yes" && position.strikeIndex === 0,
  );
  expect(afterSellYes?.quantity).toBeCloseTo(replayedExecution.shares - partialQuantity, 5);
  expect(afterSellYes?.sellableQuantity).toBeGreaterThan(0);

  await marketArticle.getByRole("button", { name: "Sell", exact: true }).click();
  const quantityOnlyFlow = page.locator('[aria-label="Sell YES"]');
  await expect(quantityOnlyFlow.getByLabel("Quantity")).toBeVisible();
  await expect(quantityOnlyFlow.getByRole("button", { name: "By spend" })).toHaveCount(0);
  await quantityOnlyFlow.getByRole("button", { name: "Close" }).click();

  const rejectedSellSpend = await page.request.post("/api/quote", {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      slug,
      action: "sell",
      side: "yes",
      strike_index: 0,
      spend_usd: "10.00",
    },
  });
  expect(rejectedSellSpend.status()).toBe(400);
  const rejectedSellSpendError = await json<ErrorResponse>(rejectedSellSpend);
  expect(rejectedSellSpendError.error).toEqual({
    code: "INVALID_INPUT",
    message: "Request body is invalid.",
  });
  await expectNoHorizontalOverflow(page);

  await page.goto("/admin");
  await page.getByLabel("Admin passphrase").fill(adminPassphrase());
  await page.getByRole("button", { name: "Start admin session" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Admin session authenticated" })).toBeVisible();
  await page.getByLabel("Market slug").fill(slug);
  await page.getByLabel("Settlement value (USD)").fill("1.00");
  await page.getByLabel("Public source URL").fill("https://example.com/openmarket-browser-proof");
  await page.getByLabel("Source description").fill("Browser proof confirmed outcome");
  await page.getByRole("button", { name: "Review settlement" }).click();
  await expect(page.getByRole("heading", { name: "Review the permanent outcome" })).toBeVisible();
  await page.getByLabel(/Retype .* exactly to confirm/).fill(slug);

  const settlementPromise = page.waitForResponse(
    (response) => isApiResponse(response, "POST", "/api/admin/settle"),
  );
  await page.getByRole("button", { name: "Settle market permanently" }).click();
  const settlementResponse = await settlementPromise;
  expect(settlementResponse.status()).toBe(200);
  const settlement = await json<SettlementResponse>(settlementResponse);
  expect(settlement).toMatchObject({
    slug,
    settled_value_usd: "1.00",
    credited_users: 1,
  });
  await expect(page.getByRole("status").filter({ hasText: `${slug} settled` })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto(`/m/${slug}`);
  await expect(page.getByRole("heading", { name: companyName })).toBeVisible();
  await expect(page.getByText("Settled", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Settlement outcome")).toContainText("Resolved at $1");
  await expect(page.getByRole("region", { name: "Outcome contract" }).getByRole("button", { name: /YES$/ })).toBeDisabled();
  await expect(page.getByText("Trading closed", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Trade rail")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Trade ticket" })).toHaveCount(0);
  await expect(page.getByLabel("Settlement outcome").getByRole("link", { name: "Browser proof confirmed outcome" })).toHaveAttribute(
    "href",
    "https://example.com/openmarket-browser-proof",
  );
  await expectNoHorizontalOverflow(page);

  const settledMarketResponse = await page.request.get(`/api/markets/${slug}`);
  expect(settledMarketResponse.status()).toBe(200);
  const settledMarket = await json<MarketResponse>(settledMarketResponse);
  expect(settledMarket.status).toBe("settled");
  expect(settledMarket.sequence).toBe("2");
  expect(settledMarket.settlement?.settledValueUsd).toBe("1");

  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No open exposure" })).toBeVisible();
  const settledPortfolioResponse = await page.request.get("/api/portfolio?offset=0&limit=20");
  expect(settledPortfolioResponse.status()).toBe(200);
  const settledPortfolio = await json<PortfolioResponse>(settledPortfolioResponse);
  expect(settledPortfolio.tradeHistory.items).toHaveLength(2);
  expect(Number(settledPortfolio.cashBalanceCents)).toBeGreaterThan(Number(sellExecution.cash_balance_cents));
  await expect(page.getByLabel("Portfolio summary").locator("div").first()).toContainText(
    formatCents(settledPortfolio.cashBalanceCents),
  );
  await expectNoHorizontalOverflow(page);
});
