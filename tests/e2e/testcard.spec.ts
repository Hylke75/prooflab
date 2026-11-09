import { expect, test, type Page } from "@playwright/test";
import { createIdeaViaIntake, dutchDate, isoDate } from "./intake";

// Fase B1: de Test Card van een prijs-/aanbodtest. Opslaan geeft altijd een zichtbaar resultaat of een duidelijke
// fout, en de drempels liggen vast vóórdat ProofLab het aantal deelnemers uitrekent.
// Fase B5: vijf zichtbare velden, de rest vooringevuld onder Details, en een hoofdtest start pas met een vastgelegde
// go-regel. Feedback eigenaar: tabs in plaats van twee kolommen (Test Card · Testpagina · Voorbeeld, met de prijs uit
// de intake op Testpagina) en een voortgangsbalk over het hele testproces met "Je bent hier" en de volgende stap.

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

  // Voorstel "ProofLab eenvoudiger": Wat nu? toont één volgende taak; latere taken zeggen waarom ze nog niet kunnen.
  await page.goto(ideaUrl);
  await expect(page.getByRole("heading", { name: /^Volgende taak:/ })).toBeVisible();
  await expect(page.locator(".phase-task", { hasText: "Neem je besluit" })).toContainText("Kan nog niet");

  await page.goto(`${ideaUrl}/assumptions`);
  await page.getByRole("button", { name: /Begin met de standaardset|Stel aannames voor/ }).click();
  await expect(page.getByRole("heading", { name: "Risicokaart" })).toBeVisible();

  // Testen: eerst het overzicht met één knop; het testplan is een eigen taakscherm.
  await page.goto(`${ideaUrl}/experiments`);
  await expect(page.getByRole("form", { name: "Testplan" })).toHaveCount(0);
  await page.getByRole("link", { name: "Zet een nieuwe test op" }).click();
  await page.waitForURL(/nieuw=1/);
  await expect(page.locator(".task-head .eyebrow")).toContainText("Testen · taak 1 van 3");
  await expect(page.locator(".role-block")).toContainText("Wat jij doet");
  // Stap 1 van 5: testtype. Een prijsaanname, zodat de prijstest ook kan worden goedgekeurd (B0 punt 3).
  const steps = page.getByRole("tablist", { name: "Stappen van het testplan" });
  const statements = await page.locator("#as-select option").allTextContents();
  const price = statements.find((s) => /prijs|betalen/i.test(s));
  expect(price, "een prijsaanname").toBeTruthy();
  await page.getByLabel("Aanname die je toetst", { exact: true }).selectOption({ label: price! });
  await page.getByRole("radio", { name: /Prijs-\/aanbodtest/ }).click();
  await expect(steps.getByRole("tab")).toHaveCount(5);
  await expect(steps.getByRole("tab")).toContainText(["1. Testtype", "2. Wat test je", "3. Wanneer geslaagd", "4. Testpagina", "5. Voorbeeld"]);
  await expect(page.locator("#tc-steps")).toContainText("Stap 1 van 5: Testtype");
  const card = page.getByRole("form", { name: "Testplan" });
  await expect(card).toBeHidden();
  await page.getByRole("button", { name: /Volgende: Wat test je/ }).click();
  await expect(page.locator("#tc-steps")).toContainText("Stap 2 van 5: Wat test je");

  // Stap 2: drie vragen. Opslaan staat pas op de laatste stap.
  for (const label of ["Naam van het experiment (verplicht)", "Wij denken dat … (verplicht)", "Bij wie? (verplicht)"]) await expect(card.getByLabel(label, { exact: true })).toBeVisible();
  await expect(card.locator("input:visible:not([type=hidden]):not([type=radio]), textarea:visible, select:visible")).toHaveCount(3);
  await expect(card.getByRole("button", { name: "Test Card opslaan als concept" })).toHaveCount(0);
  await card.getByLabel("Wij denken dat … (verplicht)", { exact: true }).fill("Zelfstandige NVM-makelaars kiezen op de testpagina een abonnement van € 249 per maand.");

  // Stap 3: wanneer is de test geslaagd. B1b: zonder vastgelegde drempels wordt niets uitgerekend.
  await card.getByRole("button", { name: /Volgende: Wanneer geslaagd/ }).click();
  await expect(card.getByLabel("Verwachte uitkomst (%)", { exact: true })).toHaveCount(0);
  await expect(card.getByText("Leg eerst de drempels vast. Daarna rekent ProofLab uit hoeveel deelnemers je nodig hebt.")).toBeVisible();
  for (const label of ["Het klopt als ≥ (%) (verplicht)", "Het klopt niet als < (%) (verplicht)", "Minimale steekproef (verplicht)", "Deadline (verplicht)"]) {
    await expect(card.getByLabel(label, { exact: true })).toBeVisible();
  }
  await expect(card.getByLabel("Deadline (verplicht)", { exact: true })).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  // De werving staat vooringevuld onder Details.
  await card.locator("#tc-details").click();
  await expect(card.getByRole("radio", { name: "Eigen netwerk", exact: true })).toBeChecked();
  await card.locator("#tc-details").click();
  // Pijltjestoetsen wisselen van stap.
  await steps.getByRole("tab", { name: /Wanneer geslaagd/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(steps.getByRole("tab", { name: /Testpagina/ })).toHaveAttribute("aria-selected", "true");

  // Stap 4: testpagina, vooringevuld met de prijs uit de intake (€ 249 per maand).
  await expect(card.getByLabel("Prijspunt 1: naam (verplicht)", { exact: true })).toHaveValue("Basis");
  await expect(card.getByLabel("Bedrag (€) en periode", { exact: true }).first()).toHaveValue("249");
  await expect(card.getByLabel("Periode prijspunt 1", { exact: true })).toHaveValue("per maand");
  await expect(card.getByText("Prijs uit de intake overgenomen: € 249 per maand.")).toBeVisible();
  await expect(card.getByLabel("Kop (verplicht)", { exact: true })).not.toHaveValue("");
  await card.getByLabel("Ondertitel", { exact: true }).fill("Minder typewerk, meer bezichtigingen.");

  // Stap 5: het voorbeeld beweegt live mee; terug- en vooruitgaan verliest niets.
  await card.getByRole("button", { name: /Volgende: Voorbeeld/ }).click();
  await expect(card.locator(".preview-mini")).toContainText("Minder typewerk, meer bezichtigingen.");
  await card.getByRole("button", { name: "← Vorige" }).click();
  await expect(card.getByLabel("Ondertitel", { exact: true })).toHaveValue("Minder typewerk, meer bezichtigingen.");
  await card.getByRole("button", { name: /Volgende: Voorbeeld/ }).click();

  // B1a: één opslagknop op de laatste stap; opslaan zonder vastgelegde drempels stuurt geen verzoek maar springt naar
  // de stap met het ontbrekende punt.
  const save = card.getByRole("button", { name: "Test Card opslaan als concept" });
  await expect(save).toHaveCount(1);
  await expect(save).toBeEnabled();
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST") posts++;
  });
  await save.click();
  await expect(card.getByText("Nog niet opgeslagen: 1 punt moet nog worden aangevuld.")).toBeVisible();
  await expect(card.locator(".tc-save").getByRole("button", { name: "Drempels vastleggen", exact: true })).toBeVisible();
  await expect(steps.getByRole("tab", { name: /Wanneer geslaagd/ })).toHaveAttribute("aria-selected", "true");
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

  // Een verplicht veld op een andere stap dat ontbreekt: opslaan springt naar die stap, de stap toont het aantal en de
  // fout staat zichtbaar bij het veld.
  await steps.getByRole("tab", { name: /Testpagina/ }).click();
  await card.getByLabel("Kop (verplicht)", { exact: true }).fill("");
  await steps.getByRole("tab", { name: /Voorbeeld/ }).click();
  await expect(card.getByLabel("Kop (verplicht)", { exact: true })).toBeHidden();
  await save.click();
  await expect(steps.getByRole("tab", { name: /Testpagina/ })).toHaveAttribute("aria-selected", "true");
  await expect(steps.getByRole("tab", { name: /Testpagina/ })).toContainText("1");
  await expect(card.locator("#err-headline")).toBeVisible();
  await expect(card.locator("#err-headline")).toContainText("Schrijf een kop");
  await expect(card.getByLabel("Kop (verplicht)", { exact: true })).toBeFocused();
  expect(posts).toBe(0);

  // Aanvullen en opslaan: bevestiging en het concept op het bord, ook na herladen.
  await card.getByLabel("Kop (verplicht)", { exact: true }).fill("Je woningteksten en klantmails in minuten klaar.");
  await steps.getByRole("tab", { name: /Voorbeeld/ }).click();
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

  // De voortgangsbalk volgt de test: Test Card invullen → Ter review → Goedgekeurd → Loopt, met de volgende stap.
  const procStep = page.locator("#testproces li[aria-current=step]");
  await expect(procStep).toContainText("Test Card invullen");
  await expect(page.locator("#testproces")).toContainText("Volgende stap: controleer de Test Card en bied hem ter review aan.");
  await expect(page.getByRole("link", { name: /Naar ter review aanbieden/ })).toHaveAttribute("href", "#ter-review");
  await page.getByRole("button", { name: "Ter review aanbieden" }).click();
  await expect(procStep).toContainText("Ter review");
  await expect(page.locator("#testproces li.done")).toHaveCount(1);
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
  await expect(procStep).toContainText("Goedgekeurd");
  await start.click();
  await expect(procStep).toContainText("Loopt (meten)");
  await expect(page.locator("#testproces")).toContainText("Stap 4 van 6 · Loopt (meten)");
});
