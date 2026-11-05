import { expect, test, type Page } from "@playwright/test";
import { createIdeaViaIntake, dutchDate, isoDate, setDetailLevel } from "./intake";

// Fase 1 · punt 1: twee standen per dossier. Een nieuw dossier staat op Snel; wisselen naar Grondig toont de details en
// blijft bewaard; de kans op de risicokaart is in beide standen dezelfde. Draai dit tegen een lokale of test-Supabase
// met de migratie 20261114090000_fase1_weergave.sql, niet tegen de live omgeving.

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

// Het testdossier van de product owner, op de stand waarmee een nieuw dossier start (Snel).
async function createIdea(page: Page): Promise<string> {
  return createIdeaViaIntake(
    page,
    {
      idea: "Een AI-assistent die besturen van amateursportclubs helpt met nieuwsbrieven, ledenberichten en sociale media, voor € 79 per maand.",
      decision: `Investeren we € 25.000 in de assistent, ja of nee, vóór ${dutchDate(60)}?`,
      uncertainty: "Betalen clubs € 79 per maand?",
      fill: { "Korte naam": `TEST AI-communicatie voor sportclubs ${Date.now()}`, "Inzet (euro)": "25000", "Uiterlijke beslisdatum": isoDate(60), "Wat meet je?": "betalende sportclubs", "Doelwaarde": "30", "Minimumbedrag per klant (€)": "79" },
      select: { "Type project": "new_product", "Opdrachtgever": "none" },
    },
    { level: "Snel" },
  );
}

const switchOf = (page: Page) => page.getByRole("radiogroup", { name: "Weergave van dit dossier" });

test("Snel ↔ Grondig: nieuw dossier op Snel, details pas in Grondig, de stand blijft bewaard", async ({ page }) => {
  await login(page);
  const ideaUrl = await createIdea(page);

  // Een nieuw dossier staat op Snel; de schakelaar is een radiogroep met twee keuzes.
  await expect(switchOf(page).getByRole("radio", { name: "Snel", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(switchOf(page).getByRole("radio")).toHaveCount(2);

  // Markt in Snel: geen kengetallen, wel de onderzoekskaart en één hint per pagina.
  await expect(page.getByRole("heading", { name: "Onderzoekskaart" })).toBeVisible();
  await expect(page.getByText("Onderzoeksvragen beantwoord")).toBeHidden();
  await expect(page.getByRole("button", { name: "Meer tonen in Grondig" })).toHaveCount(1);
  // De tabs blijven allemaal.
  for (const tab of ["Marktbeeld", "Concurrenten", "Doelgroepen", "Klantonderzoek", "Marktpotentieel", "Bronnen"]) {
    await expect(page.getByRole("tab", { name: tab })).toBeVisible();
  }

  // Aannames in Snel: een link naar de rekenwijze in plaats van de hele uitleg; zelf toevoegen blijft.
  await page.goto(`${ideaUrl}/assumptions`);
  const seed = page.getByRole("button", { name: /Stel aannames voor|Begin met de standaardset/ });
  if (await seed.isVisible()) await seed.click();
  await expect(page.getByRole("heading", { name: "Risicokaart" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("link", { name: "Hoe rekent ProofLab de kans uit? →" })).toBeVisible();
  await expect(page.getByText("Hoe rekent ProofLab de kans en de informatiewaarde uit?")).toBeHidden();
  await expect(page.getByLabel(/^Startkans/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Aanname toevoegen" })).toBeVisible();
  const kansSnel = await page.locator(".risk-dot").first().getAttribute("aria-label");

  // Wisselen met het toetsenbord (pijltje rechts) naar Grondig: de details verschijnen, de kans blijft gelijk.
  await switchOf(page).getByRole("radio", { name: "Snel", exact: true }).focus();
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/app/ideas/")), page.keyboard.press("ArrowRight")]);
  await expect(switchOf(page).getByRole("radio", { name: "Grondig", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Hoe rekent ProofLab de kans en de informatiewaarde uit?")).toBeVisible();
  await expect(page.getByLabel(/^Startkans/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Meer tonen in Grondig" })).toHaveCount(0);
  expect(await page.locator(".risk-dot").first().getAttribute("aria-label")).toBe(kansSnel);

  // Bewaard: na herladen en op een andere stap nog steeds Grondig.
  await page.goto(`${ideaUrl}/research`);
  await expect(switchOf(page).getByRole("radio", { name: "Grondig", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Onderzoeksvragen beantwoord")).toBeVisible();

  // Terug naar Snel met een klik.
  await setDetailLevel(page, "Snel");
  await page.reload();
  await expect(switchOf(page).getByRole("radio", { name: "Snel", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Onderzoeksvragen beantwoord")).toBeHidden();

  // Notities en documenten blijven in beide standen.
  await expect(page.getByRole("heading", { name: /Notities en documenten/ })).toBeVisible();
});

test("@mobile Snel | Grondig op 390 px: geen horizontaal scrollen, knoppen van 44 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await createIdea(page);
  const radios = switchOf(page).getByRole("radio");
  for (const r of await radios.all()) expect((await r.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
