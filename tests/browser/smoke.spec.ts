import { expect, test } from "@playwright/test";

/**
 * What renders between the archive of v1 and the index's pages (P5 rewrites
 * these): the holding page, the published documents, the rulebook's JSON,
 * and v1's paths sent home.
 */
test.skip(
  !process.env.DATABASE_URL_TEST,
  "DATABASE_URL_TEST is required for browser tests; local runs skip without it.",
);

test("the holding page names the index and links the published documents", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "OpenMarket" })).toBeVisible();
  await expect(page.getByText("built only from public filings").first()).toBeVisible();
  const documents = page.getByRole("navigation", { name: "Published documents" });
  for (const name of ["Rulebook", "Resolution sources", "Reference API"]) {
    await expect(documents.getByRole("link", { name })).toBeVisible();
  }
});

test("the rulebook, the resolution sources and the API docs render", async ({ page }) => {
  await page.goto("/rulebook");
  await expect(page.getByRole("heading", { level: 1, name: "Rulebook" })).toBeVisible();
  await page.goto("/resolution-sources");
  await expect(
    page.getByRole("heading", { level: 1, name: "How private-company valuation venues settle" }),
  ).toBeVisible();
  await page.goto("/ref");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("reference API");
});

test("the rulebook is published as JSON under the envelope", async ({ request }) => {
  const response = await request.get("/api/ref/rulebook");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(Object.keys(body).slice(0, 2)).toEqual(["rulebook_version", "as_of"]);
});

for (const path of [
  "/m",
  "/m/modal",
  "/t",
  "/t/leaderboard",
  "/portfolio",
  "/admin/dealer",
  "/for-policy",
]) {
  test(`v1's ${path} redirects home`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "OpenMarket" })).toBeVisible();
  });
}
