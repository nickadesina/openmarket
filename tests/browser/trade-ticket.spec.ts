import { expect, type Locator, type Page, test } from "@playwright/test";

import {
  createUser,
  type ExecutionResponse,
  expectNoHorizontalOverflow,
  failTradesWith,
  isApiResponse,
  json,
  type QuoteResponse,
  seedBinaryMarket,
  skipWithoutDatabase,
  type TradeRequest,
  uniqueNames,
} from "./helpers.js";

skipWithoutDatabase();

async function openTicket(
  page: Page,
  baseURL: string | undefined,
  names: { readonly slug: string; readonly companyName: string; readonly username: string },
): Promise<Locator> {
  await seedBinaryMarket(page, baseURL, names);
  await createUser(page, baseURL, names.username);
  await page.goto(`/m/${names.slug}`);
  await expect(page.getByRole("heading", { name: names.companyName })).toBeVisible();
  await page
    .getByRole("region", { name: "Outcome contract" })
    .getByRole("button", { name: /^YES/ })
    .click();
  const ticket = page.getByRole("region", { name: "Trade ticket" });
  await expect(ticket).toBeVisible();
  return ticket;
}

async function previewBuy(page: Page, ticket: Locator, spendUsd: string): Promise<QuoteResponse> {
  await ticket.getByRole("spinbutton", { name: "Spend" }).fill(spendUsd);
  const quotePromise = page.waitForResponse((response) =>
    isApiResponse(response, "POST", "/api/quote"),
  );
  await ticket.getByRole("button", { name: "Preview buy" }).click();
  const quoteResponse = await quotePromise;
  expect(quoteResponse.status()).toBe(200);
  await expect(ticket.getByText("Cost", { exact: true })).toBeVisible();
  return await json<QuoteResponse>(quoteResponse);
}

test("a quote is invalidated by any input change and gated on a valid amount", async ({
  page,
  baseURL,
}, testInfo) => {
  const ticket = await openTicket(page, baseURL, uniqueNames("ticket-quote", testInfo));

  await expect(ticket.getByRole("button", { name: "Preview buy" })).toBeEnabled();
  await ticket.getByRole("spinbutton", { name: "Spend" }).fill("0");
  await expect(ticket.getByRole("button", { name: "Preview buy" })).toBeDisabled();
  await ticket.getByRole("spinbutton", { name: "Spend" }).fill("");
  await expect(ticket.getByRole("button", { name: "Preview buy" })).toBeDisabled();

  await previewBuy(page, ticket, "50.00");
  await expect(ticket.getByRole("button", { name: "Confirm buy" })).toBeVisible();
  await expect(ticket.getByText("Quotes are previews, not reservations.")).toBeVisible();

  await ticket.getByRole("spinbutton", { name: "Spend" }).fill("60.00");
  await expect(ticket.getByText("Cost", { exact: true })).toHaveCount(0);
  await expect(ticket.getByRole("button", { name: "Preview buy" })).toBeVisible();

  await previewBuy(page, ticket, "60.00");
  await ticket.getByRole("button", { name: "Sell" }).click();
  await expect(ticket.getByText("Cost", { exact: true })).toHaveCount(0);
  await expect(ticket.getByRole("button", { name: "By spend" })).toHaveCount(0);
  await expect(ticket.getByText("Quantity", { exact: true }).first()).toBeVisible();
  await expect(ticket.getByRole("button", { name: "Preview sell" })).toBeVisible();

  await ticket.getByRole("button", { name: "Buy" }).click();
  await expect(ticket.getByRole("button", { name: "By spend" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("a by-quantity buy quotes with quantity and executes with a 1% cost cap", async ({
  page,
  baseURL,
}, testInfo) => {
  const ticket = await openTicket(page, baseURL, uniqueNames("ticket-qty", testInfo));

  await ticket.getByRole("button", { name: "By quantity" }).click();
  await ticket.getByLabel("Quantity", { exact: true }).fill("10");
  const quotePromise = page.waitForResponse((response) =>
    isApiResponse(response, "POST", "/api/quote"),
  );
  await ticket.getByRole("button", { name: "Preview buy" }).click();
  const quoteResponse = await quotePromise;
  expect(quoteResponse.status()).toBe(200);
  const quoteRequest = quoteResponse.request().postDataJSON() as Record<string, unknown>;
  expect(quoteRequest).toMatchObject({ action: "buy", side: "yes", strike_index: 0, quantity: 10 });
  expect(quoteRequest).not.toHaveProperty("spend_usd");
  const quote = await json<QuoteResponse>(quoteResponse);

  const executionPromise = page.waitForResponse((response) =>
    isApiResponse(response, "POST", "/api/trade"),
  );
  await ticket.getByRole("button", { name: "Confirm buy" }).click();
  const executionResponse = await executionPromise;
  expect(executionResponse.status()).toBe(200);
  const tradeRequest = executionResponse.request().postDataJSON() as TradeRequest;
  expect(tradeRequest.quantity).toBe(10);
  expect(tradeRequest.max_cost_usd).toBe(
    (Math.ceil(quote.engine_cost_usd * 1.01 * 100) / 100).toFixed(2),
  );
  const execution = await json<ExecutionResponse>(executionResponse);
  expect(execution.shares).toBeCloseTo(10, 6);
  await expect(ticket.getByText("Trade completed", { exact: true })).toBeVisible();
});

test("an unknown-outcome failure keeps the idempotency key across retries", async ({
  page,
  baseURL,
}, testInfo) => {
  const ticket = await openTicket(page, baseURL, uniqueNames("ticket-retry", testInfo));
  await previewBuy(page, ticket, "40.00");

  const attempts = await failTradesWith(page, 500, {
    code: "INTERNAL_ERROR",
    message: "Simulated server failure.",
  });

  await ticket.getByRole("button", { name: "Confirm buy" }).click();
  const alert = ticket.getByRole("alert");
  await expect(alert).toContainText("Outcome unknown");
  await expect(alert).toContainText("Retry with the same request key to avoid a duplicate trade.");
  // The order is pinned: no second send path exists while the outcome is unknown.
  await expect(ticket.getByRole("button", { name: "Confirm buy" })).toHaveCount(0);
  await expect(ticket.getByRole("spinbutton", { name: "Spend" })).toBeDisabled();
  const retryButton = ticket.getByRole("button", { name: "Retry same trade" });
  await expect(retryButton).toBeVisible();
  expect(attempts).toHaveLength(1);

  await retryButton.click();
  await expect.poll(() => attempts.length).toBe(2);
  await expect(retryButton).toBeVisible();
  expect(attempts[1]).toEqual(attempts[0]);

  await page.unroute("**/api/trade");
  const executionPromise = page.waitForResponse((response) =>
    isApiResponse(response, "POST", "/api/trade"),
  );
  await retryButton.click();
  const executionResponse = await executionPromise;
  expect(executionResponse.status()).toBe(200);
  expect((executionResponse.request().postDataJSON() as TradeRequest).idempotency_key).toBe(
    attempts[0]?.idempotency_key,
  );
  await expect(ticket.getByText("Trade completed", { exact: true })).toBeVisible();
  await expect(retryButton).toHaveCount(0);
});

test("a deterministic rejection drops the idempotency key and shows the server message", async ({
  page,
  baseURL,
}, testInfo) => {
  const ticket = await openTicket(page, baseURL, uniqueNames("ticket-reject", testInfo));
  await previewBuy(page, ticket, "40.00");

  const attempts = await failTradesWith(page, 409, {
    code: "INSUFFICIENT_CASH",
    message: "Not enough cash for this trade.",
  });

  await ticket.getByRole("button", { name: "Confirm buy" }).click();
  const alert = ticket.getByRole("alert");
  await expect(alert).toContainText("Insufficient cash");
  await expect(alert).toContainText("Not enough cash for this trade.");
  await expect(ticket.getByRole("button", { name: "Retry same trade" })).toHaveCount(0);

  await ticket.getByRole("button", { name: "Confirm buy" }).click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1]?.idempotency_key).not.toBe(attempts[0]?.idempotency_key);
});

// PRICE_MOVED is only reachable for by-quantity buys: the server requires a spend
// order's max cost to equal its spend, so a spend order can never move.
test("a moved price must be explicitly confirmed and re-executes with the authoritative cost", async ({
  page,
  baseURL,
}, testInfo) => {
  const ticket = await openTicket(page, baseURL, uniqueNames("ticket-moved", testInfo));
  await ticket.getByRole("button", { name: "By quantity" }).click();
  await ticket.getByLabel("Quantity", { exact: true }).fill("10");
  const quotePromise = page.waitForResponse((response) =>
    isApiResponse(response, "POST", "/api/quote"),
  );
  await ticket.getByRole("button", { name: "Preview buy" }).click();
  expect((await quotePromise).status()).toBe(200);
  await expect(ticket.getByText("Cost", { exact: true })).toBeVisible();

  const attempts = await failTradesWith(page, 409, {
    code: "PRICE_MOVED",
    message: "The market moved before execution.",
    details: {
      cash_amount_cents: "615",
      shares: 10,
      average_price: 615 / 100 / 10,
      price_after: 0.66,
      current_metric_after: 0.66,
      expected_redemption_quantity: 0,
      expected_redemption_cents: "0",
      sellable_quantity: 22.3,
      quoted_at: "2026-01-01T00:00:00.000Z",
    },
  });

  await ticket.getByRole("button", { name: "Confirm buy" }).click();
  const alert = ticket.getByRole("alert");
  await expect(alert).toContainText("Price moved");
  // The requote re-renders the full consequence set, not an abbreviated box.
  const panel = ticket.locator("dl");
  await expect(panel).toContainText("10");
  await expect(panel).toContainText("$6.15");
  await expect(panel).toContainText("61.5%");
  await expect(panel).toContainText("66.0%");
  await expect(ticket.getByText("Requoted", { exact: true })).toBeVisible();
  await expect(ticket.getByText("Max cost", { exact: true })).toBeVisible();
  await expect(ticket.getByRole("button", { name: "Confirm buy" })).toHaveCount(0);

  await page.unroute("**/api/trade");
  const executionPromise = page.waitForResponse((response) =>
    isApiResponse(response, "POST", "/api/trade"),
  );
  await ticket.getByRole("button", { name: "Confirm new price" }).click();
  const executionResponse = await executionPromise;
  expect(executionResponse.status()).toBe(200);
  const confirmedRequest = executionResponse.request().postDataJSON() as TradeRequest;
  expect(confirmedRequest.max_cost_usd).toBe("6.15");
  expect(confirmedRequest.quantity).toBe(10);
  expect(confirmedRequest.idempotency_key).not.toBe(attempts[0]?.idempotency_key);
  await expect(ticket.getByText("Trade completed", { exact: true })).toBeVisible();
});

test("a moved price without authoritative details offers a fresh quote instead", async ({
  page,
  baseURL,
}, testInfo) => {
  const ticket = await openTicket(page, baseURL, uniqueNames("ticket-moved-bare", testInfo));
  await previewBuy(page, ticket, "50.00");

  await failTradesWith(page, 409, {
    code: "PRICE_MOVED",
    message: "The market moved before execution.",
  });

  await ticket.getByRole("button", { name: "Confirm buy" }).click();
  await expect(ticket.getByRole("alert")).toContainText("Price moved");
  await expect(ticket.getByRole("button", { name: "Confirm new price" })).toHaveCount(0);

  await page.unroute("**/api/trade");
  const quotePromise = page.waitForResponse((response) =>
    isApiResponse(response, "POST", "/api/quote"),
  );
  await ticket.getByRole("button", { name: "Refresh quote" }).click();
  expect((await quotePromise).status()).toBe(200);
  await expect(ticket.getByText("Cost", { exact: true })).toBeVisible();
});

test("a pending order locks the inputs until it is abandoned", async ({
  page,
  baseURL,
}, testInfo) => {
  const ticket = await openTicket(page, baseURL, uniqueNames("ticket-reset", testInfo));
  await previewBuy(page, ticket, "40.00");

  await failTradesWith(page, 500, {
    code: "INTERNAL_ERROR",
    message: "Simulated server failure.",
  });
  await ticket.getByRole("button", { name: "Confirm buy" }).click();
  await expect(ticket.getByRole("button", { name: "Retry same trade" })).toBeVisible();
  await page.unroute("**/api/trade");

  // Inputs are locked while the order is pending; only Abandon releases the key.
  await expect(ticket.getByRole("spinbutton", { name: "Spend" })).toBeDisabled();
  await ticket.getByRole("button", { name: "Abandon order" }).click();
  await expect(ticket.getByRole("alert")).toHaveCount(0);
  await expect(ticket.getByRole("button", { name: "Retry same trade" })).toHaveCount(0);
  await expect(ticket.getByRole("button", { name: "Confirm buy" })).toBeVisible();
  await ticket.getByRole("spinbutton", { name: "Spend" }).fill("41.00");
  await expect(ticket.getByRole("button", { name: "Preview buy" })).toBeVisible();
});

test("a completed trade reports a failed authoritative refresh without an error state", async ({
  page,
  baseURL,
}, testInfo) => {
  const names = uniqueNames("ticket-refresh", testInfo);
  const ticket = await openTicket(page, baseURL, names);
  await previewBuy(page, ticket, "40.00");

  await page.route(`**/api/markets/${names.slug}`, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "Simulated refresh failure.",
          details: {},
        },
      }),
    });
  });

  const executionPromise = page.waitForResponse((response) =>
    isApiResponse(response, "POST", "/api/trade"),
  );
  await ticket.getByRole("button", { name: "Confirm buy" }).click();
  expect((await executionPromise).status()).toBe(200);

  await expect(ticket.getByText("Trade completed", { exact: true })).toBeVisible();
  await expect(ticket).toContainText("Displayed market data may be stale.");
  await expect(ticket.getByRole("alert")).toHaveCount(0);
});
