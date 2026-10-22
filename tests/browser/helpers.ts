import { randomUUID } from "node:crypto";

import {
  type APIResponse,
  expect,
  type Locator,
  type Page,
  type TestInfo,
  test,
} from "@playwright/test";

export const databaseAvailable = Boolean(process.env.DATABASE_URL_TEST);

/** Call at module scope in every spec: real-route tests need the disposable database. */
export function skipWithoutDatabase(): void {
  test.skip(
    !databaseAvailable,
    "DATABASE_URL_TEST is required for real-route browser tests; local runs skip without it.",
  );
}

/** A unique, per-project handle so every test owns its own tournament identity. */
export function uniqueHandle(prefix: string, testInfo: TestInfo): string {
  const mobile = testInfo.project.name.includes("mobile");
  return `${prefix}_${mobile ? "m" : "d"}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
}

/** Mutation routes enforce a same-origin check; every API helper sends the Origin header. */
function mutationHeaders(baseURL: string | undefined): Record<string, string> {
  if (baseURL === undefined) throw new Error("Playwright baseURL is not configured.");
  return { Origin: new URL(baseURL).origin };
}

async function expectOk(response: APIResponse, action: string): Promise<void> {
  expect(
    response.ok(),
    `${action} failed with ${response.status()}: ${await response.text()}`,
  ).toBe(true);
}

/**
 * Signs the page's browser context in through the development sign-in, the
 * tournament identity Playwright's `next dev` server enables. `pw_admin` is
 * the allowlisted admin.
 */
export async function signInDev(
  page: Page,
  baseURL: string | undefined,
  handle: string,
): Promise<void> {
  const response = await page.request.post("/api/t/auth/dev", {
    headers: mutationHeaders(baseURL),
    data: { handle },
  });
  await expectOk(response, `Signing in as ${handle}`);
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
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const documentWidth = Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth,
        );
        return documentWidth <= document.documentElement.clientWidth + 1;
      }),
    )
    .toBe(true);
}

export function isMobile(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1440) < 832;
}

/** The trade ticket: the desktop rail, or on a phone the sheet the fixed bar opens. */
export async function openTicket(page: Page): Promise<Locator> {
  if (isMobile(page)) {
    await page.getByRole("button", { name: "Trade", exact: true }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    return sheet.getByRole("region", { name: "Trade ticket" });
  }
  const ticket = page.getByRole("region", { name: "Trade ticket" });
  await expect(ticket).toBeVisible();
  return ticket;
}
