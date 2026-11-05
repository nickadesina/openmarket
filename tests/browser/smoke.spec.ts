import { expect, test } from "@playwright/test";

/**
 * The index's pages against the database tests/browser/seed.ts fills from
 * real filings: Fidelity's N-PORT with three Anthropic holdings, New Economy
 * Fund's Epic Games holding (Unclassified, so outside every series), the
 * round history and two Form Ds. Plus the published documents, the
 * rulebook's JSON and v1's paths sent home.
 */
test.skip(
  !process.env.DATABASE_URL_TEST,
  "DATABASE_URL_TEST is required for browser tests; local runs skip without it.",
);

const FIDELITY_FILING =
  "https://www.sec.gov/Archives/edgar/data/707823/000003540226006778/primary_doc.xml";

test("the daily page lists the names with a consensus and says why the others have none", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Private-company marks from public filings" }),
  ).toBeVisible();
  await expect(page.getByText(/public only about 60 days after/).first()).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  for (const name of ["Index", "Methodology", "Rulebook", "API", "Corrections"]) {
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Anthropic", exact: true })).toHaveAttribute(
    "href",
    "/n/anthropic",
  );
  // Epic Games' one holding is Unclassified: live marks, no per-share series.
  const epic = page.getByRole("row").filter({ hasText: "Epic Games" });
  await expect(epic.getByText("No per-share series")).toBeVisible();
  // Modal is named in no fund filing (data/index/filing-counts.json).
  const modal = page.getByRole("row").filter({ hasText: "Modal" });
  await expect(modal.getByText(/No N-PORT, N-CSR or N-CSRS filing names it/)).toBeVisible();
});

test("a name page links every family mark to its filing", async ({ page, request }) => {
  await page.goto("/n/anthropic");
  await expect(page.getByRole("heading", { level: 1, name: "Anthropic" })).toBeVisible();
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    /^Anthropic: /,
  );
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
    "content",
    /Latest filing 2026-10-26/,
  );
  const chart = page.getByRole("img", { name: /Consensus/ }).first();
  await expect(chart).toBeVisible();
  await expect(chart.locator(`a[href="${FIDELITY_FILING}"]`).first()).toBeAttached();
  await expect(page.getByRole("link", { name: "0000035402-26-006778" }).first()).toHaveAttribute(
    "href",
    FIDELITY_FILING,
  );
  await expect(
    page.getByText(/No certificate of incorporation has been transcribed/),
  ).toBeVisible();
  await expect(page.getByText(/unit quotes are not captured/)).toBeVisible();
  await expect(page.getByText(/Granada Anthropic SPV/)).toBeVisible();

  const csv = await request.get("/data/filer-marks.csv?issuer=anthropic");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect((await csv.text()).split("\r\n").filter(Boolean)).toHaveLength(4);
});

test("a name's marks outside the series are published as filed, with the reason", async ({
  page,
}) => {
  await page.goto("/n/epic-games");
  const section = page.locator("#out-of-series");
  await section.getByText("Unclassified").first().click();
  await expect(section.getByText(/EPIC GAMES INC PP/)).toBeVisible();
  await expect(section.getByText(/names no security/)).toBeVisible();
});

test("the methodology renders with the engine's constants", async ({ page }) => {
  await page.goto("/methodology");
  await expect(
    page.getByRole("heading", { level: 1, name: "OpenMarket methodology" }),
  ).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "revision_threshold_ln" });
  await expect(row).toContainText("0.005");
});

test("the corrections page states the policy and lists the log", async ({ page }) => {
  await page.goto("/corrections");
  await expect(page.getByRole("heading", { level: 1, name: "Corrections" })).toBeVisible();
  await expect(page.getByText(/A row is never edited in place/)).toBeVisible();
  await expect(page.getByText("No correction has been published.")).toBeVisible();
});

test("an unknown name is not found", async ({ page }) => {
  const response = await page.goto("/n/no-such-name");
  expect(response?.status()).toBe(404);
});

test("the rulebook, the resolution sources and the API docs render", async ({ page }) => {
  await page.goto("/rulebook");
  await expect(page.getByRole("heading", { level: 1, name: "Rulebook" })).toBeVisible();
  await page.goto("/resolution-sources");
  await expect(
    page.getByRole("heading", { level: 1, name: "How private-company valuation venues settle" }),
  ).toBeVisible();
  await page.goto("/ref");
  await expect(
    page.getByRole("heading", { level: 1, name: "The marks index as data" }),
  ).toBeVisible();
});

test("the rulebook is published as JSON under the envelope", async ({ request }) => {
  const response = await request.get("/api/ref/rulebook");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(Object.keys(body).slice(0, 5)).toEqual([
    "methodology_version",
    "ce_version",
    "rulebook_version",
    "as_of",
    "lag_note",
  ]);
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
    await expect(
      page.getByRole("heading", { level: 1, name: "Private-company marks from public filings" }),
    ).toBeVisible();
  });
}
