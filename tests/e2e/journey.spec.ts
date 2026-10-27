import { expect, test, type Browser, type Page } from "@playwright/test";

const email = process.env.E2E_EMAIL ?? "";
const password = process.env.E2E_PASSWORD ?? "";
test.skip(!email || !password, "E2E_EMAIL en E2E_PASSWORD zijn niet gezet");

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByLabel("Wachtwoord").fill(password);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.waitForURL(/\/app/);
  const ws = page.getByLabel("Naam van je bureau of team");
  if (await ws.isVisible().catch(() => false)) {
    await ws.fill("E2E Bureau");
    await page.getByRole("button", { name: "Werkruimte aanmaken" }).click();
    await page.waitForLoadState("networkidle");
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
      await p.getByLabel("E-mailadres (optioneel)").fill(`test+${Date.now()}@example.com`);
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

  // 1. Decision-first intake
  await page.goto("/app/ideas/new");
  await page.getByRole("button", { name: "Is er voldoende markt voor dit aanbod?" }).click();
  await page.getByRole("button", { name: "Volgende stap" }).click();
  const title = `E2E-idee ${Date.now()}`;
  await page.getByLabel("Korte naam").fill(title);
  await page.getByLabel("Mijn idee").fill("Een AI-assistent die zakelijke eventmanagers helpt binnen minuten een passende locatie te vinden.");
  await page.getByRole("button", { name: "Volgende stap" }).click();
  await page.getByRole("button", { name: "Zakelijke klanten (B2B)" }).click();
  await page.getByRole("button", { name: "Volgende stap" }).click();
  await page.getByRole("button", { name: /Nederland/ }).click();
  await page.getByRole("button", { name: "Volgende stap" }).click();
  await page.getByRole("button", { name: "Nieuw product" }).click();
  await page.getByLabel("Opdrachtgever").selectOption("none");
  await page.getByRole("button", { name: "Start de marktverkenning" }).click();
  await page.waitForURL(/\/research/);
  await expect(page.getByRole("heading", { name: "Begrijp je markt." })).toBeVisible();
  const ideaUrl = page.url().replace(/\/research.*$/, "");

  // 2. Source + verified claim
  await page.getByRole("tab", { name: "Bronnen" }).click();
  await page.getByLabel("Titel van de bron").fill("Vestigingen van bedrijven; bedrijfstak, regio");
  await page.getByLabel("Uitgever / instelling").fill("CBS");
  await page.getByLabel("Publicatie- of peildatum").fill("2026-05-01");
  await page.getByLabel("Relevant fragment (letterlijk overgenomen)").fill("In 2026 telde Nederland 41.230 vestigingen in de branche congres- en beursorganisatie.");
  await page.getByLabel("Controleer het fragment op de live pagina").uncheck();
  await page.getByLabel("Primaire bron (eerste publicatie, niet overgenomen)").check();
  await page.getByRole("button", { name: "Bron opslaan" }).click();
  await expect(page.getByText(/Bron opgeslagen/)).toBeVisible();
  await page.getByRole("tab", { name: "Bronnen" }).click();
  await page.getByLabel("Bevinding (één zin)").fill("Nederland telde in 2026 41.230 vestigingen in congres- en beursorganisatie.");
  await page.getByLabel("Letterlijk citaat uit het fragment").fill("In 2026 telde Nederland 41.230 vestigingen in de branche congres- en beursorganisatie.");
  await expect(page.getByText("✓ Citaat staat letterlijk in het fragment.")).toBeVisible();
  await page.getByLabel("Wat bewijst dit nog níét?").fill("Dat deze bedrijven het probleem hebben of willen betalen.");
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
  await page.getByRole("radio", { name: /Landingpage-test/ }).click();
  await page.getByLabel("Kop").fill("Vind de perfecte eventlocatie in minuten.");
  await page.getByLabel("Ondertitel").fill("Een persoonlijke selectie, zonder eindeloos zoeken.");
  await page.getByLabel("Minimale steekproef").fill("5");
  await page.getByRole("button", { name: /Test Card opslaan als concept/ }).click();
  await page.waitForURL(/\/experiments\/[0-9a-f-]{36}/);
  await page.getByRole("button", { name: "Ter review aanbieden" }).click();
  await expect(page.getByText(/Klaar voor review/)).toBeVisible();
  for (const box of await page.locator("input[type=checkbox][name^=check_]").all()) await box.check();
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
  await page.getByRole("button", { name: "Keur goed: werk de aanname bij" }).click();
  await page.getByRole("button", { name: "Voer de Reality Check uit" }).click();
  await expect(page.getByText(/Advies:/)).toBeVisible();
  await page.getByRole("radio", { name: /Verder testen/ }).click();
  await page.getByLabel("Waarom? (komt in het rapport)").fill("De steekproef was klein en betaalbereidheid is nog niet getest.");
  await page.getByRole("button", { name: "Bewaar mijn keuze" }).click();
  await expect(page.getByText(/Besluit vastgelegd/)).toBeVisible();

  // 7. Report snapshot with source footnote and decision
  await page.goto(`${ideaUrl}/report`);
  await page.getByRole("button", { name: "Maak het eerste rapport" }).click();
  await expect(page.locator(".report-paper")).toContainText("Verder testen");
  await expect(page.locator(".report-paper")).toContainText("CBS");
  await expect(page.locator(".report-paper")).toContainText("2 van 5");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".sidebar")).toBeHidden();
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
