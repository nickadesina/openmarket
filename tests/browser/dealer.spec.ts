import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  isMobile,
  openTicket,
  signInDev,
  skipWithoutDatabase,
  uniqueHandle,
} from "./helpers.js";

/**
 * The dealer UI over the listings and dealer job that global-setup.ts writes:
 * the board, a listed name's page, the forward and binary tickets, the
 * portfolio, a moved price, phone widths and keyboard reach.
 */
skipWithoutDatabase();

const NAMES = ["Anduril", "Anthropic", "Instinct", "Modal", "OpenAI"] as const;
const PRICE = /\$\d[\d.,]*[MBT]/;

test("the board lists the five names with forward and binary prices", async ({ page }) => {
  await page.goto("/m");
  const board = page.getByRole("tabpanel", { name: "Board" });
  for (const name of NAMES) {
    await expect(board.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(board.getByText(PRICE).first()).toBeVisible();
  expect(await board.getByText(/^\$\d[\d.]*[MBT]$/).count()).toBeGreaterThanOrEqual(NAMES.length);
  expect(await board.getByText(/^\d+\.\d%$/).count()).toBe(NAMES.length);
  await expect(board.getByText(/by Dec 31, 2026/)).toHaveCount(NAMES.length);
  await expect(board.getByText(/ladder/i)).toHaveCount(0);
  await expect(page.getByText("Stripe")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  const modal = board.getByRole("link", { name: "Modal", exact: true });
  await expect(modal).toHaveAttribute("href", "/m/modal");
  // The first visit to a market page compiles the route in the dev server,
  // which can outlast the default expect timeout on a cold CI runner.
  await modal.click();
  await expect(page).toHaveURL(/\/m\/modal$/, { timeout: 45_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Modal" })).toBeVisible();
});

test("a market page shows the forward, the binary and a read-only implied ladder", async ({
  page,
}) => {
  await page.goto("/m/anthropic");
  await expect(page.getByRole("heading", { level: 1, name: "Anthropic" })).toBeVisible();
  const figures = page.getByLabel("Current market figures");
  await expect(figures).toContainText("Forward mid");
  await expect(figures).toContainText(/Bid \$.* · Ask \$/);
  await expect(figures).toContainText(/YES \d+\.\d%/);

  const ladder = page.getByRole("region", { name: "Implied ladder" });
  await expect(ladder).toContainText("Implied probability");
  await expect(ladder.getByRole("table").getByRole("button")).toHaveCount(0);
  await expect(ladder.getByRole("table")).toContainText("Forward mid");
  await expect(page.getByText("Implied distribution")).toBeVisible();
  await expect(page.getByRole("region", { name: "Resolution" })).toContainText(
    "held to settlement or void",
  );
  await expectNoHorizontalOverflow(page);

  const ticket = await openTicket(page);
  await expect(ticket.getByRole("button", { name: "Long", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const quote = ticket.getByLabel("Dealer's two-way quote");
  await expect(quote).toContainText(/Bid\s*\$/);
  await expect(quote).toContainText(/Ask\s*\$/);
  await expect(ticket.getByText("Entry (ask)")).toBeVisible();
  await expect(ticket.getByText("Max gain")).toBeVisible();
  await expect(ticket.getByText("Max loss")).toBeVisible();
  await expect(ticket.getByText(/no early close/)).toBeVisible();

  await ticket.getByRole("button", { name: "Binary", exact: true }).click();
  await expect(ticket).toContainText("Will Anthropic publicly file an S-1 by 2026-12-31?");
  await expect(ticket.getByRole("button", { name: /^YES/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(ticket.getByRole("button", { name: /^NO/ })).toBeVisible();
});

test("a forward long fills at the ask and shows in the portfolio", async ({
  page,
  baseURL,
}, testInfo) => {
  const handle = uniqueHandle("fwd", testInfo);
  await signInDev(page, baseURL, handle);
  await page.goto("/m/modal");
  const ticket = await openTicket(page);
  await ticket.getByRole("button", { name: "$500", exact: true }).click();
  await expect(ticket.getByText("Entry (ask)")).toBeVisible();
  await expect(ticket.getByRole("button", { name: "Confirm long" })).toBeEnabled();
  await ticket.getByRole("button", { name: "Confirm long" }).click();
  await expect(ticket.getByRole("status").filter({ hasText: "Long filled" })).toBeVisible();
  await expect(ticket).toContainText("$500.00 notional");

  await page.goto("/portfolio");
  const forwards = page.getByRole("region", { name: "Forward positions" });
  await expect(forwards).toContainText("LONG · $500.00 notional");
  await expect(forwards).toContainText("Modal");
  await expect(forwards).toContainText("Held to settlement or void");
  await expect(page.getByLabel("Portfolio summary")).toContainText("$500.00");
  await expectNoHorizontalOverflow(page);
});

test("a binary YES buy fills by market id", async ({ page, baseURL }, testInfo) => {
  await signInDev(page, baseURL, uniqueHandle("bin", testInfo));
  await page.goto("/m/anduril");
  const ticket = await openTicket(page);
  await ticket.getByRole("button", { name: "Binary", exact: true }).click();
  await ticket.getByRole("button", { name: "$25", exact: true }).click();
  await ticket.getByRole("button", { name: "Preview buy" }).click();
  await expect(ticket.getByText("Max cost", { exact: true })).toBeVisible();
  await ticket.getByRole("button", { name: "Confirm buy" }).click();
  await expect(ticket.getByRole("status").filter({ hasText: "Trade completed" })).toBeVisible();
  await expect(ticket).toContainText("YES shares");
});

test("a moved forward price comes back as a requote and fills on confirmation", async ({
  page,
  baseURL,
}, testInfo) => {
  await signInDev(page, baseURL, uniqueHandle("moved", testInfo));
  await page.goto("/m/instinct");
  const ticket = await openTicket(page);
  await ticket.getByRole("button", { name: "$500", exact: true }).click();
  await expect(ticket.getByText("Entry (ask)")).toBeVisible();

  // The first send carries a stale bound below the live ask, as if the
  // dealer had moved between quote and order: the server refuses it.
  await page.route(
    "**/api/forward/trade",
    async (route) => {
      const body = route.request().postDataJSON() as { max_entry_ln: number };
      await route.continue({
        postData: JSON.stringify({ ...body, max_entry_ln: body.max_entry_ln - 0.25 }),
      });
    },
    { times: 1 },
  );
  await ticket.getByRole("button", { name: "Confirm long" }).click();
  await expect(ticket.getByRole("alert").filter({ hasText: "Price moved" })).toBeVisible();
  await expect(ticket.getByText("Requoted")).toBeVisible();
  await expect(ticket.getByText(/Confirming submits an entry of exactly/)).toBeVisible();

  await ticket.getByRole("button", { name: "Confirm new price" }).click();
  await expect(ticket.getByRole("status").filter({ hasText: "Long filled" })).toBeVisible();
});

test("the ticket's controls are reachable and operable from the keyboard", async ({ page }) => {
  test.skip(isMobile(page), "The desktop rail; the phone sheet is a dialog with its own trap.");
  await page.goto("/m/openai");
  const ticket = await openTicket(page);
  await ticket.getByRole("button", { name: "Forward", exact: true }).focus();

  const reached: string[] = [];
  for (let step = 0; step < 30; step += 1) {
    await page.keyboard.press("Tab");
    const label = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (active === null) return "";
      if (active instanceof HTMLInputElement)
        return `input:${active.closest("label")?.textContent ?? ""}`;
      return active.getAttribute("aria-label") ?? active.textContent?.trim() ?? "";
    });
    reached.push(label);
    if (label === "Confirm long") break;
  }
  expect(reached).toEqual(
    expect.arrayContaining(["Binary", "Long", "Short", "$500", "Confirm long"]),
  );
  expect(reached.some((label) => label.startsWith("input:") && label.includes("Notional"))).toBe(
    true,
  );

  await ticket.getByRole("button", { name: "Short", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(ticket.getByRole("button", { name: "Short", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(ticket.getByText("Entry (bid)")).toBeVisible();
  await expect(ticket.getByRole("button", { name: "Confirm short" })).toBeVisible();
});

test("home and a market page fit a phone width", async ({ page }) => {
  for (const path of ["/m", "/m/openai", "/m/instinct"]) {
    await page.goto(path);
    await expect(page.getByRole("main")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test("binary spend rejects exponent and fractional cents before requesting a quote", async ({
  page,
}) => {
  await page.goto("/m/anduril");
  const ticket = await openTicket(page);
  await ticket.getByRole("button", { name: "Binary", exact: true }).click();
  const spend = ticket.getByRole("spinbutton", { name: /Spend/ });
  for (const invalid of ["1e2", "10.555"]) {
    await spend.fill(invalid);
    await expect(ticket.getByRole("button", { name: "Preview buy" })).toBeDisabled();
  }
});
