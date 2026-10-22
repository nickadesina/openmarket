import { randomUUID } from "node:crypto";

import { type Browser, expect, type Page, test } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  signInDev,
  skipWithoutDatabase,
  uniqueHandle,
} from "./helpers.js";

skipWithoutDatabase();

const MINUTE = 60_000;

/** The allowlisted dev admin drafts the question, then opens it. */
async function createOpenQuestion(
  browser: Browser,
  baseURL: string,
  draft: Record<string, unknown>,
): Promise<void> {
  const origin = new URL(baseURL).origin;
  const admin = await browser.newContext({ baseURL });
  const headers = { origin, "content-type": "application/json" };
  expect(
    (await admin.request.post("/api/t/auth/dev", { headers, data: { handle: "pw_admin" } })).ok(),
  ).toBe(true);
  const saved = await admin.request.post("/api/t/admin/questions", {
    headers,
    data: {
      description_md: "A browser-test question.",
      rulebook_md: "Resolves to the **test** figure.",
      rulebook_version: 1,
      opens_at: new Date(Date.now() - MINUTE).toISOString(),
      closes_at: new Date(Date.now() + 60 * MINUTE).toISOString(),
      min_account_age_days: 0,
      ...draft,
    },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const opened = await admin.request.post(`/api/t/admin/questions/${draft.slug}/open`, {
    headers,
    data: {},
  });
  expect(opened.ok(), await opened.text()).toBe(true);
  await admin.close();
}

async function signInAndReload(page: Page, baseURL: string, handle: string): Promise<void> {
  await signInDev(page, baseURL, handle);
  await page.reload();
  await expect(page.getByText("Forecasts are public.")).toBeVisible();
}

test("a forecaster submits a forward level and sees it in the list and on their profile", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const slug = `pw-forward-${randomUUID().slice(0, 8)}`;
  const title = `Browser forward ${slug}`;
  const handle = uniqueHandle("pw_fwd", testInfo);
  await createOpenQuestion(browser, baseURL!, {
    slug,
    title,
    kind: "forward",
    unit: "USD_B",
    expiry_at: new Date(Date.now() + 120 * MINUTE).toISOString(),
  });

  await page.goto(`/t/q/${slug}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("Forward · USD billions")).toBeVisible();
  await expect(page.getByText("Not enough forecasts yet.")).toBeVisible();

  await signInAndReload(page, baseURL!, handle);
  const field = page.getByRole("textbox", { name: "Level in USD billions" });
  await expect(field).toBeVisible();
  await expect(page.getByText(/the question voids and nothing is scored/)).toBeVisible();
  await expect(page.getByText("Exact 100 · 10% off 86 · 2× off 0")).toBeVisible();
  await field.fill("412");
  await page.getByRole("button", { name: "Submit forecast" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recorded" })).toBeVisible();

  // At phone width the table reflows into stacked rows, so rows are found by element.
  const row = page.locator("tbody tr").filter({ hasText: `@${handle}` });
  await expect(row).toContainText("$412B");
  await expect(row.getByRole("link", { name: /Timestamp proof/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto(`/t/u/${handle}`);
  await expect(page.getByRole("heading", { name: `@${handle}` })).toBeVisible();
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  await expect(page.getByText("$412B")).toBeVisible();
});

test("a forecaster submits a chance of YES with its score preview", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const slug = `pw-binary-${randomUUID().slice(0, 8)}`;
  const title = `Browser binary ${slug}`;
  const handle = uniqueHandle("pw_bin", testInfo);
  await createOpenQuestion(browser, baseURL!, { slug, title, kind: "binary" });

  await page.goto(`/t/q/${slug}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await signInAndReload(page, baseURL!, handle);

  const field = page.getByRole("spinbutton", { name: "Chance of YES" });
  await field.fill("70");
  const preview = page.getByRole("definition");
  // 100/ln 2 · ln(2p): 70% scores +48.5 on YES and −73.7 on NO.
  await expect(page.getByText("If YES")).toBeVisible();
  await expect(preview.filter({ hasText: "+48.5" })).toBeVisible();
  await expect(preview.filter({ hasText: "−73.7" })).toBeVisible();
  await page.getByRole("button", { name: "Submit forecast" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recorded" })).toBeVisible();

  // At phone width the table reflows into stacked rows, so rows are found by element.
  const row = page.locator("tbody tr").filter({ hasText: `@${handle}` });
  await expect(row).toContainText("70.0% yes");
  await expectNoHorizontalOverflow(page);
});
