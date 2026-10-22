import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  openTicket,
  signInDev,
  skipWithoutDatabase,
  uniqueHandle,
} from "./helpers.js";

/**
 * Restricted persons (README D12): a forecaster attests a tie to one listed
 * name on their profile; that name's page shows no ticket and the server
 * refuses its quotes, while another name trades as before.
 */
skipWithoutDatabase();

test("a restricted forecaster sees no ticket on that name's page and can trade another name", async ({
  page,
  baseURL,
}, testInfo) => {
  const handle = uniqueHandle("restricted", testInfo);
  await signInDev(page, baseURL, handle);

  await page.goto(`/t/u/${handle}`);
  const form = page.getByRole("form", { name: "Restricted names" });
  await form.getByRole("checkbox", { name: "Modal", exact: true }).check();
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByRole("status")).toHaveText("Saved.");
  await expectNoHorizontalOverflow(page);

  await page.goto("/m/modal");
  await expect(page.getByRole("heading", { level: 1, name: "Modal" })).toBeVisible();
  // The rail carries the reason on desktop, the trade bar's place on a phone: one is shown.
  const note = page.getByRole("note").filter({ visible: true });
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("Not open to you");
  await expect(note).toContainText("You attested a tie to Modal");
  await expect(page.getByRole("region", { name: "Trade ticket" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Trade", exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  // The server refuses it regardless of the page.
  const modal = await (await page.request.get("/api/markets/modal")).json();
  const refused = await page.request.get(
    `/api/instruments/${modal.forward.instrument_id}/quote?side=long&notional_usd=100.00`,
  );
  expect(refused.status()).toBe(403);
  expect((await refused.json()).error.code).toBe("RESTRICTED_PERSON");

  await page.goto("/m/instinct");
  const ticket = await openTicket(page);
  await ticket.getByRole("button", { name: "$500", exact: true }).click();
  await expect(ticket.getByText("Entry (ask)")).toBeVisible();
  await ticket.getByRole("button", { name: "Confirm long" }).click();
  await expect(ticket.getByRole("status").filter({ hasText: "Long filled" })).toBeVisible();
});
