import { expect, test, type Page } from "@playwright/test";
import { createIdeaViaIntake, dutchDate, isoDate } from "./intake";

// Uitlegtooltips bij vaktermen (components/ui/Term.tsx) en zoeken binnen een dossier (components/search/DossierSearch.tsx).
// Draai dit tegen een lokale of test-Supabase, niet tegen de live omgeving.

const email = process.env.E2E_EMAIL ?? "";
const password = process.env.E2E_PASSWORD ?? "";
test.skip(!email || !password, "E2E_EMAIL en E2E_PASSWORD zijn niet gezet");

async function login(page: Page) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
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

// Zelfde intake als tests/e2e/testcard.spec.ts.
async function createIdea(page: Page): Promise<string> {
  // Fase B3: de intake in drie vragen en één bevestiging (gedeelde helper, zoals journey.spec.ts).
  return createIdeaViaIntake(page, {
    idea: "Een AI-assistent voor zelfstandige NVM-makelaars die woningteksten en klantmails schrijft, voor € 249 per maand.",
    decision: `Lanceren we dit aanbod met twee consultants en € 40,000, of stoppen we, vóór ${dutchDate(60)}?`.replace(/,(?=\d{3})/g, "."),
    uncertainty: "Of de doelgroep hier echt voor wil betalen in plaats van het zelf te blijven doen.",
    fill: { "Korte naam": `TEST zoeken ${Date.now()}`, "Doelgroep": "zelfstandige NVM-makelaars", "Inzet (euro)": "40000", "Uiterlijke beslisdatum": isoDate(60), "Wat meet je?": "betalende makelaarskantoren", "Doelwaarde": "20", "Minimumbedrag per klant": "249" },
    select: { "Soort klant": "Zakelijke klanten (B2B)", "Regio": "Nederland", "Type project": "new_product", "Opdrachtgever": "none" },
  });
}

const UNIQUE = `Zoekproef${Date.now().toString(36)}`;

test("Tooltips bij vaktermen: hover, toetsenbord, Escape; labels blijven gelijk", async ({ page }) => {
  await login(page);
  const ideaUrl = await createIdea(page);
  await page.goto(`${ideaUrl}/assumptions`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Begin met de standaardset|Stel aannames voor/ }).click();
  await expect(page.getByRole("heading", { name: "Risicokaart" })).toBeVisible();

  // Risicokaart: hover opent, de muis weg sluit.
  const critical = page.getByRole("button", { name: "kritieke aanname", exact: true });
  await critical.hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("belangrijkheid 4 of 5");
  await page.mouse.move(0, 0);
  await expect(tip).toHaveCount(0);

  // Test Card: toetsenbord (focus) opent, Escape sluit; het label van het veld verandert niet.
  await page.goto(`${ideaUrl}/experiments`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("radio", { name: /Prijs-\/aanbodtest/ }).click();
  const card = page.getByRole("form", { name: "Test Card" });
  await expect(card.getByLabel("Het klopt als ≥ (%) (verplicht)", { exact: true })).toBeVisible();
  const recruit = card.getByRole("button", { name: "Wervingsgroep", exact: true });
  await recruit.focus();
  await expect(page.getByRole("tooltip")).toContainText("eigen netwerk, warm contact, koud");
  await expect(recruit).toHaveAttribute("aria-describedby", /.+/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  // Escape sloot alleen de tooltip: de pagina staat nog op de Test Card.
  expect(page.url()).toContain("/experiments");

  // Een klik op de term in een label zet de cursor niet in het veld (geen labelactivatie).
  await card.getByRole("button", { name: "Het klopt als ≥ (%)", exact: true }).click();
  await expect(page.getByRole("tooltip")).toContainText("Succesdrempel");
  await expect(card.getByLabel("Het klopt als ≥ (%) (verplicht)", { exact: true })).not.toBeFocused();
});

test("Zoeken binnen een dossier: sneltoets, markering, pijltjes en Enter, lege staat, veilige tekens", async ({ page }) => {
  await login(page);
  const ideaUrl = await createIdea(page);
  await page.goto(`${ideaUrl}/assumptions`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Begin met de standaardset|Stel aannames voor/ }).click();
  await expect(page.getByRole("heading", { name: "Risicokaart" })).toBeVisible();
  // Een eigen aanname met een unieke zoekterm.
  await page.getByLabel("Wat moet waar zijn?", { exact: true }).fill(`${UNIQUE}: makelaars betalen vooraf voor de eerste maand.`);
  await page.getByRole("button", { name: "Toevoegen", exact: true }).click();
  await expect(page.getByRole("button", { name: new RegExp(UNIQUE) }).first()).toBeVisible();

  // Sneltoets "/" opent het venster vanaf een andere pagina; de focus staat in het zoekveld.
  await page.goto(ideaUrl);
  await page.waitForLoadState("networkidle");
  await page.locator("body").press("/");
  const dialog = page.getByRole("dialog", { name: "Zoeken in dit dossier" });
  await expect(dialog).toBeVisible();
  const box = dialog.getByRole("combobox", { name: "Zoekterm" });
  await expect(box).toBeFocused();

  // Te kort, dan geen resultaten maar een hint.
  await box.fill("z");
  await expect(dialog.getByRole("status")).toContainText("Typ minstens 2 tekens");

  // Treffer, gegroepeerd en gemarkeerd.
  await box.fill(UNIQUE.toLowerCase());
  const option = dialog.getByRole("option").first();
  await expect(option).toContainText(UNIQUE);
  await expect(dialog.getByText(/^Aannames · 1$/)).toBeVisible();
  await expect(option.locator("mark")).toHaveText(UNIQUE);
  await expect(option).toHaveAttribute("aria-selected", "true");

  // Enter opent de aanname, geselecteerd op de risicokaart.
  await box.press("ArrowDown");
  await box.press("ArrowUp");
  await box.press("Enter");
  await page.waitForURL(/\/assumptions\?select=[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { level: 3, name: new RegExp(UNIQUE) })).toBeVisible();

  // Lege staat en tekens die in een PostgREST-filter iets zouden betekenen: geen fout, geen resultaten.
  await page.locator("body").press("/");
  await box.fill("zzq),or(id.neq.0");
  await expect(dialog.getByRole("status")).toContainText("Geen resultaten");
  await box.fill("100%_*");
  await expect(dialog.getByRole("status")).toContainText(/Geen resultaten|resultaat/);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("@mobile tooltips werken met tikken en zoeken past op een smal scherm", async ({ page }) => {
  await login(page);
  const ideaUrl = await createIdea(page);
  await page.goto(`${ideaUrl}/assumptions`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Begin met de standaardset|Stel aannames voor/ }).click();
  const critical = page.getByRole("button", { name: "kritieke aanname", exact: true });
  await critical.tap();
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  const box = await tip.boundingBox();
  const vw = page.viewportSize()!.width;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vw);
  await critical.tap();
  await expect(tip).toHaveCount(0);

  await page.getByRole("button", { name: /Zoeken in dossier/ }).tap();
  const dialog = page.getByRole("dialog", { name: "Zoeken in dit dossier" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox", { name: "Zoekterm" }).fill("makelaar");
  await expect(dialog.getByRole("status")).toContainText(/resultaat|Geen resultaten/);
  await dialog.getByRole("button", { name: "Zoeken sluiten" }).tap();
  await expect(dialog).toBeHidden();
  // Geen horizontaal scrollen door de tooltip of het venster.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
