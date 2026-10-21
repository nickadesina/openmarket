import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { skipWithoutDatabase } from "./helpers.js";

skipWithoutDatabase();

const MINUTE = 60_000;

test("a forecaster signs in, submits a distribution, and sees it on their positions", async ({
  page,
  browser,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const slug = `pw-ladder-${randomUUID().slice(0, 8)}`;
  const handle = `pw_${randomUUID().slice(0, 8)}`;

  // The admin is an allowlisted dev identity; questions are drafted then opened.
  const admin = await browser.newContext();
  const headers = { origin, "content-type": "application/json" };
  expect(
    (await admin.request.post("/api/t/auth/dev", { headers, data: { handle: "pw_admin" } })).ok(),
  ).toBe(true);
  const draft = await admin.request.post("/api/t/admin/questions", {
    headers,
    data: {
      slug,
      title: `Browser ladder ${slug}`,
      description_md: "A browser-test question.",
      rulebook_md: "Resolves to the **test** value.",
      rulebook_version: 1,
      unit: "USD_B",
      opens_at: new Date(Date.now() - MINUTE).toISOString(),
      closes_at: new Date(Date.now() + 60 * MINUTE).toISOString(),
      expiry_at: new Date(Date.now() + 60 * MINUTE).toISOString(),
      min_account_age_days: 0,
      buckets: { edges: [10, 20], floor_label: "Nothing by expiry" },
    },
  });
  expect(draft.ok()).toBe(true);
  expect(
    (await admin.request.post(`/api/t/admin/questions/${slug}/open`, { headers, data: {} })).ok(),
  ).toBe(true);
  await admin.close();

  await page.goto(`/t/q/${slug}`);
  await expect(page.getByRole("heading", { name: `Browser ladder ${slug}` })).toBeVisible();
  await expect(page.getByText("Not enough forecasts yet.")).toBeVisible();

  await page.request.post("/api/t/auth/dev", { headers, data: { handle } });
  await page.reload();
  await expect(page.getByText("Forecasts are public.")).toBeVisible();

  await page.getByRole("spinbutton", { name: "10–20" }).fill("70");
  await page.getByRole("button", { name: "Submit forecast" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recorded" })).toBeVisible();

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(page.viewportSize()!.width);

  await page.goto(`/t/u/${handle}`);
  await expect(page.getByRole("heading", { name: `@${handle}` })).toBeVisible();
  await expect(page.getByRole("link", { name: `Browser ladder ${slug}` })).toBeVisible();
});
