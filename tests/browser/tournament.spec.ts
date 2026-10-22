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

/** One admin mutation as the allowlisted dev admin. */
async function adminPost(browser: Browser, baseURL: string, path: string, data: unknown) {
  const admin = await browser.newContext({ baseURL });
  const headers = { origin: new URL(baseURL).origin, "content-type": "application/json" };
  expect(
    (await admin.request.post("/api/t/auth/dev", { headers, data: { handle: "pw_admin" } })).ok(),
  ).toBe(true);
  const response = await admin.request.post(path, { headers, data });
  expect(response.ok(), await response.text()).toBe(true);
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
    level_label: "Next post-money",
    expiry_at: new Date(Date.now() + 120 * MINUTE).toISOString(),
  });

  await page.goto(`/t/q/${slug}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("Forward · USD billions")).toBeVisible();
  await expect(page.getByText("Not enough forecasts yet.")).toBeVisible();
  const settles = page.getByRole("region", { name: "How this settles" });
  await expect(settles).toContainText("Settles at the next post-money when it prints.");
  await expect(settles).toContainText("the question voids and nobody is scored.");
  await expect(settles.getByRole("link", { name: "Full rules" })).toHaveAttribute(
    "href",
    "#rulebook",
  );

  await signInAndReload(page, baseURL!, handle);
  const field = page.getByRole("textbox", { name: "Next post-money" });
  await expect(field).toBeVisible();
  // The live score row appears only once a valid level is typed.
  await expect(page.getByText(/^You enter /)).toHaveCount(0);
  await expect(
    page.getByText(/^Forecast now and your number counts for \d+ of those/),
  ).toBeVisible();
  await field.fill("412");
  // forwardScore: exact 100, 10% off 86.25, 2× off 0, at four significant digits.
  await expect(
    page.getByText(
      "You enter $412B. If it settles at $412B you score +100; at $453.2B or $374.5B, +86; at $824B or $206B, 0.",
    ),
  ).toBeVisible();
  await field.fill("abc");
  await expect(page.getByText(/^You enter /)).toHaveCount(0);
  await field.fill("412");
  await page.getByRole("button", { name: "Submit forecast" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recorded" })).toBeVisible();
  await expect(
    page.getByText(/^Your forecast counts from .+ to the close: \d+ of those \d+ minutes\.$/),
  ).toBeVisible();

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
  const settles = page.getByRole("region", { name: "How this settles" });
  await expect(settles).toContainText("Settles YES if what the question asks happens by");
  await expect(settles).toContainText("is NO.");
  await signInAndReload(page, baseURL!, handle);

  const field = page.getByRole("spinbutton", { name: "Chance of YES" });
  await field.fill("70");
  const preview = page.getByRole("definition");
  // 100/ln 2 · ln(2p): 70% scores +48.5 on YES and −73.7 on NO.
  await expect(page.getByText("If YES")).toBeVisible();
  await expect(page.getByText("If NO")).toBeVisible();
  await expect(preview.filter({ hasText: "+48.5" })).toBeVisible();
  await expect(preview.filter({ hasText: "−73.7" })).toBeVisible();
  await expect(
    page.getByText("50% scores 0.0 either way; 99.9% scores +99.9 if right and −896.6 if wrong.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Submit forecast" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recorded" })).toBeVisible();

  // At phone width the table reflows into stacked rows, so rows are found by element.
  const row = page.locator("tbody tr").filter({ hasText: `@${handle}` });
  await expect(row).toContainText("70.0% yes");
  await expectNoHorizontalOverflow(page);

  // Once it resolves, the forecaster's own stored score sits beside the outcome.
  await adminPost(browser, baseURL!, `/api/t/admin/questions/${slug}/close`, {});
  await adminPost(browser, baseURL!, `/api/t/admin/questions/${slug}/resolve`, {
    outcome: "yes",
    rung_fired: 1,
    source_url: null,
    source_excerpt: null,
    note_md: "Resolved by the browser test.",
  });
  await page.reload();
  const resolution = page.getByRole("region", { name: "Resolution" });
  await expect(resolution.getByText("YES", { exact: true })).toBeVisible();
  await expect(resolution.getByText(/^[+−]?\d+\.\d · (<1|\d+)% of the window$/)).toBeVisible();
  await expect(resolution.getByText("Your score")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
