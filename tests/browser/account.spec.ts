import { expect, test } from "@playwright/test";

import { createUser, isApiResponse, skipWithoutDatabase, uniqueNames } from "./helpers.js";

skipWithoutDatabase();

test("opening an account seeds the header identity without a reload", async ({
  page,
}, testInfo) => {
  const { username } = uniqueNames("acct-open", testInfo);
  await page.goto("/");

  const trigger = page.getByRole("button", { name: /Enter username/ });
  await trigger.click();
  await expect(page.getByRole("heading", { name: "Open your paper account" })).toBeVisible();

  const userResponsePromise = page.waitForResponse((response) =>
    isApiResponse(response, "POST", "/api/user"),
  );
  await page.getByLabel("Username").fill(username);
  await page.getByRole("button", { name: "Open account" }).click();
  expect((await userResponsePromise).status()).toBe(200);

  const account = page.getByRole("button", { name: new RegExp(username) });
  await expect(account).toBeVisible();
  await expect(account).toContainText("$100,000 cash");
  await expect(page.getByRole("heading", { name: "Open your paper account" })).toHaveCount(0);
});

test("escape closes the editor and returns focus to the trigger", async ({ page }, testInfo) => {
  const { username } = uniqueNames("acct-esc", testInfo);
  await page.goto("/");

  const trigger = page.getByRole("button", { name: /Enter username/ });
  await trigger.click();
  await page.getByLabel("Username").fill(username);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Open your paper account" })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("an existing account can be switched from the header", async ({ page, baseURL }, testInfo) => {
  const first = uniqueNames("acct-a", testInfo).username;
  const second = uniqueNames("acct-b", testInfo).username;
  await page.goto("/");
  await createUser(page, baseURL, first);
  await page.reload();

  const account = page.getByRole("button", { name: new RegExp(first) });
  await expect(account).toBeVisible();
  await account.click();
  await expect(page.getByRole("heading", { name: "Change account" })).toBeVisible();

  await page.getByLabel("Username").fill(second);
  await page.getByRole("button", { name: "Use account" }).click();
  await expect(page.getByRole("button", { name: new RegExp(second) })).toBeVisible();
});
