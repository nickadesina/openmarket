import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";

const databaseAvailable = Boolean(process.env.DATABASE_URL_TEST);
test.skip(
  !databaseAvailable,
  "DATABASE_URL_TEST is required for the real-route accessibility checks; local runs skip without it.",
);

test.describe.configure({ mode: "serial" });

function adminPassphrase(): string {
  const value = process.env.PLAYWRIGHT_ADMIN_PASSPHRASE;
  if (value === undefined || value.length === 0) {
    throw new Error("PLAYWRIGHT_ADMIN_PASSPHRASE was not configured by playwright.config.ts");
  }
  return value;
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

async function tabTo(page: Page, target: Locator): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
  });

  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => document.activeElement === element)) return;
  }
  throw new Error("The target was not reachable in the first 40 keyboard tab stops.");
}

function formatCents(cents: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(cents) / 100);
}

async function seedAccessibleMarket(
  page: Page,
  slug: string,
  companyName: string,
  username: string,
): Promise<void> {
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const headers = { Origin: origin };

  const loginResponse = await page.request.post("/api/admin/login", {
    headers,
    data: { passphrase: adminPassphrase() },
  });
  expect(loginResponse.status()).toBe(200);

  const seedResponse = await page.request.post("/api/admin/seed", {
    headers,
    data: {
      name: companyName,
      slug,
      logo_path: "/accessibility-proof.svg",
      b: 250,
      metric_kind: "yes_probability",
      yes_probability: 0.5,
    },
  });
  expect(seedResponse.status()).toBe(200);

  const userResponse = await page.request.post("/api/user", {
    headers,
    data: { username },
  });
  expect(userResponse.status()).toBe(200);
}

test("keyboard, chart, movement, focus, and responsive overflow contracts", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name.includes("mobile");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const slug = `a11y-proof-${mobile ? "mobile" : "desktop"}-${suffix}`;
  const companyName = `Accessibility Proof ${mobile ? "Mobile" : "Desktop"} ${suffix}`;
  const username = `a11y_${suffix}`;

  await seedAccessibleMarket(page, slug, companyName, username);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Valuation markets" })).toBeVisible();
  await expect(page.getByRole("link", { name: companyName, exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto(`/m/${slug}`);
  await expect(page.getByRole("heading", { name: companyName })).toBeVisible();

  const chartRegion = page.getByRole("region", { name: "Market history" });
  const chartSummary = chartRegion.locator("p").filter({ hasText: "current 60-minute mark" });
  await expect(chartSummary).toBeVisible();
  await expect(chartSummary).toContainText("YES probability was unchanged");
  await expect(chartSummary).toContainText("from 50.0% to 50.0%");
  await expect(chartRegion.locator('[aria-hidden="true"]').last()).toBeAttached();

  const movementCue = page.getByLabel("Current market metrics").locator("small");
  await expect(movementCue).toContainText("Unchanged");
  await expect(movementCue.locator('[aria-hidden="true"]')).toHaveText("→");
  const movementProof = expect.poll(async () => movementCue.evaluate((element) => ({
    hasLabel: element.textContent?.includes("Moved up") ?? false,
    glyph: element.querySelector('[aria-hidden="true"]')?.textContent ?? "",
  })), {
    timeout: 10_000,
    intervals: [50],
  }).toEqual({ hasLabel: true, glyph: "↑" });
  const origin = new URL(page.url()).origin;
  const mutationHeaders = { Origin: origin };
  const quoteResponse = await page.request.post("/api/quote", {
    headers: mutationHeaders,
    data: {
      slug,
      action: "buy",
      side: "yes",
      strike_index: 0,
      spend_usd: "1.00",
    },
  });
  expect(quoteResponse.status()).toBe(200);
  const tradeResponse = await page.request.post("/api/trade", {
    headers: mutationHeaders,
    data: {
      slug,
      action: "buy",
      side: "yes",
      strike_index: 0,
      spend_usd: "1.00",
      max_cost_usd: "1.00",
      idempotency_key: randomUUID(),
    },
  });
  expect(tradeResponse.status()).toBe(200);
  const accessibilityExecution = await tradeResponse.json() as {
    readonly cash_balance_cents: string;
  };
  await movementProof;

  const yesButton = page
    .getByRole("region", { name: "Outcome contract" })
    .getByRole("button", { name: /YES$/ });
  await tabTo(page, yesButton);
  await expect(yesButton).toBeFocused();
  const focusIndicator = await yesButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      boxShadow: style.boxShadow,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  expect(
    focusIndicator.boxShadow !== "none"
      || (focusIndicator.outlineStyle !== "none" && Number.parseFloat(focusIndicator.outlineWidth) > 0),
  ).toBe(true);

  await page.keyboard.press("Enter");
  const ticket = page.getByRole("region", { name: "Trade ticket" });
  await expect(ticket).toBeVisible();
  await expect(ticket.getByLabel("Spend")).toBeVisible();

  if (mobile) {
    const dialog = page.getByRole("dialog", { name: `Trade ${companyName}` });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-describedby", "trade-sheet-description");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

    for (let index = 0; index < 10; index += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await expectNoHorizontalOverflow(page);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(yesButton).toBeFocused();
  } else {
    await expect(page.getByLabel("Trade rail")).toContainText("Trade ticket");
  }

  await expectNoHorizontalOverflow(page);

  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
  await expect(page.getByLabel("Portfolio summary")).toContainText(
    formatCents(accessibilityExecution.cash_balance_cents),
  );
  await expectNoHorizontalOverflow(page);

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Market administration" })).toBeVisible();
  await expect(page.getByLabel("Admin passphrase")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
