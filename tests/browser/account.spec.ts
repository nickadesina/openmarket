import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  formatCents,
  signInDev,
  skipWithoutDatabase,
  uniqueHandle,
} from "./helpers.js";

skipWithoutDatabase();

const OPENING_BALANCE = formatCents("10000000");

test("signed out, the header and the portfolio send sign-in back to the page", async ({ page }) => {
  await page.goto("/portfolio");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Sign in to see your portfolio" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/t/signin?return=%2Fportfolio",
  );
  await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/t/signin?return=%2Fportfolio",
  );
  await expect(page.getByText(/username/i)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("the first portfolio view opens a $100,000 paper account for the tournament identity", async ({
  page,
  baseURL,
}, testInfo) => {
  const mobile = testInfo.project.name.includes("mobile");
  const handle = uniqueHandle("paper", testInfo);
  await signInDev(page, baseURL, handle);

  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
  await expect(page.getByText(`Account · @${handle}`)).toBeVisible();
  await expect(page.getByLabel("Portfolio summary")).toContainText(OPENING_BALANCE);

  const banner = page.getByRole("banner");
  await expect(banner.getByRole("link", { name: `@${handle}, your forecasts` })).toBeVisible();
  if (!mobile) await expect(banner).toContainText(`${OPENING_BALANCE} cash`);
  await expectNoHorizontalOverflow(page);

  if (!mobile) {
    await banner.getByRole("button", { name: "Sign out" }).click();
    await expect(
      page.getByRole("heading", { name: "Sign in to see your portfolio" }),
    ).toBeVisible();
  }
});

test("a username account created on the sign-in page returns to where it started after welcome", async ({
  page,
}, testInfo) => {
  const username = uniqueHandle("pw", testInfo).slice(0, 20);
  await page.goto("/t/signin?return=%2Fportfolio");
  await page.getByRole("button", { name: "Create account" }).first().click();
  await page.getByRole("textbox", { name: "Username" }).fill(username);
  await page.getByLabel("Password").fill("browser-test-password");
  await page.getByRole("button", { name: "Create account" }).last().click();

  // The welcome route may compile on this first visit in the dev server.
  await expect(page).toHaveURL(/\/t\/welcome\?return=%2Fportfolio$/, { timeout: 45_000 });
  await page.getByRole("main").getByRole("link", { name: "Skip" }).click();
  await expect(page).toHaveURL(/\/portfolio$/);
  await expect(page.getByText(`Account · ${username}`)).toBeVisible();
  await expect(page.getByLabel("Portfolio summary")).toContainText(OPENING_BALANCE);
});

test("admin moderation is gated by the tournament admin allowlist", async ({
  page,
  baseURL,
}, testInfo) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Market administration" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Admin only." })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Sign in" })).toBeVisible();

  await signInDev(page, baseURL, uniqueHandle("visitor", testInfo));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Admin only." })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Sign in" })).toHaveCount(0);

  await signInDev(page, baseURL, "pw_admin");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Market comments" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /^Market/ })).toBeVisible();
  await expect(page.getByText(/passphrase/i)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("the skip link jumps to main content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("main-content");
  await expectNoHorizontalOverflow(page);
});
