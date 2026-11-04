import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

// Eigen notities en documenten per stap: toevoegen, bewerken, een document uploaden en downloaden, en het document
// in stap Markt overnemen in het bronformulier (dat blijft het letterlijke citaat controleren). Vraagt de migratie
// 20261110130000_notities_documenten en Storage met de bucket step-documents.

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

// Een eigen idee via de intake, zoals in testcard.spec.ts.
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
  await page.getByLabel("Korte naam", { exact: true }).fill(`TEST notities ${Date.now()}`);
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

test("notities en documenten per stap: toevoegen, bewerken, uploaden en downloaden", async ({ page }) => {
  await login(page);
  const ideaUrl = await createIdea(page);

  await page.goto(`${ideaUrl}/research`);
  const block = page.getByRole("region", { name: "Notities en documenten" });
  await expect(block).toBeVisible();
  // Leeg: ingeklapt, met teller 0 en de hint dat notities niet in het rapport komen.
  await expect(block.getByText("0", { exact: true })).toBeVisible();
  await block.getByText("Notities en documenten", { exact: true }).click();
  await expect(block.getByText("Notities zijn intern en komen niet in het rapport.", { exact: false })).toBeVisible();

  // Notitie toevoegen: leeg opslaan geeft een melding bij het veld.
  await block.getByText("Notitie toevoegen", { exact: true }).click();
  await block.getByRole("button", { name: "Notitie opslaan" }).click();
  await expect(block.getByText("Schrijf eerst de tekst van de notitie.").first()).toBeVisible();
  await block.getByLabel("Titel", { exact: true }).fill("Gesprek met de branchevereniging");
  await block.getByLabel("Notitie (verplicht)", { exact: true }).fill("## Uitkomst\n- Leden vragen om **tijdwinst**\n- Bron volgt: [NVM](https://www.nvm.nl/)\n<script>alert(1)</script>");
  await block.getByRole("button", { name: "Notitie opslaan" }).click();
  await expect(block.getByText("Notitie toegevoegd.")).toBeVisible();
  await expect(block.getByRole("heading", { name: "Gesprek met de branchevereniging" })).toBeVisible();
  await expect(block.getByText("tijdwinst", { exact: true })).toBeVisible();
  await expect(block.getByRole("link", { name: "NVM" })).toHaveAttribute("rel", /noopener/);
  // HTML in een notitie is gewone tekst.
  await expect(block.getByText("<script>alert(1)</script>")).toBeVisible();

  // Bewerken.
  await block.getByRole("button", { name: /Bewerk notitie/ }).click();
  await block.getByLabel("Tekst van de notitie (verplicht)", { exact: true }).fill("Leden vragen vooral om tijdwinst bij woningteksten.");
  await block.getByRole("button", { name: "Wijziging opslaan" }).click();
  await expect(block.getByText("Leden vragen vooral om tijdwinst bij woningteksten.")).toBeVisible();
  await expect(block.getByText(/bewerkt/)).toBeVisible();

  // Document uploaden: eerst een niet toegestaan type, dan een tekstbestand.
  await block.getByText("Document uploaden", { exact: true }).click();
  const input = block.getByLabel("Bestand (verplicht)", { exact: true });
  await input.setInputFiles({ name: "pagina.html", mimeType: "text/html", buffer: Buffer.from("<p>x</p>") });
  await block.getByRole("button", { name: "Bestand uploaden" }).click();
  await expect(block.getByText(/Dit bestandstype is niet toegestaan/)).toBeVisible();
  const content = `Marktnotitie ${Date.now()}\nZelfstandige makelaars: 4.100 kantoren (bron volgt).`;
  await input.setInputFiles({ name: "marktnotitie.txt", mimeType: "text/plain", buffer: Buffer.from(content) });
  await block.getByLabel("Omschrijving", { exact: true }).fill("Aantekeningen marktomvang");
  await block.getByRole("button", { name: "Bestand uploaden" }).click();
  await expect(block.getByText('Document "marktnotitie.txt" toegevoegd.')).toBeVisible();
  const link = block.getByRole("link", { name: /marktnotitie\.txt/ });
  await expect(link).toBeVisible();

  // Downloaden via een kort geldige link, met de oorspronkelijke naam en inhoud.
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toBe("marktnotitie.txt");
  const file = await download.path();
  expect(await readFile(file, "utf8")).toBe(content);

  // Gebruik als bron: het bronformulier krijgt de titel; het citaat plakt de gebruiker zelf.
  await block.getByRole("button", { name: "Gebruik als bron" }).click();
  await expect(page.getByLabel("Titel van de bron", { exact: true })).toHaveValue("Aantekeningen marktomvang");
  await expect(page.getByText(/Een document is geen bron vanzelf/)).toBeVisible();

  // Na herladen staat alles er nog, met de teller in de kop; notities horen bij hun stap.
  await page.goto(`${ideaUrl}/research`);
  await expect(page.getByRole("region", { name: "Notities en documenten" }).getByText("2", { exact: true })).toBeVisible();
  await page.goto(`${ideaUrl}/assumptions`);
  await expect(page.getByRole("region", { name: "Notities en documenten" }).getByText("0", { exact: true })).toBeVisible();

  // Verwijderen met bevestiging.
  await page.goto(`${ideaUrl}/research`);
  const again = page.getByRole("region", { name: "Notities en documenten" });
  const docItem = again.getByRole("listitem").filter({ hasText: "marktnotitie.txt" });
  await docItem.getByRole("button", { name: "Verwijderen", exact: true }).click();
  await page.getByRole("dialog", { name: "Document verwijderen?" }).getByRole("button", { name: "Ja, verwijderen" }).click();
  await expect(again.getByText("Document verwijderd.")).toBeVisible();
});
