import { expect, test, type Page } from "@playwright/test";
import { createIdeaViaIntake, dutchDate, isoDate } from "./intake";

// Fase B6: pagina 1 van het rapport is het beslisblad. Een vers dossier zonder besluit en zonder bewijs toont
// "Nog niet beslisbaar" met de juiste ontbrekende punten; het volledige dossier volgt als bijlage. Daarnaast: één
// PDF-knop, delen vraagt een bevestiging die zegt dat het niet terug te draaien is, en geen "€ 0" als de
// marktomvang niet is vastgesteld.

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

// Een vers dossier via de intake (zoals in journey.spec.ts; fase B3 kan de intake korter maken).
async function createIdea(page: Page): Promise<string> {
  // Fase B3: de intake in drie vragen en één bevestiging (gedeelde helper, zoals journey.spec.ts).
  return createIdeaViaIntake(page, {
    idea: "Een AI-assistent die zakelijke eventmanagers helpt binnen minuten een passende locatie te vinden.",
    decision: `Lanceren we dit aanbod met twee consultants en € 25,000, of stoppen we, vóór ${dutchDate(60)}?`.replace(/,(?=\d{3})/g, "."),
    uncertainty: "Of de doelgroep hier echt voor wil betalen in plaats van het zelf te blijven doen.",
    fill: { "Korte naam": `TEST B6 beslisblad ${Date.now()}`, "Doelgroep": "zakelijke eventmanagers", "Inzet (euro)": "25000", "Uiterlijke beslisdatum": isoDate(60), "Wat meet je?": "betalende eventbureaus", "Doelwaarde": "10", "Minimumbedrag per klant": "1500" },
    select: { "Soort klant": "Zakelijke klanten (B2B)", "Regio": "Nederland", "Type project": "new_product", "Opdrachtgever": "none" },
  });
}

test("B6: beslisblad op pagina 1 met 'Nog niet beslisbaar' en de ontbrekende punten", async ({ page }) => {
  await login(page);
  const ideaUrl = await createIdea(page);

  await page.goto(`${ideaUrl}/report`);
  await page.getByRole("button", { name: "Maak het eerste rapport" }).click();
  const paper = page.locator(".report-paper");
  const sheet = paper.locator(".decision-sheet");
  await expect(sheet).toBeVisible();

  // Het besluit en waarom het nog niet beslisbaar is.
  await expect(sheet.getByRole("heading", { name: "Nog niet beslisbaar" })).toBeVisible();
  await expect(sheet).toContainText("Bewijsniveau:");
  await expect(sheet).toContainText("Er is nog geen besluit vastgelegd.");
  await expect(sheet).toContainText("Er is nog geen echt bewijs: geen geverifieerde bron en geen echte waarneming.");

  // Geen bewijsstukken om te tonen, wel hooguit drie open punten, met de beslissende vraag en een ontbrekende meting.
  await expect(sheet).toContainText("De 3 sterkste bewijsstukken");
  await expect(sheet).toContainText("Nog geen geverifieerde bron en geen echte waarneming.");
  await expect(sheet).toContainText("Wat níét bewezen is");
  const open = sheet.locator("ul li");
  expect(await open.count()).toBeLessThanOrEqual(3 + 2); // drie open punten plus de twee redenen bij het besluit
  await expect(sheet).toContainText(/De beslissende vraag (is nog niet beantwoord|heeft nog geen geverifieerde bron)|Er is geen beslissende onderzoeksvraag vastgelegd/);
  await expect(sheet).toContainText("Nog geen afgeronde test met een uitslag");

  // De volgende stap heeft een datum (of zegt eerlijk dat die er niet is).
  await expect(sheet).toContainText("Volgende stap:");
  await expect(sheet).toContainText(/Datum: (\d{1,2} \w+ \d{4} \(|Nog geen datum vastgelegd)/);

  // Het volledige dossier volgt als bijlage, in de bestaande opbouw, ná het beslisblad.
  await expect(paper).toContainText("Bijlage · Volledig dossier");
  const order = await paper.evaluate((el) => {
    const t = el.textContent ?? "";
    return [t.indexOf("Nog niet beslisbaar"), t.indexOf("01 / Managementsamenvatting"), t.indexOf("09 / Besluit en volgende stap")];
  });
  expect(order[0]).toBeGreaterThan(-1);
  expect(order[0]).toBeLessThan(order[1]);
  expect(order[1]).toBeLessThan(order[2]);

  // Geen "€ 0 bereikbare jaaromzet" zonder vastgestelde marktomvang.
  await expect(paper).not.toContainText(/Bereikbare jaaromzet \(realistisch\)\s*€\s*0\b/);

  // Eén PDF-knop.
  await expect(page.getByRole("link", { name: /PDF/ })).toHaveCount(1);

  // Delen vraagt een bevestiging die zegt dat het niet terug te draaien is; annuleren deelt niets.
  await page.getByRole("button", { name: /Deel versie 1 met opdrachtgever/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Dit kan niet worden teruggedraaid.");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Niet gedeeld", { exact: true })).toBeVisible();

  // Bij printen staat het beslisblad op een eigen pagina; navigatie en coach zijn verborgen.
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(sheet).toHaveCSS("break-after", "page");
});
