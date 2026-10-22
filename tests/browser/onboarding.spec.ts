import { randomUUID } from "node:crypto";

import { type Browser, expect, type Page, test } from "@playwright/test";

import { expectNoHorizontalOverflow, skipWithoutDatabase, uniqueHandle } from "./helpers.js";

/**
 * Onboarding: the tournament is the front door; a new account goes sign-in →
 * welcome (an optional affiliation) → the questions, and a returning one goes
 * straight back to where it started.
 */
skipWithoutDatabase();

const MINUTE = 60_000;
const PASSWORD = "browser-test-password";
// A route's first visit compiles it in the dev server, which on a cold run
// can outlast the default expect timeout; every landing waits this long.
const LANDING = { timeout: 45_000 };

/** The allowlisted dev admin drafts a binary question and opens it. */
async function openQuestion(browser: Browser, baseURL: string, slug: string, title: string) {
  const admin = await browser.newContext({ baseURL });
  const headers = { origin: new URL(baseURL).origin, "content-type": "application/json" };
  expect(
    (await admin.request.post("/api/t/auth/dev", { headers, data: { handle: "pw_admin" } })).ok(),
  ).toBe(true);
  const saved = await admin.request.post("/api/t/admin/questions", {
    headers,
    data: {
      slug,
      title,
      kind: "binary",
      description_md: "An onboarding-test question.",
      rulebook_md: "Resolves to the **test** figure.",
      rulebook_version: 1,
      opens_at: new Date(Date.now() - MINUTE).toISOString(),
      closes_at: new Date(Date.now() + 60 * MINUTE).toISOString(),
      min_account_age_days: 0,
    },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const opened = await admin.request.post(`/api/t/admin/questions/${slug}/open`, {
    headers,
    data: {},
  });
  expect(opened.ok(), await opened.text()).toBe(true);
  await admin.close();
}

/** Fills the sign-in page's username form in the given mode and submits it. */
async function submitPasswordForm(
  page: Page,
  mode: "Sign in" | "Create account",
  username: string,
): Promise<void> {
  const main = page.getByRole("main");
  await main.getByRole("group").getByRole("button", { name: mode, exact: true }).click();
  await main.getByRole("textbox", { name: "Username" }).fill(username);
  await main.getByLabel("Password").fill(PASSWORD);
  await main.locator("form").getByRole("button", { name: mode, exact: true }).click();
}

function username(prefix: string, testInfo: Parameters<typeof uniqueHandle>[1]): string {
  return uniqueHandle(prefix, testInfo).slice(0, 20);
}

test("/ opens the tournament, and the markets board lives at /m", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/t$/, LANDING);
  await expect(page.getByRole("heading", { level: 1, name: "Questions" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByRole("link")).toHaveText(["Tournament", "Markets", "Portfolio"]);
  await expect(nav.getByRole("link", { name: "Tournament" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await nav.getByRole("link", { name: "Markets" }).click();
  await expect(page).toHaveURL(/\/m$/, LANDING);
  await expect(page.getByRole("tabpanel", { name: "Board" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Markets" })).toHaveAttribute("aria-current", "page");
  await expectNoHorizontalOverflow(page);
});

test("a new account goes from the questions' sign-in through welcome, skips, and lands on the open questions", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const slug = `pw-onboard-${randomUUID().slice(0, 8)}`;
  const title = `Onboarding question ${slug}`;
  await openQuestion(browser, baseURL!, slug, title);
  const name = username("pw_new", testInfo);

  await page.goto("/t");
  const callout = page.getByRole("main").getByRole("link", { name: "Sign in to forecast" });
  await expect(callout).toHaveAttribute("href", "/t/signin?return=%2Ft");
  await callout.click();
  await expect(page).toHaveURL(/\/t\/signin\?return=%2Ft$/, LANDING);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to forecast" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await submitPasswordForm(page, "Create account", name);
  await expect(page).toHaveURL(/\/t\/welcome$/, LANDING);
  await expect(page.getByRole("heading", { level: 1, name: `Welcome, ${name}` })).toBeVisible();
  await expect(page.getByText("Forecasts are public.")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "Affiliation (optional)" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("main").getByRole("link", { name: "Skip" }).click();
  await expect(page).toHaveURL(/\/t$/, LANDING);
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("link", { name: "Sign in to forecast" }),
  ).toHaveCount(0);
});

test("a new account saves an affiliation on the welcome step and it shows on the profile", async ({
  page,
}, testInfo) => {
  const name = username("pw_aff", testInfo);
  const affiliation = `Lab ${randomUUID().slice(0, 6)}`;
  await page.goto("/t/signin");
  await submitPasswordForm(page, "Create account", name);
  await expect(page).toHaveURL(/\/t\/welcome$/, LANDING);

  await page.getByRole("textbox", { name: "Affiliation (optional)" }).fill(affiliation);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(/\/t$/, LANDING);

  await page.goto(`/t/u/~${name}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByTitle("Self-reported affiliation")).toHaveText(affiliation);
  await expect(page.getByRole("textbox", { name: "Affiliation" })).toHaveValue(affiliation);
});

test("a new account that started on a question returns to it through the welcome step", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const slug = `pw-return-${randomUUID().slice(0, 8)}`;
  const title = `Return question ${slug}`;
  await openQuestion(browser, baseURL!, slug, title);
  const name = username("pw_q", testInfo);

  await page.goto(`/t/q/${slug}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page
    .getByRole("main")
    .getByRole("link", { name: /^Sign in/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/t/signin\\?return=%2Ft%2Fq%2F${slug}$`), LANDING);
  await submitPasswordForm(page, "Create account", name);
  await expect(page).toHaveURL(new RegExp(`/t/welcome\\?return=%2Ft%2Fq%2F${slug}$`), LANDING);
  await page.getByRole("main").getByRole("link", { name: "Skip" }).click();
  await expect(page).toHaveURL(new RegExp(`/t/q/${slug}$`), LANDING);
  await expect(page.getByText("Forecasts are public.")).toBeVisible();
});

test("a returning sign-in goes straight to its return path", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const name = username("pw_back", testInfo);
  const first = await browser.newContext({ baseURL: baseURL! });
  const registered = await first.request.post("/api/t/auth/password/register", {
    headers: { origin: new URL(baseURL!).origin, "content-type": "application/json" },
    data: { username: name, password: PASSWORD },
  });
  expect(registered.ok(), await registered.text()).toBe(true);
  await first.close();

  await page.goto("/t/signin?return=%2Ft%2Fleaderboard");
  await submitPasswordForm(page, "Sign in", name);
  await expect(page).toHaveURL(/\/t\/leaderboard$/, LANDING);
  await expect(
    page.getByRole("banner").getByRole("link", { name: `${name}, your forecasts` }),
  ).toBeVisible();
});

test("the welcome step sends a signed-out visitor to sign in first", async ({ page }) => {
  await page.goto("/t/welcome");
  await expect(page).toHaveURL(/\/t\/signin\?return=%2Ft%2Fwelcome$/, LANDING);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to forecast" })).toBeVisible();
});
