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

// Nonce-based Content-Security-Policy (proxy.ts): the header is present and nothing on the page is blocked.
for (const path of ["/login", "/t/00000000000000", "/s/onbekende-enquete"]) {
  test(`CSP zonder schendingen op ${path}`, async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy|Refused to (load|execute|apply|connect)/i.test(m.text())) violations.push(m.text());
    });
    page.on("pageerror", (e) => violations.push(e.message));
    const res = await page.goto(path);
    const csp = res?.headers()["content-security-policy"] ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    await page.waitForLoadState("networkidle");
    // Next.js puts the nonce on every script it renders; a blocked script would show up as a violation above.
    expect(await page.locator("script").count()).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
}
