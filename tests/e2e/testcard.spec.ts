import { expect, test, type Page } from "@playwright/test";
import { createIdeaViaIntake, dutchDate, isoDate } from "./intake";

// Fase B1: de Test Card van een prijs-/aanbodtest. Opslaan geeft altijd een zichtbaar resultaat of een duidelijke
// fout, en de drempels liggen vast vóórdat ProofLab het aantal deelnemers uitrekent.
// Fase B5: vijf zichtbare velden, de rest vooringevuld onder Details (ook de prijs uit de intake), een statusbalk
// Concept → Klaar voor goedkeuring → Loopt, en een hoofdtest start pas met een vastgelegde go-regel.

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
  // Het overzicht van een werkruimte met veel testdossiers laadt soms langzaam.
  await expect(ws.or(hero)).toBeVisible({ timeout: 30_000 });
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
    fill: { "Korte naam": `TEST B1 makelaars ${Date.now()}`, "Inzet (euro)": "40000", "Uiterlijke beslisdatum": isoDate(60), "Wat meet je?": "betalende makelaarskantoren", "Doelwaarde": "20", "Minimumbedrag per klant": "249" },
    select: { "Type project": "new_product", "Opdrachtgever": "none" },
  });
}

test("B1/B5: korte Test Card van een prijstest opslaan, goedkeuren en met go-regel starten", async ({ page }) => {
  await login(page);
  const ideaUrl = await createIdea(page);

  // B1c: zonder één waarneming of geverifieerde bron telt geen enkele stap als "met bewijs".
  await page.goto(ideaUrl);
  await expect(page.getByText("0 van 4 met bewijs")).toBeVisible();

  await page.goto(`${ideaUrl}/assumptions`);
  await page.getByRole("button", { name: /Begin met de standaardset|Stel aannames voor/ }).click();
  await expect(page.getByRole("heading", { name: "Risicokaart" })).toBeVisible();

  await page.goto(`${ideaUrl}/experiments`);
  // Een prijsaanname, zodat de prijstest ook kan worden goedgekeurd (B0 punt 3).
  const statements = await page.locator("#as-select option").allTextContents();
  const price = statements.find((s) => /prijs|betalen/i.test(s));
  expect(price, "een prijsaanname").toBeTruthy();
  await page.getByLabel("Aanname die je toetst", { exact: true }).selectOption({ label: price! });
  await page.getByRole("radio", { name: /Prijs-\/aanbodtest/ }).click();
  const card = page.getByRole("form", { name: "Test Card" });

  // B1b: er is geen veld meer voor een eigen verwachting; zonder vastgelegde drempels wordt niets uitgerekend.
  await expect(card.getByLabel("Verwachte uitkomst (%)", { exact: true })).toHaveCount(0);
  await expect(card.getByText("Leg eerst de drempels vast. Daarna rekent ProofLab uit hoeveel deelnemers je nodig hebt.")).toBeVisible();

  // B5: bovenaan de status; zichtbaar zijn alleen wat, bij wie, de drempels, het aantal deelnemers en de deadline.
  const status = card.locator(".tc-status");
  await expect(status).toContainText("Concept");
  await expect(status).toContainText("Klaar voor goedkeuring");
  await expect(status).toContainText("Loopt");
  await expect(status.locator("li[aria-current=step]")).toContainText("Concept");
  // Gebruikerstest C4/C5: de naam staat zichtbaar bovenaan; de hypothese heet "Wij denken dat …".
  for (const label of ["Naam van het experiment (verplicht)", "Wij denken dat … (verplicht)", "Bij wie? (verplicht)", "Het klopt als ≥ (%) (verplicht)", "Het klopt niet als < (%) (verplicht)", "Minimale steekproef (verplicht)", "Deadline (verplicht)"]) {
    await expect(card.getByLabel(label, { exact: true })).toBeVisible();
  }
  // Naam plus vijf velden, zeven invoervakjes (succes- en faaldrempel); de rest zit dicht onder Details.
  await expect(card.locator("input:visible:not([type=hidden]):not([type=radio]), textarea:visible, select:visible")).toHaveCount(7);
  await expect(card.getByLabel("Kop (verplicht)", { exact: true })).toBeHidden();
  // De deadline is een datum; de looptijd in dagen gaat mee als verborgen veld.
  await expect(card.getByLabel("Deadline (verplicht)", { exact: true })).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);

  // Onder Details staat alles vooringevuld, ook de prijs uit de intake (€ 249 per maand).
  await card.locator("#tc-details").click();
  await expect(card.getByLabel("Prijspunt 1: naam (verplicht)", { exact: true })).toHaveValue("Basis");
  await expect(card.getByLabel("Bedrag (€) en periode", { exact: true }).first()).toHaveValue("249");
  await expect(card.getByLabel("Periode prijspunt 1", { exact: true })).toHaveValue("per maand");
  await expect(card.getByText("Prijs uit de intake overgenomen: € 249 per maand.")).toBeVisible();
  await expect(card.getByLabel("Kop (verplicht)", { exact: true })).not.toHaveValue("");
  await expect(card.getByRole("radio", { name: "Eigen netwerk", exact: true })).toBeChecked();
  await card.locator("#tc-details").click();
  await expect(card.getByLabel("Kop (verplicht)", { exact: true })).toBeHidden();

  // B1a: één opslagknop; opslaan zonder vastgelegde drempels stuurt geen verzoek maar toont de melding.
  const save = card.getByRole("button", { name: "Test Card opslaan als concept" });
  await expect(save).toHaveCount(1);
  await expect(save).toBeEnabled();
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST") posts++;
  });
  await card.getByLabel("Wij denken dat … (verplicht)", { exact: true }).fill("Zelfstandige NVM-makelaars kiezen op de testpagina een abonnement van € 249 per maand.");
  await save.click();
  await expect(card.getByText("Nog niet opgeslagen: 1 punt moet nog worden aangevuld.")).toBeVisible();
  await expect(card.locator(".tc-save").getByRole("button", { name: "Drempels vastleggen", exact: true })).toBeVisible();
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

  // B5: een verplicht detailveld dat ontbreekt, opent Details vanzelf; de fout staat zichtbaar bij het veld.
  await card.locator("#tc-details").click();
  await card.getByLabel("Kop (verplicht)", { exact: true }).fill("");
  await card.locator("#tc-details").click();
  await expect(card.locator("details.tc-details")).not.toHaveAttribute("open", "");
  await save.click();
  await expect(card.locator("details.tc-details")).toHaveAttribute("open", "");
  await expect(card.locator("#err-headline")).toBeVisible();
  await expect(card.locator("#err-headline")).toContainText("Schrijf een kop");
  await expect(card.getByLabel("Kop (verplicht)", { exact: true })).toBeFocused();
  expect(posts).toBe(0);

  // Aanvullen en opslaan: bevestiging en het concept op het bord, ook na herladen.
  await card.getByLabel("Kop (verplicht)", { exact: true }).fill("Je woningteksten en klantmails in minuten klaar.");
  await save.click();
  await page.waitForURL(/\/experiments\?opgeslagen=[0-9a-f-]{36}/);
  await expect(page.getByText("Test Card opgeslagen als concept.")).toBeVisible();
  const board = page.locator("#bord");
  await expect(board.locator(".assumption-item.just-saved")).toContainText("Prijs");
  // B5: bij de eerste Test Card stelt ProofLab de go-regel van het dossier voor.
  await expect(page.locator("#go-regel")).toContainText(/Doorgaan als de hoofdtest ".+" slaagt en de aanname ".+" minstens 70% kans haalt\./);
  await page.reload();
  await expect(board.locator(".assumption-item", { hasText: "Prijs" })).toHaveCount(1);
  await page.getByRole("link", { name: "Open het concept →" }).click();
  await page.waitForURL(/\/experiments\/[0-9a-f-]{36}/);
  await expect(page.getByText(/ongeveer \d+ deelnemers nodig/)).toBeVisible();
  // De prijs uit de intake staat op de testpagina en de deadline op de Test Card.
  await expect(page.getByText(/Deadline/).first()).toBeVisible();

  // B5: de statusbalk volgt de Test Card: Concept → Klaar voor goedkeuring → (goedgekeurd) → Loopt.
  const steps = page.locator(".tc-status li[aria-current=step]");
  await expect(steps).toContainText("Concept");
  await page.getByRole("button", { name: "Ter review aanbieden" }).click();
  await expect(steps).toContainText("Klaar voor goedkeuring");
  // Gebruikerstest B4: wie zijn eigen test goedkeurt, vinkt ook de bevestiging bij de melding aan.
  for (const box of await page.locator("input[type=checkbox][name^=check_], input[type=checkbox][name=confirm_self_approval]").all()) await box.check();
  await page.getByRole("button", { name: "Akkoord: keur goed en vergrendel" }).click();

  // B5: zonder vastgelegde go-regel start een hoofdtest niet; de reden staat bij de knop.
  const start = page.getByRole("button", { name: "Publiceer en start de meting" });
  await expect(start).toBeVisible({ timeout: 20_000 });
  await expect(start).toBeDisabled();
  await expect(page.locator("#go-rule-block")).toContainText("Leg eerst de go-regel van het dossier vast.");
  await page.getByRole("button", { name: "Leg deze go-regel vast" }).click();
  // Het voorstel maakt plaats voor de vastgelegde regel (achteraf: er was al een test goedgekeurd).
  await expect(page.locator("#go-regel")).toHaveCount(0);
  await expect(page.locator("#go-rule-row")).toContainText(/Doorgaan als .* de hoofdtest .* slaagt/);
  await expect(page.locator("#go-rule-row")).toContainText("achteraf vastgelegd");
  await expect(start).toBeEnabled();
  await expect(page.locator("#go-rule-block")).toHaveCount(0);
  await start.click();
  await expect(steps).toContainText("Loopt");
});
