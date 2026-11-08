import { expect, test, type Browser, type Page } from "@playwright/test";
import { assumptionKind } from "../../lib/domain/assumption-kind";
import { createIdeaViaIntake, dutchDate, isoDate } from "./intake";

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

// Fase 3: het menu heeft hooguit 9 zichtbare items zonder dubbele namen, en de stappen in het menu hebben dezelfde
// namen en status als de stappenbalk (de menustatus volgt na het laden van de pagina, vandaar de wachtende checks).
async function expectMenuMatchesStepper(page: Page) {
  const sidebar = page.locator("#sidebar");
  expect(await sidebar.locator(".idea-switch-btn, .side-nav a.nav-link").count()).toBeLessThanOrEqual(9);
  const names = await sidebar.locator(".side-nav a.nav-link .nav-label").allTextContents();
  expect(new Set(names).size).toBe(names.length);
  const menuSteps = sidebar.locator("a.nav-link[data-step]");
  const stepper = page.locator(".stepper [data-step]");
  await expect(menuSteps).toHaveCount(4);
  await expect(stepper).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    const s = stepper.nth(i);
    await expect(menuSteps.nth(i)).toHaveAttribute("data-step", (await s.getAttribute("data-step")) ?? "");
    await expect(menuSteps.nth(i)).toHaveAttribute("data-step-state", (await s.getAttribute("data-step-state")) ?? "");
    await expect(menuSteps.nth(i).locator(".nav-label")).toContainText((await s.locator(".step-name").textContent()) ?? "");
  }
}

async function visit(browser: Browser, url: string, ua: string, act: "view" | "click" | "submit") {
  const ctx = await browser.newContext({ userAgent: ua });
  const p = await ctx.newPage();
  await p.goto(url);
  await p.waitForTimeout(400);
  if (act !== "view") {
    await p.locator(".tp-card .btn.primary").click();
    if (act === "submit") {
      await p.getByLabel("E-mailadres (optioneel)", { exact: true }).fill(`test+${Date.now()}@example.com`);
      await p.locator(".tp-card input[type=checkbox]").check();
      await p.getByRole("button", { name: "Houd me op de hoogte" }).click();
      await expect(p.getByText("Dank je wel.")).toBeVisible();
    }
  }
  const cookies = await ctx.cookies();
  await ctx.close();
  return cookies;
}

test("idee → onderzoek → risico → test → bewijs → besluit → rapport", async ({ page, browser }) => {
  await login(page);

  // 1. Intake (fase B3): drie vragen en één bevestiging; de kaart krijgt vaste waarden, los van het AI-voorstel.
  const title = `E2E-idee ${Date.now()}`;
  await createIdeaViaIntake(page, {
    idea: "Een AI-assistent die zakelijke eventmanagers helpt binnen minuten een passende locatie te vinden, voor € 150 per maand.",
    decision: `Lanceren we dit aanbod met twee consultants en € 25.000, of stoppen we, vóór ${dutchDate(60)}?`,
    uncertainty: "Of eventmanagers zelf een locatie willen zoeken in plaats van een eventbureau te bellen.",
    fill: { "Korte naam": title, "Doelgroep": "zakelijke eventmanagers", "Inzet (euro)": "25000", "Uiterlijke beslisdatum": isoDate(60), "Wat meet je?": "betalende eventbureaus", "Doelwaarde": "10", "Minimumbedrag per klant": "1500" },
    select: { "Soort klant": "Zakelijke klanten (B2B)", "Regio": "Nederland", "Type project": "new_product", "Opdrachtgever": "none" },
  });
  await expect(page.getByRole("heading", { name: "Begrijp je markt." })).toBeVisible();
  await expectMenuMatchesStepper(page);
  const ideaUrl = page.url().replace(/\/research.*$/, "");
  // Het dossieroverzicht toont de volgende stap (week 1: onderzoek, niet de voorspelling).
  await page.goto(ideaUrl);
  await expect(page.getByRole("heading", { name: "Volgende stap" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Verzamel de eerste bronnen", exact: true })).toBeVisible();
  await page.goto(`${ideaUrl}/research`);

  // 2. Source + verified claim
  await page.getByRole("tab", { name: "Bronnen" }).click();
  await page.getByLabel("Titel van de bron", { exact: true }).fill("Vestigingen van bedrijven; bedrijfstak, regio");
  await page.getByLabel("Type bron", { exact: true }).selectOption("official_statistic");
  await page.getByLabel("Uitgever / instelling", { exact: true }).fill("CBS");
  await page.getByLabel("Publicatie- of peildatum", { exact: true }).fill("2026-05-01");
  await page.getByLabel("Relevant fragment (letterlijk overgenomen)", { exact: true }).fill("In 2026 telde Nederland 41.230 vestigingen in de branche congres- en beursorganisatie.");
  await page.getByLabel("Controleer het fragment op de live pagina", { exact: true }).uncheck();
  await page.getByLabel("Primaire bron (eerste publicatie, niet overgenomen)", { exact: true }).check();
  await page.getByRole("button", { name: "Bron opslaan" }).click();
  await expect(page.getByText(/Bron opgeslagen/)).toBeVisible();
  await page.getByRole("tab", { name: "Bronnen" }).click();
  await page.getByLabel("Bevinding (één zin)", { exact: true }).fill("Nederland telde in 2026 41.230 vestigingen in congres- en beursorganisatie.");
  await page.getByLabel("Letterlijk citaat uit het fragment", { exact: true }).fill("In 2026 telde Nederland 41.230 vestigingen in de branche congres- en beursorganisatie.");
  await expect(page.getByText("✓ Citaat staat letterlijk in het fragment.")).toBeVisible();
  // Golf C: populatie, regio en peildatum per bevinding zijn verplicht; hier gelijk aan de intake (direct bewijs).
  await page.getByLabel("Populatie", { exact: true }).fill("vestigingen in congres- en beursorganisatie");
  await page.getByLabel("Regio", { exact: true }).fill("Nederland");
  await page.getByLabel("Peildatum", { exact: true }).fill("2026");
  await page.getByLabel("Wat bewijst dit nog níét?", { exact: true }).fill("Dat deze bedrijven het probleem hebben of willen betalen.");
  await page.getByRole("button", { name: "Bevinding toetsen en opslaan" }).click();
  await expect(page.getByText(/Bevinding opgeslagen/)).toBeVisible();
  await page.goto(`${ideaUrl}/research`);
  await expect(page.locator(".insight .pill", { hasText: "Geverifieerd" }).first()).toBeVisible();

  // 3. Assumptions
  await page.goto(`${ideaUrl}/assumptions`);
  await page.getByRole("button", { name: /Begin met de standaardset|Stel aannames voor/ }).click();
  await expect(page.getByRole("heading", { name: "Risicokaart" })).toBeVisible();

  // 4. Landing page experiment
  await page.goto(`${ideaUrl}/experiments`);
  // B0 punt 3: een landingpage met demo-aanvragen past niet bij een prijs- of technische aanname (dan is goedkeuren
  // geblokkeerd). Kies daarom expliciet een markt- of gedragsaanname.
  const statements = await page.locator("#as-select option").allTextContents();
  const fitting = statements.find((st) => ["market", "behaviour"].includes(assumptionKind({ statement: st, category: "" })));
  expect(fitting, "een markt- of gedragsaanname").toBeTruthy();
  await page.getByLabel("Aanname die je toetst", { exact: true }).selectOption({ label: fitting! });
  await page.getByRole("radio", { name: /Landingpage-test/ }).click();
  // Fase B5: kop, ondertitel en werving staan onder Details.
  await page.locator("#tc-details").click();
  await page.getByLabel("Kop (verplicht)", { exact: true }).fill("Vind de perfecte eventlocatie in minuten.");
  await page.getByLabel("Ondertitel", { exact: true }).fill("Een persoonlijke selectie, zonder eindeloos zoeken.");
  // Fase B1b: eerst de drempels vastleggen; daarna rekent ProofLab het aantal deelnemers uit.
  await page.getByRole("button", { name: "Leg drempels vast" }).click();
  await expect(page.getByText(/Je hebt ongeveer \d+ deelnemers nodig/)).toBeVisible();
  await page.getByLabel("Minimale steekproef (verplicht)", { exact: true }).fill("5");
  // Gebruikerstest C3: lager dan het berekende aantal vraagt een motivering.
  const belowReason = page.getByLabel(/Waarom minder deelnemers dan berekend/);
  if (await belowReason.isVisible()) await belowReason.fill("Testomgeving: vijf bezoekers volstaan om de journey te doorlopen.");
  await page.getByRole("radio", { name: "Koud", exact: true }).check();
  await page.getByRole("button", { name: /Test Card opslaan als concept/ }).click();
  // Fase B1a: na opslaan terug op het bord met een bevestiging; daarvandaan naar het concept.
  await page.waitForURL(/\/experiments\?opgeslagen=/);
  await expect(page.getByText("Test Card opgeslagen als concept.")).toBeVisible();
  // Fase B5: de eerste hoofdtest krijgt een voorgestelde go-regel; zonder vastgelegde regel start hij niet.
  await page.getByRole("button", { name: "Leg deze go-regel vast" }).click();
  await expect(page.getByText("Go-regel vastgelegd.")).toBeVisible();
  await page.getByRole("link", { name: "Open het concept →" }).click();
  await page.waitForURL(/\/experiments\/[0-9a-f-]{36}/);
  await page.getByRole("button", { name: "Ter review aanbieden" }).click();
  await expect(page.getByRole("button", { name: "Akkoord: keur goed en vergrendel" })).toBeVisible();
  // Gebruikerstest B4: wie zijn eigen test goedkeurt, vinkt ook de bevestiging bij de melding aan.
  for (const box of await page.locator("input[type=checkbox][name^=check_], input[type=checkbox][name=confirm_self_approval]").all()) await box.check();
  await page.getByRole("button", { name: "Akkoord: keur goed en vergrendel" }).click();
  await expect(page.getByText(/vergrendeld/i).first()).toBeVisible();
  await page.getByRole("button", { name: "Publiceer en start de meting" }).click();
  await expect(page.getByText("Meting loopt")).toBeVisible();
  const link = await page.locator("input[id^=link-]").first().inputValue();

  // 5. Real (test) visitors: cookieless, deduplicated
  const ua = (i: number) => `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 E2E-${i}`;
  const cookies = await visit(browser, link, ua(1), "submit");
  expect(cookies).toHaveLength(0);
  await visit(browser, link, ua(1), "submit"); // same visitor twice: must not double count
  await visit(browser, link, ua(2), "view");
  await visit(browser, link, ua(3), "submit");
  await visit(browser, link, ua(4), "view");
  await visit(browser, link, ua(5), "click");
  await page.reload();
  await expect(page.locator(".live-stat").first()).toContainText("5");
  await expect(page.locator(".live-stat").nth(1)).toContainText("2");
  await expect(page.getByText("Nog geen uitspraak")).toBeVisible();

  // 6. End, analyse, learn, decide
  await page.getByRole("button", { name: "Rond af" }).click();
  await page.getByRole("button", { name: "Analyseer en maak de Learning Card" }).click();
  await page.waitForURL(/\/evidence/);
  // Fase B5: "Daaruit leren we" en "Daarom gaan we" staan er als voorstel; met goedkeuren bevestig je ze.
  await expect(page.getByText(/een voorstel/).first()).toBeVisible();
  await expect(page.locator("textarea[name=we_learned]").first()).not.toHaveValue("");
  await page.getByRole("button", { name: "Keur goed: werk de aanname bij" }).click();
  await page.getByRole("button", { name: "Voer de Reality Check uit" }).click();
  await expect(page.getByText(/Advies:/)).toBeVisible();
  // The decision needs a base rate and the consultant's own forecast at the decision moment.
  await page.goto(`${ideaUrl}/outcome`);
  await page.getByRole("button", { name: "Leg het basispercentage vast" }).click();
  // Once saved, the picker folds away (its own confirmation with it) and the chosen base rate is shown.
  await expect(page.locator("summary", { hasText: "Andere referentie kiezen" })).toBeVisible();
  await page.goto(`${ideaUrl}/evidence`);
  // Eerst voorspellen (golf B, punt 15): de bewijspagina blijft vergrendeld tot de eigen voorspelling er is.
  await expect(page.getByRole("link", { name: /Vul je voorspelling in bij het formulier hiernaast/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bewaar mijn keuze" })).toHaveCount(0);
  // B0 punt 5: het veld is leeg; na invullen staat er wat er wordt vastgelegd.
  const forecast = page.getByLabel("Kans dat het doel wordt gehaald (%)", { exact: true });
  await expect(forecast).toHaveValue("");
  await forecast.fill("30");
  await expect(page.getByText("Je legt 30% vast. Dit kan daarna niet meer veranderen.")).toBeVisible();
  await page.getByLabel("Waarom? (één zin)", { exact: true }).fill("Weinig gedragsbewijs, dus dicht bij het basispercentage.");
  await page.getByRole("button", { name: "Leg mijn voorspelling vast" }).click();
  // The form makes way for the recorded forecast (and the others for this moment).
  await expect(page.getByRole("heading", { name: "Jouw voorspelling" })).toBeVisible();
  await page.getByRole("radio", { name: /Verder testen/ }).click();
  await page.getByLabel("Waarom? (komt in het rapport) (verplicht)", { exact: true }).fill("De steekproef was klein en betaalbereidheid is nog niet getest.");
  await page.getByRole("button", { name: "Bewaar mijn keuze" }).click();
  await expect(page.getByText(/Besluit vastgelegd/)).toBeVisible();
  await page.reload();
  await expectMenuMatchesStepper(page);
  // B1-vervolg: "Verder testen" is geen definitief besluit; de stap Besluit krijgt dan geen vinkje.
  await expect(page.locator("#sidebar a.nav-link[data-step=decide]")).not.toHaveAttribute("data-step-state", "done");

  // 7. Report snapshot with source footnote and decision
  await page.goto(`${ideaUrl}/report`);
  await page.getByRole("button", { name: "Maak het eerste rapport" }).click();
  await expect(page.locator(".report-paper")).toContainText("Verder testen");
  // B6: pagina 1 is het beslisblad; na "Verder testen" is het besluit nog niet beslisbaar.
  await expect(page.locator(".decision-sheet")).toContainText("Nog niet beslisbaar");
  await expect(page.locator(".report-paper")).toContainText("CBS");
  await expect(page.locator(".report-paper")).toContainText("2 van 5");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".sidebar")).toBeHidden();
});

test("beheer: systeemstatus voor de eigenaar, zonder CSP-schendingen", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to (load|execute|apply|connect)/i.test(m.text())) violations.push(m.text());
  });
  await login(page);
  // Fase 3: Systeemstatus staat in het avatarmenu, alleen voor eigenaren.
  await page.getByRole("button", { name: /^Account:/ }).click();
  await page.getByRole("link", { name: "Systeemstatus" }).click();
  await page.waitForURL(/\/app\/status/);
  await expect(page.getByRole("heading", { name: "Systeemstatus", level: 1 })).toBeVisible();
  await expect(page.getByRole("row", { name: /Statusfunctie/ })).toContainText("Aanwezig");
  await expect(page.getByRole("row", { name: /Kernvraag klant/ })).toContainText("Aanwezig");
  await expect(page.getByText("AI-uitgaven deze maand")).toBeVisible();
  expect(violations).toEqual([]);
});

test("mobiel: navigatie als drawer en coach als slide-over @mobile", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Open navigatie" }).click();
  await expect(page.locator(".sidebar.open")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".sidebar.open")).toHaveCount(0);
  await page.getByRole("button", { name: "Open onderzoekscoach" }).click();
  await expect(page.locator(".coach.open")).toBeVisible();
});
