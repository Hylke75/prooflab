import { expect, test } from "@playwright/test";

test("loginpagina is bereikbaar en toegankelijk opgebouwd", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Van goed idee naar sterk bewijs." })).toBeVisible();
  await expect(page.getByLabel("E-mailadres")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
});

test("app vraagt om in te loggen", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);
});

test("onbekende testpagina geeft 404 zonder te lekken", async ({ page }) => {
  const res = await page.goto("/t/00000000000000");
  expect(res?.status()).toBe(404);
});
