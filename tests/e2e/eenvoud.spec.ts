import { expect, test, type Page } from "@playwright/test";
import { createIdeaViaIntake, dutchDate, isoDate } from "./intake";

// Ronde 5 van "ProofLab eenvoudiger" (docs/ONDERZOEK_GEBRUIKSVRIENDELIJKHEID.md): "Waarom vragen we dit?" bij een veld,
// een concept dat op dit apparaat bewaard blijft, en ongedaan maken in plaats van direct verwijderen.

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

test("waarom-uitleg, concept bewaren en ongedaan maken bij aannames", async ({ page }) => {
  await login(page);
  const ideaUrl = await createIdeaViaIntake(page, {
    idea: "Een abonnement voor kleine fysiotherapiepraktijken dat afspraken herinnert en no-shows opvolgt, voor € 49 per maand.",
    decision: `Steken we € 20.000 in dit abonnement, ja of nee, vóór ${dutchDate(60)}?`,
    uncertainty: "Of praktijken no-shows een groot genoeg probleem vinden.",
    fill: { "Korte naam": `TEST eenvoud ${Date.now()}`, "Inzet (euro)": "20000", "Uiterlijke beslisdatum": isoDate(60), "Wat meet je?": "betalende praktijken", "Doelwaarde": "15", "Minimumbedrag per klant": "49" },
    select: { "Type project": "new_product", "Opdrachtgever": "none" },
  });

  await page.goto(`${ideaUrl}/assumptions?stap=opschrijven`);
  await page.waitForLoadState("networkidle");

  // Waarom vragen we dit? Dicht tot je erom vraagt, dan zichtbaar.
  const why = page.getByRole("button", { name: "Waarom vragen we dit?" }).first();
  await expect(why).toHaveAttribute("aria-expanded", "false");
  await why.click();
  await expect(why).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText(/Een idee slaagt alleen als een paar dingen kloppen/)).toBeVisible();

  // Concept: wat je typt blijft na herladen staan, tot je opslaat.
  const statement = `Praktijken verliezen elke week minstens twee afspraken door no-shows ${Date.now()}`;
  await page.getByLabel("Wat moet waar zijn?", { exact: true }).fill(statement);
  await expect(page.getByText(/Concept bewaard op dit apparaat/)).toBeVisible();
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Wat moet waar zijn?", { exact: true })).toHaveValue(statement);
  await page.getByRole("button", { name: "Toevoegen", exact: true }).click();
  await expect(page.locator(".assumption-item", { hasText: statement })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Wat moet waar zijn?", { exact: true })).toHaveValue("");

  // Ongedaan maken: verwijderen telt af en is terug te draaien; zonder ongedaan maken is de aanname daarna weg.
  await page.goto(`${ideaUrl}/assumptions?stap=kiezen`);
  await page.getByRole("button", { name: new RegExp(statement.slice(0, 40)) }).first().click();
  await page.getByRole("button", { name: "Aanname verwijderen" }).click();
  await expect(page.getByText(/Aanname wordt verwijderd over \d s/)).toBeVisible();
  await page.getByRole("button", { name: "Ongedaan maken" }).click();
  await expect(page.getByRole("button", { name: "Aanname verwijderen" })).toBeVisible();
  await page.waitForTimeout(7_000);
  await page.reload();
  await expect(page.getByRole("button", { name: new RegExp(statement.slice(0, 40)) }).first()).toBeVisible();

  await page.getByRole("button", { name: new RegExp(statement.slice(0, 40)) }).first().click();
  await page.getByRole("button", { name: "Aanname verwijderen" }).click();
  // Na het aftellen verdwijnt de aanname vanzelf (de pagina ververst na het verwijderen).
  await expect(page.getByRole("button", { name: new RegExp(statement.slice(0, 40)) })).toHaveCount(0, { timeout: 15_000 });
  await page.reload();
  await expect(page.getByRole("button", { name: new RegExp(statement.slice(0, 40)) })).toHaveCount(0);
});

test("voorgestelde aannames per stuk overnemen, aanpassen of weggooien; concept van de testkaart", async ({ page }) => {
  await login(page);
  const ideaUrl = await createIdeaViaIntake(page, {
    idea: "Een abonnement voor kleine fysiotherapiepraktijken dat afspraken herinnert en no-shows opvolgt, voor € 49 per maand.",
    decision: `Steken we € 20.000 in dit abonnement, ja of nee, vóór ${dutchDate(60)}?`,
    uncertainty: "Of praktijken no-shows een groot genoeg probleem vinden.",
    fill: { "Korte naam": `TEST voorstellen ${Date.now()}`, "Inzet (euro)": "20000", "Uiterlijke beslisdatum": isoDate(60), "Wat meet je?": "betalende praktijken", "Doelwaarde": "15", "Minimumbedrag per klant": "49" },
    select: { "Type project": "new_product", "Opdrachtgever": "none" },
  });

  // De standaardset komt binnen als voorstellen; de risicokaart wijst ernaar.
  await page.goto(`${ideaUrl}/assumptions`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Begin met de standaardset|Stel aannames voor/ }).click();
  await expect(page.getByRole("heading", { name: "Risicokaart" })).toBeVisible();
  await expect(page.getByText(/voorgestelde aannames wachten op je keuze/)).toBeVisible();
  await page.getByRole("link", { name: /Neem over, pas aan of gooi weg/ }).click();
  await page.waitForURL(/stap=opschrijven/);
  const list = page.locator(".proposal-item");
  await expect(list.first()).toBeVisible();
  const start = await list.count();
  expect(start).toBeGreaterThan(2);

  // Overnemen: het voorstel verdwijnt uit de voorstellen en staat bij Je aannames.
  const first = (await list.first().locator("p").innerText()).trim();
  await list.first().getByRole("button", { name: "Overnemen" }).click();
  await expect(list).toHaveCount(start - 1);
  await expect(page.locator(".assumption-item", { hasText: first.slice(0, 30) })).toBeVisible();

  // Aanpassen: eigen tekst opslaan en overnemen.
  const eigen = `Praktijken met 3–10 therapeuten missen wekelijks minstens twee afspraken ${Date.now()}`;
  await list.first().getByRole("button", { name: "Aanpassen" }).click();
  await page.getByLabel("Aanname", { exact: true }).fill(eigen);
  await page.getByRole("button", { name: "Opslaan en overnemen" }).click();
  await expect(page.locator(".assumption-item", { hasText: eigen })).toBeVisible();
  await expect(list).toHaveCount(start - 2);

  // Weggooien met ongedaan maken; daarna de rest in één keer overnemen.
  await list.first().getByRole("button", { name: "Weggooien" }).click();
  await expect(page.getByText(/Voorstel wordt verwijderd over \d s/)).toBeVisible();
  await page.getByRole("button", { name: "Ongedaan maken" }).click();
  await page.getByRole("button", { name: "Alles overnemen" }).click();
  await expect(list).toHaveCount(0);

  // Concept van de testkaart: blijft staan na herladen, met de melding dat het is teruggezet.
  await page.goto(`${ideaUrl}/experiments?nieuw=1`);
  await page.waitForLoadState("networkidle");
  const steps = page.getByRole("tablist", { name: "Stappen van de testkaart" });
  await steps.getByRole("tab", { name: /Wat test je/ }).click();
  const hypothese = `Minstens 30% van de benaderde praktijken vraagt een proefmaand aan ${Date.now()}`;
  await page.getByLabel("Wij denken dat … (verplicht)", { exact: true }).fill(hypothese);
  await expect(page.getByText(/Concept bewaard op dit apparaat/)).toBeVisible();
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/is teruggezet/)).toBeVisible();
  await steps.getByRole("tab", { name: /Wat test je/ }).click();
  await expect(page.getByLabel("Wij denken dat … (verplicht)", { exact: true })).toHaveValue(hypothese);
  await page.getByRole("button", { name: "Opnieuw beginnen" }).click();
  await page.waitForLoadState("networkidle");
  await steps.getByRole("tab", { name: /Wat test je/ }).click();
  await expect(page.getByLabel("Wij denken dat … (verplicht)", { exact: true })).not.toHaveValue(hypothese);
});
