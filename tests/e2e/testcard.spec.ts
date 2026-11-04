import { expect, test, type Page } from "@playwright/test";
import { createIdeaViaIntake, dutchDate, isoDate } from "./intake";

// Fase B1: de Test Card van een prijs-/aanbodtest. Opslaan geeft altijd een zichtbaar resultaat of een duidelijke
// fout, en de drempels liggen vast vóórdat ProofLab het aantal deelnemers uitrekent.

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

// Het makelaarsdossier uit de opdracht, via de intake van fase B3 (drie vragen en één bevestiging).
async function createIdea(page: Page): Promise<string> {
  return createIdeaViaIntake(page, {
    idea: "Een AI-assistent voor zelfstandige NVM-kantoren met 2–15 medewerkers die woningteksten en klantmails schrijft, voor € 249 per maand.",
    decision: `Lanceren we de assistent met € 40.000, ja of nee, vóór ${dutchDate(60)}?`,
    uncertainty: "Willen ze € 249 per maand betalen?",
    fill: { "Korte naam": `TEST B1 makelaars ${Date.now()}`, "Inzet (euro)": "40000", "Uiterlijke beslisdatum": isoDate(60), "Wat meet je?": "betalende makelaarskantoren", "Doelwaarde": "20", "Minimumbedrag per klant (€)": "249" },
    select: { "Type project": "new_product", "Opdrachtgever": "none" },
  });
}

test("B1: Test Card van een prijstest opslaan, met drempels vóór het rekenwerk", async ({ page }) => {
  await login(page);
  const ideaUrl = await createIdea(page);

  // B1c: zonder één waarneming of geverifieerde bron telt geen enkele stap als "met bewijs".
  await page.goto(ideaUrl);
  await expect(page.getByText("0 van 4 met bewijs")).toBeVisible();

  await page.goto(`${ideaUrl}/assumptions`);
  await page.getByRole("button", { name: /Begin met de standaardset|Stel aannames voor/ }).click();
  await expect(page.getByRole("heading", { name: "Risicokaart" })).toBeVisible();

  await page.goto(`${ideaUrl}/experiments`);
  await page.getByRole("radio", { name: /Prijs-\/aanbodtest/ }).click();
  const card = page.getByRole("form", { name: "Test Card" });

  // B1b: er is geen veld meer voor een eigen verwachting; zonder vastgelegde drempels wordt niets uitgerekend.
  await expect(card.getByLabel("Verwachte uitkomst (%)", { exact: true })).toHaveCount(0);
  await expect(card.getByText("Leg eerst de drempels vast. Daarna rekent ProofLab uit hoeveel deelnemers je nodig hebt.")).toBeVisible();

  // B1a: één opslagknop; leeg opslaan stuurt geen verzoek maar toont meldingen bij de velden en een samenvatting.
  const save = card.getByRole("button", { name: "Test Card opslaan als concept" });
  await expect(save).toHaveCount(1);
  await expect(save).toBeEnabled();
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST") posts++;
  });
  await card.getByLabel("Wij denken dat… (verplicht)", { exact: true }).fill("Zelfstandige NVM-makelaars kiezen op de testpagina een abonnement van € 249 per maand.");
  await save.click();
  await expect(card.getByText(/Nog niet opgeslagen: \d+ punten moeten nog worden aangevuld/)).toBeVisible();
  for (const label of ["Drempels vastleggen", "Wervingsgroep", "Kop", "Prijspunten"]) {
    await expect(card.locator(".tc-save").getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  await expect(card.locator("#err-headline")).toContainText("Schrijf een kop");
  await expect(card.locator("#err-recruitment_group")).toBeVisible();
  expect(posts).toBe(0);
  expect(page.url()).toContain("/experiments");

  // B1b, stap 1: drempels vastleggen. Daarna zijn ze alleen-lezen en volgt één getal.
  await card.getByRole("button", { name: "Leg drempels vast" }).click();
  await expect(card.getByLabel("Het klopt als ≥ (%) (verplicht)", { exact: true })).toHaveAttribute("readonly", "");
  await expect(card.getByText(/Je hebt ongeveer \d+ deelnemers nodig\./)).toBeVisible();
  await expect(card.getByText(/drempel (aan|verlagen)/i)).toHaveCount(0);
  await card.getByText("Hoe is dit berekend?").click();
  await expect(card.getByRole("cell", { name: "Voorzichtig" })).toBeVisible();

  // Wijzigen kan alleen met een motivering.
  await card.getByRole("button", { name: "Drempels wijzigen (met motivering)" }).click();
  await card.getByLabel("Het klopt als ≥ (%) (verplicht)", { exact: true }).fill("10");
  await card.getByRole("button", { name: "Leg de drempels opnieuw vast" }).click();
  await expect(card.getByText(/Leg in een zin uit waarom je de drempels wijzigt/)).toBeVisible();
  await card.getByLabel("Waarom wijzig je de drempels?", { exact: true }).fill("De opdrachtgever legde vooraf een hogere minimale conversie vast.");
  await card.getByRole("button", { name: "Leg de drempels opnieuw vast" }).click();
  await expect(card.getByText(/Drempels vastgelegd \(gewijzigd, met motivering\)/)).toBeVisible();

  // De rest aanvullen en opslaan: bevestiging en het concept op het bord, ook na herladen.
  await card.getByRole("radio", { name: "Koud", exact: true }).check();
  await card.getByLabel("Kop (verplicht)", { exact: true }).fill("Je woningteksten en klantmails in minuten klaar.");
  await card.getByLabel("Prijspunt 1: naam (verplicht)", { exact: true }).fill("Kantoor");
  await card.getByLabel("Bedrag (€) en periode", { exact: true }).first().fill("249");
  await save.click();
  await page.waitForURL(/\/experiments\?opgeslagen=[0-9a-f-]{36}/);
  await expect(page.getByText("Test Card opgeslagen als concept.")).toBeVisible();
  const board = page.locator("#bord");
  await expect(board.locator(".assumption-item.just-saved")).toContainText("Prijs");
  await page.reload();
  await expect(board.locator(".assumption-item", { hasText: "Prijs" })).toHaveCount(1);
  await page.getByRole("link", { name: "Open het concept →" }).click();
  await expect(page.getByText(/ongeveer \d+ deelnemers nodig/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Ter review aanbieden" })).toBeVisible();
});
