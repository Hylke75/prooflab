import { execSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { createIdeaViaIntake, dutchDate, isoDate } from "./intake";

// Businesscase (docs/ONTWERP_BUSINESSCASE.md): drie fictieve cases die iemand zonder financiële achtergrond doorloopt.
// Evenementenlocatie (volledig, opslaan en opnieuw openen, scenario aanpassen, telefoon), een nieuwe dienst (onvolledige
// en onrealistische invoer) en een stichting (subsidies met verschillende zekerheid).

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
  await expect(ws.or(hero)).toBeVisible({ timeout: 30_000 });
  if (await ws.isVisible()) {
    await ws.fill("E2E Bureau");
    await page.getByRole("button", { name: "Werkruimte aanmaken" }).click();
    await expect(hero).toBeVisible();
  }
}

async function newIdea(page: Page, idea: string, name: string) {
  return createIdeaViaIntake(page, {
    idea,
    decision: `Beginnen we hiermee, ja of nee, vóór ${dutchDate(60)}?`,
    uncertainty: "Of er genoeg vraag is tegen een prijs die de kosten dekt.",
    fill: { "Korte naam": `TEST ${name} ${Date.now()}`, "Doelgroep": "zakelijke klanten in de regio", "Inzet (euro)": "50000", "Uiterlijke beslisdatum": isoDate(60), "Wat meet je?": "betalende klanten", "Doelwaarde": "20", "Minimumbedrag per klant": "500" },
    select: { "Soort klant": "Zakelijke klanten (B2B)", "Regio": "Nederland", "Type project": "new_product", "Opdrachtgever": "none" },
  });
}

const saved = (page: Page) => expect(page.getByText(/Automatisch bewaard ·/)).toBeVisible({ timeout: 10_000 });
const nextStep = (page: Page) => page.getByRole("button", { name: "Volgende stap", exact: true }).click();
const result = (page: Page) => page.getByRole("complementary", { name: "Je uitkomst tot nu toe" });

function dbValue(sql: string): string | null {
  try {
    return execSync(`docker exec supabase_db_prooflab psql -U postgres -d postgres -At -c ${JSON.stringify(sql)}`, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

test("evenementenlocatie: vragen, eerste uitkomst, scenario's, opslaan en opnieuw openen", async ({ page }) => {
  await login(page);
  const url = await newIdea(page, "Ik wil onderzoeken of het rendabel is om een evenementenlocatie te exploiteren waar zakelijke bijeenkomsten, workshops en culturele evenementen worden georganiseerd.", "locatie");
  const ideaId = url.split("/").pop()!;

  // Een bestaand dossier zonder businesscase opent gewoon, met de omschrijving uit de intake.
  await page.goto(`${url}/businesscase`);
  await expect(page.getByRole("heading", { name: "Reken je idee door" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welk idee wil je onderzoeken?" })).toBeVisible();
  await expect(page.getByLabel("Je idee", { exact: true })).toHaveValue(/evenementenlocatie/);
  await expect(page.getByText(/stel ik bij de volgende vraag voor: verhuur van ruimte/)).toBeVisible();
  await nextStep(page);

  // Verdienen: suggestie zichtbaar, kiezen met één klik.
  await expect(page.getByRole("heading", { name: "Hoe verdien je geld?" })).toBeVisible();
  const rental = page.getByRole("button", { name: /Verhuur van ruimte of plekken/ });
  await expect(rental).toContainText("Past bij je idee");
  await rental.click();
  await expect(rental).toHaveAttribute("aria-pressed", "true");
  await nextStep(page);

  // Verkoop en prijs: na deze stap staat er al een omzet.
  await page.getByLabel("Hoeveel ruimtes of plekken verhuur je?").fill("2");
  await page.getByLabel("Hoeveel dagdelen per week kun je per ruimte verhuren?").fill("10");
  await page.getByLabel("Welk deel daarvan is gemiddeld echt verhuurd?").fill("70");
  await page.getByLabel("Wat kost één dagdeel huur?").fill("400");
  // 2 × 10 × 70% × 52 / 12 = 60,67 dagdelen × € 400 = € 24.267 per maand → € 291.200 per jaar (gemiddelde aanloop: lager).
  await expect(result(page)).toContainText("Omzet in jaar 1");
  await expect(result(page)).toContainText("Alleen de omzet is bekend");
  await saved(page);
  await nextStep(page);

  await page.getByRole("radio", { name: /Meteen/ }).click();
  await nextStep(page);
  await page.getByLabel("Wat kost één verhuurd dagdeel jou (schoonmaak, energie, inzet)?").fill("60");
  await nextStep(page);

  // Vaste kosten via suggesties; huur bevestigd met herkomst.
  await page.getByRole("button", { name: "Huur", exact: true }).click();
  await page.getByLabel("Bedrag voor huur").fill("6.000");
  await page.getByRole("button", { name: "Heb je hier een bron voor?" }).first().click();
  await page.getByLabel(/Waar komt dit getal vandaan/).fill("Huurofferte pand, oktober");
  await page.getByRole("button", { name: "Klaar", exact: true }).click();
  await expect(page.getByText("Bevestigd", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Personeel of eigen inkomen", exact: true }).click();
  await page.getByLabel("Bedrag voor personeel of eigen inkomen").fill("5000");
  await nextStep(page);

  await page.getByRole("button", { name: "Verbouwing", exact: true }).click();
  await page.getByLabel("Bedrag voor verbouwing").fill("60000");
  await nextStep(page);
  await page.getByRole("radio", { name: /Hoeveel startgeld heb ik nodig/ }).click();
  await page.getByRole("button", { name: "Naar het overzicht" }).click();

  // Overzicht: vijf blokken, oordeel, scenario's. Realistisch: elke maand ≈ € 9.627 over, startgeld ≈ € 50.373.
  await expect(page.getByText("Hoe haalbaar lijkt het?")).toBeVisible();
  await expect(page.locator(".bc-verdict")).toContainText("Lijkt haalbaar");
  await expect(page.locator(".bc-headline")).toContainText("Startgeld nodig");
  await expect(page.locator(".bc-headline-value")).toHaveText("€ 50.373");
  for (const h of ["Wat kun je nu het beste doen?", "Wat moet nog?", "Risico's", "Wat weten we al?", "Drie scenario's"]) await expect(page.getByRole("heading", { name: h })).toBeVisible();
  await expect(page.getByText("Wat weegt het zwaarst?")).toBeVisible();
  await saved(page);

  // Scenario aanpassen: conservatief 60% minder verkoop → conservatief speelt niet meer quitte, oordeel wordt krap.
  await page.getByLabel("Verkoop (conservatief)").fill("-60");
  await expect(page.locator(".bc-verdict")).toContainText("Krap");
  await saved(page);

  // Opnieuw openen: alles staat er nog, het overzicht opent meteen.
  await page.reload();
  await expect(page.locator(".bc-verdict")).toContainText("Krap");
  await expect(page.getByLabel("Verkoop (conservatief)")).toHaveValue("-60");
  await expect(page.locator(".bc-known")).toContainText("Huur");

  // Financiële haalbaarheid volgt mee (vaste kosten en investering), als de lokale database bereikbaar is.
  const ue = dbValue(`select fixed_costs_year || '|' || upfront_investment from unit_economics where idea_id = '${ideaId}'`);
  if (ue !== null) expect(ue).toBe("132000|60000");

  // Telefoon: geen horizontale scroll, vragen blijven bruikbaar.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Vragen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welk idee wil je onderzoeken?" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("nieuwe dienst: onvolledige en onrealistische invoer", async ({ page }) => {
  await login(page);
  const url = await newIdea(page, "Een organisatie wil een nieuwe trainingsdienst introduceren: workshops over AI voor mkb-teams, per dagdeel betaald.", "dienst");
  await page.goto(`${url}/businesscase?stap=earn`);
  await page.getByRole("button", { name: /Per dienst of uur/ }).click();
  await nextStep(page);
  await page.getByLabel("Hoeveel uren of opdrachten per maand als het loopt?").fill("abc");
  await expect(page.getByText("Vul een getal in, bijvoorbeeld 1.250 of 12,5.")).toBeVisible();
  await page.getByLabel("Hoeveel uren of opdrachten per maand als het loopt?").fill("12");
  await page.getByLabel("Wat vraag je per uur of opdracht?").fill("-5");
  await expect(page.getByText("Gebruik een getal van 0 of hoger.")).toBeVisible();
  await page.getByLabel("Wat vraag je per uur of opdracht?").fill("1.200");
  await expect(result(page)).toContainText("Alleen de omzet is bekend");
  await expect(result(page)).toContainText("Nog te doen");
  await nextStep(page);
  await nextStep(page);
  // Onrealistisch: kosten per opdracht hoger dan de prijs.
  await page.getByLabel("Wat kost één uur of opdracht jou aan materiaal of inhuur?").fill("1500");
  await nextStep(page);
  await nextStep(page);
  await page.getByRole("button", { name: "Overzicht", exact: true }).click();
  await expect(page.locator(".bc-checks")).toContainText("verlies je dan geld");
  await expect(page.locator(".bc-checks")).toContainText("geen vaste kosten");
  await expect(page.locator(".bc-verdict")).toContainText("Nog niet haalbaar");
  await expect(page.locator(".bc-todo")).toContainText("Wat je vooraf moet investeren");
  await page.locator(".bc-todo").getByRole("button").first().click();
  await expect(page.getByRole("heading", { name: "Hoeveel geld moet je vooraf investeren?" })).toBeVisible();
});

test("stichting: toegezegd, aangevraagd en een idee tellen per scenario anders", async ({ page }) => {
  await login(page);
  const url = await newIdea(page, "Een stichting wil onderzoeken of een maatschappelijk buurtproject met vrijwilligers financieel haalbaar is met subsidie en fondsen.", "stichting");
  await page.goto(`${url}/businesscase?stap=earn`);
  const funding = page.getByRole("button", { name: /Subsidie, fonds of donaties/ });
  await expect(funding).toContainText("Past bij je idee");
  await funding.click();
  await nextStep(page);
  await page.getByLabel("Hoeveel geld per jaar?").fill("40000");
  await page.getByRole("radio", { name: "Toegezegd" }).check();
  await nextStep(page);
  await nextStep(page);
  await nextStep(page);
  await page.getByRole("button", { name: "Projectcoördinatie", exact: true }).click();
  await page.getByLabel("Bedrag voor projectcoördinatie").fill("3000");
  await nextStep(page);
  await nextStep(page);
  await page.getByRole("radio", { name: /Zijn de kosten gedekt/ }).click();
  await page.getByRole("button", { name: "Naar het overzicht" }).click();
  // € 40.000 per jaar tegen € 36.000 kosten: € 4.000 over in elk scenario behalve conservatief (+10% kosten = € 39.600).
  await expect(page.locator(".bc-headline")).toContainText("Overschot in jaar 3");
  await expect(page.locator(".bc-headline-value")).toHaveText("€ 4.000");
  await expect(page.locator(".bc-verdict")).toContainText("Lijkt haalbaar");
  await saved(page);
});
