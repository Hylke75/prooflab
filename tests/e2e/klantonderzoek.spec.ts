import { expect, test, type Page } from "@playwright/test";

// Markt: klantonderzoek vanuit stap 1. Op het tabblad Klantonderzoek maak je een verkennende enquête en een online
// interview (schriftelijk) bij een onderzoeksvraag, zonder Test Card. Daarna opent de editor; het onderzoek is
// zichtbaar als verkennend en staat in de lijst. Op 390px breed hoeft niet horizontaal gescrold te worden.
// Vraagt de migratie 20261111090000_markt_klantonderzoek; zonder die migratie toont het tabblad een melding en
// wordt het aanmaken overgeslagen.

const email = process.env.E2E_EMAIL ?? "";
const password = process.env.E2E_PASSWORD ?? "";
test.skip(!email || !password, "E2E_EMAIL en E2E_PASSWORD zijn niet gezet");

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mailadres", { exact: true }).fill(email);
  await page.getByLabel("Wachtwoord", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Inloggen", exact: true }).click();
  await page.waitForURL(/\/app/);
  const ws = page.getByLabel("Naam van je bureau of team", { exact: true });
  const hero = page.getByRole("heading", { name: /Van goed idee naar/ });
  await expect(ws.or(hero)).toBeVisible();
  if (await ws.isVisible()) {
    await ws.fill("E2E Bureau");
    await page.getByRole("button", { name: "Werkruimte aanmaken" }).click();
    await expect(hero).toBeVisible();
  }
}

// Hetzelfde dossier als tests/e2e/b4-aannames.spec.ts.
async function createIdea(page: Page): Promise<string> {
  await page.goto("/app/ideas/new");
  await page.getByRole("button", { name: "Lanceren we dit aanbod in het eerste kwartaal met twee consultants, of stoppen we?" }).click();
  await page.getByLabel("Hoeveel (euro)", { exact: true }).fill("40000");
  await page.getByLabel("Uiterlijke beslisdatum", { exact: true }).fill(new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Volgende stap" }).click();
  await page.getByLabel("Geslaagd als…", { exact: true }).fill("Zes maanden na de lancering betalen minstens 20 makelaarskantoren € 249 per maand.");
  await page.getByLabel("Wat meet je?", { exact: true }).fill("betalende makelaarskantoren");
  await page.getByLabel("Doelwaarde", { exact: true }).fill("20");
  await page.getByLabel("Omzetdoel (€)", { exact: true }).fill("59760");
  await page.getByRole("button", { name: "Volgende stap" }).click();
  await page.getByLabel("Korte naam", { exact: true }).fill(`TEST klantonderzoek ${Date.now()}`);
  await page.getByLabel("Mijn idee", { exact: true }).fill("Een AI-assistent voor zelfstandige NVM-makelaars die woningteksten en klantmails schrijft, voor € 249 per maand.");
  await page.getByRole("button", { name: "Volgende stap" }).click();
  await page.getByRole("button", { name: "Zakelijke klanten (B2B)" }).click();
  await page.getByRole("button", { name: "Volgende stap" }).click();
  await page.getByRole("button", { name: /Nederland/ }).click();
  await page.getByRole("button", { name: "Volgende stap" }).click();
  await page.getByRole("button", { name: "Nieuw product" }).click();
  await page.getByLabel("Opdrachtgever", { exact: true }).selectOption("none");
  await page.getByRole("button", { name: "Start de marktverkenning" }).click();
  await page.waitForURL(/\/research/);
  return page.url().replace(/\/research.*$/, "");
}

async function newStudy(page: Page, ideaUrl: string, open: string, title: string, template: boolean) {
  await page.goto(`${ideaUrl}/research?tab=klantonderzoek`);
  await page.getByRole("button", { name: open }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Maak concept en open de editor" }) });
  await form.getByLabel(/Bij welke onderzoeksvraag hoort dit\?/).selectOption({ index: 1 });
  await form.getByLabel(/^Titel/).fill(title);
  await form.getByLabel(/^Wat wil je leren\?/).fill("Begrijpen hoe makelaars nu hun woningteksten schrijven en wat dat kost.");
  if (template) await form.getByLabel(/Begin met het sjabloon/).check();
  await form.getByRole("button", { name: "Maak concept en open de editor" }).click();
  await page.waitForURL(/\/experiments\/[0-9a-f-]{36}/);
}

test("Markt: verkennende enquête en online interview vanuit het tabblad Klantonderzoek", async ({ page }) => {
  await login(page);
  const ideaUrl = await createIdea(page);
  await page.goto(`${ideaUrl}/research?tab=klantonderzoek`);
  await expect(page.getByRole("tab", { name: "Klantonderzoek" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Vraag het je doelgroep zelf." })).toBeVisible();
  test.skip(await page.getByText(/vraagt een database-update/).isVisible(), "Migratie 20261111090000_markt_klantonderzoek is nog niet toegepast");

  // Verkennende enquête met het sjabloon: geen Test Card, wel de editor.
  await newStudy(page, ideaUrl, "Nieuwe enquête", "Hoe schrijven makelaars woningteksten?", true);
  await expect(page.getByText("Verkennend", { exact: true })).toBeVisible();
  await expect(page.getByText("Geen: verkennend onderzoek beslist niets")).toBeVisible();
  await expect(page.getByRole("button", { name: "Vragen opslaan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Analyseer en maak de Learning Card" })).toHaveCount(0);

  // Online interview: toestemming bovenaan, alleen open vragen.
  await newStudy(page, ideaUrl, "Nieuw online interview", "Interview: de laatste woningtekst", false);
  await expect(page.getByText("Online interview (schriftelijk)").first()).toBeVisible();
  await expect(page.getByLabel("Vraagtekst").first()).toHaveValue("Doet u mee aan dit schriftelijke interview?");

  // Beide staan in de lijst, als verkennend, en een tweede enquête kan ook.
  await page.goto(`${ideaUrl}/research?tab=klantonderzoek`);
  await expect(page.getByRole("link", { name: /Hoe schrijven makelaars woningteksten\?/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Interview: de laatste woningtekst/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Live interview vastleggen/ })).toBeVisible();

  // Mobiel: geen horizontaal scrollen.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
