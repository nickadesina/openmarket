import { expect, test } from "@playwright/test";

import { expectNoHorizontalOverflow, skipWithoutDatabase } from "./helpers.js";

/**
 * Decision 0005 over the demo trades global-setup.ts seeds: the board and a
 * market page say these are paper demo markets and point to the tournament,
 * and every fill from a demo account carries a Demo tag.
 */
skipWithoutDatabase();

test("a market page shows the demo banner and Demo-tagged activity", async ({ page }) => {
  await page.goto("/m/openai");
  await expect(page.getByRole("heading", { level: 1, name: "OpenAI" })).toBeVisible();

  const banner = page.getByRole("region", { name: "Demo markets" });
  await expect(banner).toContainText("paper demo markets");
  await expect(banner).toContainText("five demo accounts");
  await expect(banner.getByRole("link", { name: "Go to the tournament" })).toHaveAttribute(
    "href",
    "/t",
  );

  const activity = page.getByRole("region", { name: "Market activity" });
  const rows = activity.getByRole("listitem");
  await expect(rows.first()).toBeVisible();
  await expect(rows.filter({ hasText: "Demo account" }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("the board carries the demo banner and the tape tags demo trades", async ({ page }) => {
  await page.goto("/");
  const board = page.getByRole("tabpanel", { name: "Board" });
  await expect(board.getByRole("region", { name: "Demo markets" })).toBeVisible();
  const tape = page.getByRole("list", { name: "Recent public trades" });
  await expect(
    tape.getByRole("listitem").filter({ hasText: "Demo account" }).first(),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
