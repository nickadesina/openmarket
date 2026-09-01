import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type APIResponse,
  type Page,
  type Response as BrowserResponse,
  type TestInfo,
} from "@playwright/test";

export const databaseAvailable = Boolean(process.env.DATABASE_URL_TEST);

/** Call at module scope in every spec: real-route tests need the disposable database. */
export function skipWithoutDatabase(): void {
  test.skip(
    !databaseAvailable,
    "DATABASE_URL_TEST is required for real-route browser tests; local runs skip without it.",
  );
}

export interface QuoteResponse {
  readonly action: "buy" | "sell";
  readonly side: "yes" | "no";
  readonly strike_index: number;
  readonly quantity: number;
  readonly cash_amount_cents: string;
  readonly engine_cost_usd: number;
}

export interface TradeRequest {
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

export interface ExecutionResponse {
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

export interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details: Readonly<Record<string, unknown>>;
  };
}

export interface PortfolioResponse {
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

export function adminPassphrase(): string {
  const value = process.env.PLAYWRIGHT_ADMIN_PASSPHRASE;
  if (value === undefined || value.length === 0) {
    throw new Error("PLAYWRIGHT_ADMIN_PASSPHRASE was not configured by playwright.config.ts");
  }
  return value;
}

/** Unique, per-project identifiers so every test owns its own market and account. */
export function uniqueNames(prefix: string, testInfo: TestInfo): {
  readonly slug: string;
  readonly companyName: string;
  readonly username: string;
} {
  const mobile = testInfo.project.name.includes("mobile");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  return {
    slug: `${prefix}-${mobile ? "m" : "d"}-${suffix}`,
    companyName: `${prefix} ${mobile ? "Mobile" : "Desktop"} ${suffix}`,
    username: `u_${suffix}`,
  };
}

function requireBaseUrl(baseURL: string | undefined): string {
  if (baseURL === undefined) throw new Error("Playwright baseURL is not configured.");
  return new URL(baseURL).origin;
}

/** Mutation routes enforce a same-origin check; every API helper sends the Origin header. */
function mutationHeaders(baseURL: string | undefined): Record<string, string> {
  return { Origin: requireBaseUrl(baseURL) };
}

async function expectOk(response: APIResponse, action: string): Promise<void> {
  expect(response.ok(), `${action} failed with ${response.status()}: ${await response.text()}`).toBe(true);
}

export async function loginAdmin(page: Page, baseURL: string | undefined): Promise<void> {
  const response = await page.request.post("/api/admin/login", {
    headers: mutationHeaders(baseURL),
    data: { passphrase: adminPassphrase() },
  });
  await expectOk(response, "Admin login");
}

export async function seedBinaryMarket(
  page: Page,
  baseURL: string | undefined,
  input: { readonly slug: string; readonly companyName: string; readonly yesProbability?: number },
): Promise<void> {
  await loginAdmin(page, baseURL);
  const response = await page.request.post("/api/admin/seed", {
    headers: mutationHeaders(baseURL),
    data: {
      name: input.companyName,
      slug: input.slug,
      logo_path: "/browser-test.svg",
      b: 250,
      metric_kind: "yes_probability",
      yes_probability: input.yesProbability ?? 0.5,
    },
  });
  await expectOk(response, "Seeding binary market");
}

export async function seedValuationMarket(
  page: Page,
  baseURL: string | undefined,
  input: { readonly slug: string; readonly companyName: string },
): Promise<void> {
  await loginAdmin(page, baseURL);
  const response = await page.request.post("/api/admin/seed", {
    headers: mutationHeaders(baseURL),
    data: {
      name: input.companyName,
      slug: input.slug,
      logo_path: "/browser-test.svg",
      b: 15_000,
      metric_kind: "valuation_median",
      anchor_valuation_usd: "65000000000.00",
      anchor_date: "2024-02-28",
      anchor_description: "Browser-test anchor description.",
      sigma: 0.5,
    },
  });
  await expectOk(response, "Seeding valuation market");
}

export async function createUser(page: Page, baseURL: string | undefined, username: string): Promise<void> {
  const response = await page.request.post("/api/user", {
    headers: mutationHeaders(baseURL),
    data: { username },
  });
  await expectOk(response, `Creating user ${username}`);
}

/** Executes a real buy through the API using the page's user cookie. */
export async function buyViaApi(
  page: Page,
  baseURL: string | undefined,
  input: { readonly slug: string; readonly spendUsd: string; readonly strikeIndex?: number; readonly side?: "yes" | "no" },
): Promise<ExecutionResponse> {
  const response = await page.request.post("/api/trade", {
    headers: mutationHeaders(baseURL),
    data: {
      slug: input.slug,
      action: "buy",
      side: input.side ?? "yes",
      strike_index: input.strikeIndex ?? 0,
      spend_usd: input.spendUsd,
      max_cost_usd: input.spendUsd,
      idempotency_key: randomUUID(),
    },
  });
  await expectOk(response, "API buy");
  return await response.json() as ExecutionResponse;
}

export function isApiResponse(response: BrowserResponse, method: string, pathname: string): boolean {
  return response.request().method() === method
    && new URL(response.url()).pathname === pathname;
}

export async function json<T>(response: BrowserResponse | APIResponse): Promise<T> {
  return response.json() as Promise<T>;
}

export function formatCents(cents: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(cents) / 100);
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    const documentWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    );
    return documentWidth <= document.documentElement.clientWidth + 1;
  })).toBe(true);
}

/**
 * Intercepts POST /api/trade with a fixed JSON error, recording each attempt's body.
 * Returns the recorded requests; call page.unroute("**\/api/trade") to restore.
 */
export async function failTradesWith(
  page: Page,
  status: number,
  error: { readonly code: string; readonly message: string; readonly details?: Readonly<Record<string, unknown>> },
): Promise<TradeRequest[]> {
  const attempts: TradeRequest[] = [];
  await page.route("**/api/trade", async (route) => {
    attempts.push(route.request().postDataJSON() as TradeRequest);
    await route.fulfill({
      status,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ error: { details: {}, ...error } }),
    });
  });
  return attempts;
}
