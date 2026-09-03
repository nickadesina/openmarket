import { expect, test } from "@playwright/test";

import {
  buyViaApi,
  createUser,
  expectNoHorizontalOverflow,
  seedValuationMarket,
  skipWithoutDatabase,
  uniqueNames,
} from "./helpers.js";

skipWithoutDatabase();

test("a valuation market renders the ladder, anchor, and distribution", async ({
  page,
  baseURL,
}, testInfo) => {
  const names = uniqueNames("val-render", testInfo);
  await seedValuationMarket(page, baseURL, names);

  await page.goto(`/m/${names.slug}`);
  await expect(page.getByRole("heading", { name: names.companyName })).toBeVisible();
  await expect(
    page.getByText("Next reported private-market valuation", { exact: true }),
  ).toBeVisible();

  const metrics = page.getByLabel("Current market metrics");
  await expect(metrics.getByText("Reference anchor")).toBeVisible();
  await expect(metrics).toContainText("$65B");

  const ladder = page.getByRole("region", { name: "Probability ladder" });
  await expect(ladder.getByRole("columnheader", { name: "Valuation above" })).toBeVisible();
  const yesButtons = ladder.getByRole("button", { name: /^YES/ });
  expect(await yesButtons.count()).toBeGreaterThan(1);
  await expect(ladder.getByRole("rowheader").first()).toContainText("$");

  // Near-certain tails fold into OVER / UNDER rows; unfolding reveals them.
  const underRow = ladder.getByRole("button", { name: /^Under/ });
  if (await underRow.count()) {
    const contestedCount = await yesButtons.count();
    await underRow.click();
    expect(await yesButtons.count()).toBeGreaterThan(contestedCount);
    await underRow.click();
  }

  const distribution = page.getByText("Implied distribution");
  await distribution.click();
  await expect(page.getByText(/Highest-probability outcomes:/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("selecting a strike opens a ticket labeled with that contract", async ({
  page,
  baseURL,
}, testInfo) => {
  const names = uniqueNames("val-select", testInfo);
  await seedValuationMarket(page, baseURL, names);
  await createUser(page, baseURL, names.username);

  await page.goto(`/m/${names.slug}`);
  const ladder = page.getByRole("region", { name: "Probability ladder" });
  const firstRow = ladder.getByRole("row").nth(1);
  const strikeLabel = (await firstRow.getByRole("rowheader").innerText()).trim();
  await firstRow.getByRole("button", { name: /NO$/ }).click();

  const ticket = page.getByRole("region", { name: "Trade ticket" });
  await expect(ticket).toBeVisible();
  await expect(ticket).toContainText(`NO · ${strikeLabel}`);

  // On mobile the ticket opens as a modal sheet that hides the ladder from the
  // accessibility tree; close it before asserting the selected state.
  if (testInfo.project.name.includes("mobile")) {
    await page.keyboard.press("Escape");
  }
  await expect(firstRow.getByRole("button", { name: /NO$/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("trades on strike contracts appear in activity with directional labels", async ({
  page,
  baseURL,
}, testInfo) => {
  const names = uniqueNames("val-activity", testInfo);
  await seedValuationMarket(page, baseURL, names);
  await createUser(page, baseURL, names.username);
  await buyViaApi(page, baseURL, {
    slug: names.slug,
    spendUsd: "50.00",
    strikeIndex: 0,
    side: "yes",
  });
  await buyViaApi(page, baseURL, {
    slug: names.slug,
    spendUsd: "25.00",
    strikeIndex: 0,
    side: "no",
  });

  await page.goto(`/m/${names.slug}`);
  const activity = page.getByRole("region", { name: "Market activity" });
  await expect(activity.getByText(/^Bought [\d.,]+ YES above \$/).first()).toBeVisible();
  await expect(activity.getByText(/^Bought [\d.,]+ NO at or below \$/).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
