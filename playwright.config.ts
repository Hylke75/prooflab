import { defineConfig, devices } from "@playwright/test";

// End-to-end journey against a running app connected to a Supabase project with the
// migrations applied. Needs E2E_EMAIL / E2E_PASSWORD of a confirmed test user.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure", locale: "nl-NL" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, grepInvert: /@mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npm run start -- -p 3000", url: "http://localhost:3000/login", reuseExistingServer: true, timeout: 120_000 },
});
