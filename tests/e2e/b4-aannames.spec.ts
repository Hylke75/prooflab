import { expect, test, type Page } from "@playwright/test";

// Fase B4: de rangorde van de aannames zegt iets. Geen drie gelijke scores bovenaan, een test die past bij de soort
// (een technische aanname krijgt geen klantinterviews), de reden in gewone taal ('Test deze eerst, omdat…') met
// IW en plafond in het uitklapdeel, en maximaal 3 aannames gekozen om nu te testen; de rest staat op 'later'.

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

// Het makelaarsdossier, via de huidige intake (zelfde opzet als tests/e2e/testcard.spec.ts).
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
  await page.getByLabel("Korte naam", { exact: true }).fill(`TEST B4 makelaars ${Date.now()}`);
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

test("B4: rangorde van aannames in gewone taal, test per soort en maximaal 3 kiezen", async ({ page }) => {
  await login(page);
  const ideaUrl = await createIdea(page);
  await page.goto(`${ideaUrl}/assumptions`);
  await page.getByRole("button", { name: /Begin met de standaardset|Stel aannames voor/ }).click();
  await expect(page.getByRole("heading", { name: "Risicokaart" })).toBeVisible();

  const items = page.locator(".assumption-item");
  await expect(items.first()).toBeVisible();
  const n = await items.count();
  expect(n).toBeGreaterThanOrEqual(4);

  // De lijst toont soort en test, geen IW of '(begrensd)'.
  for (let i = 0; i < n; i++) {
    await expect(items.nth(i).locator("small")).not.toContainText("IW");
    await expect(items.nth(i).locator("small")).not.toContainText("begrensd");
  }

  // De eerste aanname: reden in gewone taal; de score staat in het uitklapdeel.
  const reason = page.getByTestId("rangorde-reden");
  await expect(reason).toHaveText(/^Test deze eerst, omdat /);
  await expect(reason).not.toContainText("IW");
  await page.getByText("Score en berekening").click();
  await expect(page.getByText(/Informatiewaarde \(IW\) 100 van 100/)).toBeVisible();

  // De top drie heeft drie verschillende redenen of tests (vóór B4: drie keer hetzelfde, IW 100).
  const reasons: string[] = [];
  for (let i = 0; i < 3; i++) {
    await items.nth(i).click();
    reasons.push((await reason.textContent()) ?? "");
  }
  expect(reasons[1]).toMatch(/^Test deze als tweede, omdat /);
  expect(reasons[2]).toMatch(/^Test deze als derde, omdat /);
  expect(new Set(reasons).size).toBe(3);

  // Standaardset: de technische aanname krijgt een technische proef, geen klantinterviews.
  const technical = items.filter({ hasText: "We kunnen de oplossing leveren met de beschikbare mensen, data en techniek." });
  if ((await technical.count()) > 0) {
    await expect(technical.locator("small")).toContainText("technisch · technische proef");
    await technical.click();
    await expect(reason).toContainText("technische proef of prototype buiten ProofLab");
    await expect(reason).not.toContainText("klantinterviews");
  }

  // De soort is zichtbaar en te wijzigen; opslaan werkt de voorgestelde test bij.
  await items.first().click();
  await page.getByLabel("Soort aanname (bepaalt de passende test)").selectOption("technical");
  await page.getByRole("button", { name: "Soort opslaan" }).click();
  await expect(page.getByText("Soort opgeslagen; de voorgestelde test en de rangorde zijn bijgewerkt.")).toBeVisible();
  await expect(page.getByText("Soort: technisch", { exact: true })).toBeVisible();
  // Terug naar afleiden uit de tekst, zodat de rest van de test op de standaardrangorde draait.
  await page.getByLabel("Soort aanname (bepaalt de passende test)").selectOption("");
  await page.getByRole("button", { name: "Soort opslaan" }).click();
  await expect(page.getByText("De soort wordt weer afgeleid uit de tekst.")).toBeVisible();

  // Maximaal 3 kiezen; de rest staat op 'later'.
  await expect(page.getByText("Rangorde (nog niets gekozen)")).toBeVisible();
  const statements: string[] = [];
  for (let i = 0; i < 3; i++) {
    // Na elke keuze schuift de gekozen aanname naar 'Nu testen'; kies steeds de eerste uit 'Later'.
    const later = page.locator('ul[aria-labelledby="later-testen"] .assumption-item').first();
    statements.push(((await later.locator("span").nth(1).textContent()) ?? "").trim());
    await later.click();
    await page.getByRole("button", { name: "Kies om nu te testen" }).click();
    await expect(page.getByText(`${i + 1} van 3 gekozen`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Zet op later" })).toBeVisible();
  }
  const now = page.locator('ul[aria-labelledby="nu-testen"] .assumption-item');
  await expect(now).toHaveCount(3);
  for (const s of statements) await expect(now.filter({ hasText: s })).toHaveCount(1);
  await expect(page.locator("#later-testen")).toHaveText("Later");

  // Een vierde kan niet: de knop is uit en de reden staat erbij.
  await page.locator('ul[aria-labelledby="later-testen"] .assumption-item').first().click();
  await expect(page.getByRole("button", { name: "Kies om nu te testen" })).toBeDisabled();
  await expect(page.getByText("Je hebt al 3 aannames gekozen. Zet er eerst één op later.")).toBeVisible();

  // Blijft na herladen; 'Zet op later' maakt weer ruimte.
  await page.reload();
  await expect(now).toHaveCount(3);
  await now.first().click();
  await page.getByRole("button", { name: "Zet op later" }).click();
  await expect(page.getByText("Op later gezet.")).toBeVisible();
  await expect(now).toHaveCount(2);
});
