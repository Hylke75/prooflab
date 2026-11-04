import { expect, test, type Page } from "@playwright/test";
import { answerIntake, cardField, dutchDate, isoDate } from "./intake";

// Fase B3: de intake van het testdossier in drie schermen en één bevestiging, zonder gegevens dubbel in te vullen.
// Het voorstel komt van de AI of (zonder sleutel) uit de regels; wat letterlijk in de tekst staat (inzet, datum,
// prijs) staat in beide gevallen op de kaart.

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

const MAKELAARS = {
  idea: "Een AI-assistent voor zelfstandige NVM-kantoren met 2–15 medewerkers die woningteksten en klantmails schrijft, voor € 249 per maand.",
  decision: `Bouwen we de assistent voor € 40.000, ja of nee, vóór ${dutchDate(90)}?`,
  uncertainty: "Willen ze € 249 per maand betalen? Ze gebruiken nu vaak gratis ChatGPT of hun eigen standaardteksten.",
};

test("B3: testdossier makelaars in 3 vragen en 1 bevestiging", async ({ page }) => {
  await login(page);
  await page.goto("/app/ideas/new");

  // Vraag 1: het idee en voor wie, in één tekstvak; zonder tekst geen volgende stap.
  await expect(page.getByText("Vraag 1 / 3")).toBeVisible();
  await page.getByRole("button", { name: "Volgende stap" }).click();
  await expect(page.getByText("Beschrijf het idee en voor wie het is in minimaal één zin.")).toBeVisible();

  await answerIntake(page, MAKELAARS);
  const card = page.locator("form.intake-summary");
  await expect(card.getByText("Voorstel · nog niet opgeslagen")).toBeVisible();

  // Wat in de tekst staat, staat op de kaart; de consultant hoeft het niet opnieuw te typen.
  await expect(cardField(page, "Inzet (euro)")).toHaveValue("40000");
  await expect(cardField(page, "Uiterlijke beslisdatum")).toHaveValue(isoDate(90));
  await expect(cardField(page, "Prijs van het aanbod")).toHaveValue("€ 249 per maand");
  await expect(cardField(page, "Doelgroep")).toHaveValue(/NVM/);
  await expect(cardField(page, "Regio")).toHaveValue("Nederland");
  // De drie antwoorden staan erbij, aan te passen, maar niet als tweede invulveld.
  await expect(card.getByText(MAKELAARS.uncertainty)).toBeVisible();
  // Opdrachtgever: standaard geen (eigen idee).
  await expect(cardField(page, "Opdrachtgever")).toHaveValue("none");
  await expect(cardField(page, "Naam nieuwe opdrachtgever")).toHaveCount(0);

  // Aanpassen gaat terug naar de vraag; de antwoorden blijven staan en het voorstel blijft gelijk.
  await card.getByRole("button", { name: "Je grootste onzekerheid aanpassen" }).click();
  await expect(page.getByLabel("Mijn grootste onzekerheid", { exact: true })).toHaveValue(MAKELAARS.uncertainty);
  await page.getByRole("button", { name: "Maak het voorstel" }).click();
  await expect(page.getByRole("heading", { name: "Klopt dit?" })).toBeVisible();

  // Fout per veld: zonder naam geen dossier.
  await cardField(page, "Korte naam").fill("");
  await page.getByRole("button", { name: "Klopt, start de marktverkenning" }).click();
  await expect(card.locator("#s-title-err")).toContainText("Geef het idee een korte naam.");
  await expect(page).toHaveURL(/\/ideas\/new/);

  // Een nieuwe opdrachtgever alleen na een expliciete keuze, en dan met naam.
  await cardField(page, "Opdrachtgever").selectOption("new");
  await expect(cardField(page, "Naam nieuwe opdrachtgever")).toBeVisible();
  await cardField(page, "Opdrachtgever").selectOption("none");

  // Velden die de AI of de regels niet konden invullen, vult de test (net als de consultant) in.
  await cardField(page, "Korte naam").fill(`TEST - AI-assistent makelaars ${Date.now()}`);
  for (const [label, value] of [["Wat meet je?", "betalende NVM-kantoren"], ["Doelwaarde", "14"], ["Minimumbedrag per klant (€)", "249"]] as const) {
    if (!(await cardField(page, label).inputValue())) await cardField(page, label).fill(value);
  }
  for (const [label, value] of [["Soort klant", "Zakelijke klanten (B2B)"], ["Type project", "new_product"]] as const) {
    if (!(await cardField(page, label).inputValue())) await cardField(page, label).selectOption(value);
  }
  await page.getByRole("button", { name: "Klopt, start de marktverkenning" }).click();
  await page.waitForURL(/\/research/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Begrijp je markt." })).toBeVisible();
  // B2: de beslissende onderzoeksvraag gaat over de prijs uit de intake.
  await expect(page.getByText(/€ 249 per maand/).first()).toBeVisible();
});
