import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  buyViaApi,
  createUser,
  expectNoHorizontalOverflow,
  failTradesWith,
  formatCents,
  isApiResponse,
  json,
  seedBinaryMarket,
  skipWithoutDatabase,
  uniqueNames,
  type ExecutionResponse,
  type PortfolioResponse,
  type TradeRequest,
} from "./helpers.js";

skipWithoutDatabase();

async function openSellFlow(
  page: Page,
  baseURL: string | undefined,
  names: { readonly slug: string; readonly companyName: string; readonly username: string },
): Promise<{ readonly sellFlow: Locator; readonly purchase: ExecutionResponse }> {
  await seedBinaryMarket(page, baseURL, names);
  await createUser(page, baseURL, names.username);
  const purchase = await buyViaApi(page, baseURL, { slug: names.slug, spendUsd: "100.00" });

  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
  const marketArticle = page.locator("article").filter({
    has: page.getByRole("link", { name: names.companyName, exact: true }),
  });
  await marketArticle.getByRole("button", { name: "Sell", exact: true }).click();
  const sellFlow = page.locator('[aria-label="Sell YES"]');
  await expect(sellFlow).toBeVisible();
  return { sellFlow, purchase };
}

async function reviewSale(page: Page, sellFlow: Locator, quantity: number): Promise<void> {
  await sellFlow.getByLabel("Quantity").fill(String(quantity));
  const quotePromise = page.waitForResponse((response) => isApiResponse(response, "POST", "/api/quote"));
  await sellFlow.getByRole("button", { name: "Review sale" }).click();
  expect((await quotePromise).status()).toBe(200);
  await expect(sellFlow.getByRole("button", { name: "Sell shares" })).toBeVisible();
}

test("without an account the portfolio gates on the shared username editor", async ({ page }) => {
  await page.goto("/portfolio");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Open your paper account" })).toBeVisible();
  await main.getByRole("button", { name: "Enter username" }).click();
  await expect(page.getByRole("banner").getByRole("heading", { name: "Open your paper account" })).toBeVisible();
  await expect(page.getByLabel("Username")).toBeFocused();
});

test("the summary and position row reflect the authoritative portfolio", async ({ page, baseURL }, testInfo) => {
  const names = uniqueNames("pf-summary", testInfo);
  const { purchase } = await openSellFlow(page, baseURL, names);

  const portfolio = await json<PortfolioResponse>(await page.request.get("/api/portfolio?offset=0&limit=20"));
  expect(portfolio.username).toBe(names.username);
  expect(portfolio.cashBalanceCents).toBe(purchase.cash_balance_cents);
  await expect(page.getByLabel("Portfolio summary")).toContainText(formatCents(purchase.cash_balance_cents));
  await expect(page.getByText(`Account · @${names.username}`)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("the sale quantity is bounded by the sellable position", async ({ page, baseURL }, testInfo) => {
  const names = uniqueNames("pf-bounds", testInfo);
  const { sellFlow, purchase } = await openSellFlow(page, baseURL, names);

  await expect(sellFlow.getByText(`Sellable: ${purchase.sellable_quantity}`, { exact: false })).toBeVisible();
  await sellFlow.getByLabel("Quantity").fill(String(purchase.sellable_quantity * 2));
  await expect(sellFlow.getByRole("button", { name: "Review sale" })).toBeDisabled();
  await sellFlow.getByLabel("Quantity").fill("0");
  await expect(sellFlow.getByRole("button", { name: "Review sale" })).toBeDisabled();
  await sellFlow.getByRole("button", { name: "Use maximum" }).click();
  await expect(sellFlow.getByLabel("Quantity")).toHaveValue(String(purchase.sellable_quantity));
  await expect(sellFlow.getByRole("button", { name: "Review sale" })).toBeEnabled();
});

test("editing the quantity discards a reviewed quote", async ({ page, baseURL }, testInfo) => {
  const names = uniqueNames("pf-edit", testInfo);
  const { sellFlow, purchase } = await openSellFlow(page, baseURL, names);
  await reviewSale(page, sellFlow, Number((purchase.shares / 2).toFixed(6)));

  await sellFlow.getByRole("button", { name: "Edit quantity" }).click();
  await expect(sellFlow.getByRole("button", { name: "Review sale" })).toBeVisible();
  await expect(sellFlow.getByRole("button", { name: "Sell shares" })).toHaveCount(0);
});

test("an unknown-outcome sale failure retries with the same idempotency key", async ({ page, baseURL }, testInfo) => {
  const names = uniqueNames("pf-retry", testInfo);
  const { sellFlow, purchase } = await openSellFlow(page, baseURL, names);
  const quantity = Number((purchase.shares / 2).toFixed(6));
  await reviewSale(page, sellFlow, quantity);

  const attempts = await failTradesWith(page, 500, {
    code: "INTERNAL_ERROR",
    message: "Simulated server failure.",
  });

  await sellFlow.getByRole("button", { name: "Sell shares" }).click();
  await expect(sellFlow.getByRole("alert")).toContainText("Execution status is unknown. Retry the sale to safely reuse the same request key.");
  const retryButton = sellFlow.getByRole("button", { name: "Retry sale" });
  await expect(retryButton).toBeVisible();
  expect(attempts).toHaveLength(1);

  await page.unroute("**/api/trade");
  const executionPromise = page.waitForResponse((response) => isApiResponse(response, "POST", "/api/trade"));
  await retryButton.click();
  const executionResponse = await executionPromise;
  expect(executionResponse.status()).toBe(200);
  const finalRequest = executionResponse.request().postDataJSON() as TradeRequest;
  expect(finalRequest.idempotency_key).toBe(attempts[0]?.idempotency_key);
  expect(finalRequest).toMatchObject({ action: "sell", side: "yes", quantity });
  await expect(page.getByRole("status").filter({ hasText: "Sale completed" })).toBeVisible();
});

test("a deterministic sale rejection shows the server message and drops the key", async ({ page, baseURL }, testInfo) => {
  const names = uniqueNames("pf-reject", testInfo);
  const { sellFlow, purchase } = await openSellFlow(page, baseURL, names);
  await reviewSale(page, sellFlow, Number((purchase.shares / 2).toFixed(6)));

  const attempts = await failTradesWith(page, 409, {
    code: "INSUFFICIENT_HOLDINGS",
    message: "You no longer hold enough shares.",
  });

  await sellFlow.getByRole("button", { name: "Sell shares" }).click();
  await expect(sellFlow.getByRole("alert")).toContainText("You no longer hold enough shares.");
  const sellAgain = sellFlow.getByRole("button", { name: "Sell shares" });
  await expect(sellAgain).toBeVisible();
  await expect(sellFlow.getByRole("button", { name: "Retry sale" })).toHaveCount(0);

  await sellAgain.click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1]?.idempotency_key).not.toBe(attempts[0]?.idempotency_key);
});

test("a moved sale price returns to a fresh quote with the authoritative proceeds", async ({ page, baseURL }, testInfo) => {
  const names = uniqueNames("pf-moved", testInfo);
  const { sellFlow, purchase } = await openSellFlow(page, baseURL, names);
  await reviewSale(page, sellFlow, Number((purchase.shares / 2).toFixed(6)));

  await failTradesWith(page, 409, {
    code: "PRICE_MOVED",
    message: "The market moved before execution.",
    details: { cash_amount_cents: "4321", shares: 4.3 },
  });

  await sellFlow.getByRole("button", { name: "Sell shares" }).click();
  const alert = sellFlow.getByRole("alert");
  await expect(alert).toContainText("The market moved. New authoritative proceeds: $43.21. Review a fresh quote before confirming.");
  await expect(sellFlow.getByRole("button", { name: "Review sale" })).toBeVisible();
  await expect(sellFlow.getByRole("button", { name: "Sell shares" })).toHaveCount(0);
  await page.unroute("**/api/trade");
});

test("a partial sale executes and updates the remaining position", async ({ page, baseURL }, testInfo) => {
  const names = uniqueNames("pf-sale", testInfo);
  const { sellFlow, purchase } = await openSellFlow(page, baseURL, names);
  const quantity = Number((purchase.shares / 2).toFixed(6));
  await reviewSale(page, sellFlow, quantity);

  const executionPromise = page.waitForResponse((response) => isApiResponse(response, "POST", "/api/trade"));
  await sellFlow.getByRole("button", { name: "Sell shares" }).click();
  const executionResponse = await executionPromise;
  expect(executionResponse.status()).toBe(200);
  const sale = await json<ExecutionResponse>(executionResponse);
  expect(sale).toMatchObject({ action: "sell", side: "yes", shares: quantity });
  await expect(page.getByRole("status").filter({ hasText: "Sale completed" })).toBeVisible();

  const portfolio = await json<PortfolioResponse>(await page.request.get("/api/portfolio?offset=0&limit=20"));
  expect(portfolio.cashBalanceCents).toBe(sale.cash_balance_cents);
  expect(portfolio.tradeHistory.items).toHaveLength(2);
  const position = portfolio.markets
    .find((market) => market.company.slug === names.slug)
    ?.positions.find((item) => item.side === "yes" && item.strikeIndex === 0);
  expect(position?.quantity).toBeCloseTo(purchase.shares - quantity, 5);
  await expectNoHorizontalOverflow(page);
});
