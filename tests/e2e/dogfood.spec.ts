import { expect, test, type Page } from "@playwright/test";
import { createIdeaViaIntake, dutchDate, isoDate } from "./intake";

// "ProofLab op ProofLab": builds the dogfood dossier through the real UI, so every excerpt goes through
// the same live page check and quote verification as a consultant's would. Only literal fragments from
// public pages; nothing is published and no money is spent. Run with `npm run dogfood` (uses
// DOGFOOD_EMAIL/DOGFOOD_PASSWORD, falling back to the E2E account).

const email = process.env.DOGFOOD_EMAIL ?? process.env.E2E_EMAIL ?? "";
const password = process.env.DOGFOOD_PASSWORD ?? process.env.E2E_PASSWORD ?? "";
test.skip(!process.env.DOGFOOD || !email || !password, "Alleen via npm run dogfood");

const TITLE = "ProofLab op ProofLab";
// The outcome definition is a real business target of Link & Lead: it comes from the product owner, never
// from this test (docs/ProofLab_Voorspelkracht_v1.md §5: "verkoopt binnen 6 maanden X validatiesprints").
const OUTCOME_TARGET = process.env.DOGFOOD_OUTCOME_TARGET ?? "";
test.skip(!!process.env.DOGFOOD && !OUTCOME_TARGET, "Zet DOGFOOD_OUTCOME_TARGET: het aantal validatiesprints dat Link & Lead binnen zes maanden wil verkopen");

type Finding = {
  source: { title: string; type: string; url: string; publisher: string; excerpt: string; location: string };
  claim: {
    statement: string; evidenceType: string; section: string; freshness: string; region?: string;
    period: string; supports: string; doesNotProve: string; definition?: string;
  };
};

const today = new Date().toISOString().slice(0, 10);

const FINDINGS: Finding[] = [
  {
    source: {
      title: "Strategyzer — Pricing", type: "primary_document", url: "https://www.strategyzer.com/pricing", publisher: "Strategyzer",
      excerpt: "One subscription, every playbook. $299 a year.", location: "Prijspagina, blok Playbooks",
    },
    claim: {
      statement: "Strategyzer verkoopt toegang tot alle playbooks voor $299 per jaar.",
      evidenceType: "primary_document", section: "pricing", freshness: "price", period: today.slice(0, 4),
      supports: "Het prijsanker voor zelfbediening met een bewezen methode",
      doesNotProve: "Dat Nederlandse opdrachtgevers dit als alternatief voor een begeleide validatiesprint zien",
      definition: "Individueel jaarabonnement, exclusief btw; teamprijzen op aanvraag",
    },
  },
  {
    source: {
      title: "ValidatorAI — homepage", type: "company_page", url: "https://www.validatorai.com", publisher: "ValidatorAI",
      excerpt: "Our free AI tool helps you test your idea, analyze the competition, find your customers, and answers the question every founder asks: is my idea good?",
      location: "Homepage, introductietekst",
    },
    claim: {
      statement: "ValidatorAI biedt een gratis AI-tool die een idee test, de concurrentie analyseert en klanten zoekt.",
      evidenceType: "primary_document", section: "competition", freshness: "product", period: today.slice(0, 4),
      supports: "Dat snelle AI-oordelen over ideeën gratis beschikbaar zijn",
      doesNotProve: "Hoe betrouwbaar die oordelen zijn, of dat ze op echte klantobservaties rusten",
    },
  },
  {
    source: {
      title: "IdeaProof — homepage", type: "company_page", url: "https://ideaproof.io", publisher: "IdeaProof",
      excerpt: "Test Your Idea in 120s — Free AI Startup Validator | IdeaProof", location: "Paginatitel",
    },
    claim: {
      statement: "IdeaProof belooft een AI-validatie van een idee in 120 seconden.",
      evidenceType: "primary_document", section: "competition", freshness: "product", period: today.slice(0, 4),
      supports: "Dat de directe AI-validators op snelheid concurreren",
      doesNotProve: "Wat de validatie inhoudt of hoe vaak gebruikers daarna echt testen",
    },
  },
];

type Competitor = {
  name: string; kind: "direct" | "indirect" | "alternative" | "status_quo"; website?: string; positioning: string;
  buyer?: string; model?: string; price?: string; claim?: string; strengths?: string; weaknesses?: string; diff?: string;
};

const COMPETITORS: Competitor[] = [
  {
    name: "ValidatorAI", kind: "direct", website: "https://www.validatorai.com",
    positioning: "Gratis AI-oordeel over een startupidee", buyer: "Individuele oprichters", model: "Gratis tool",
    claim: FINDINGS[1].claim.statement, strengths: "Laagdrempelig, direct resultaat",
    weaknesses: "Afgeleid: oordeel zonder zichtbare bronnen per bewering en zonder experiment met echte klanten",
    diff: "Elke bewering met letterlijk citaat; oordeel pas na vooraf vergrendelde test",
  },
  {
    name: "IdeaProof", kind: "direct", website: "https://ideaproof.io",
    positioning: "AI-validatie van een startupidee in 120 seconden", buyer: "Individuele oprichters",
    claim: FINDINGS[2].claim.statement, strengths: "Snel, veel onderdelen in één rapport",
    weaknesses: "Afgeleid: snelheid sluit verificatie tegen bronnen en echte klantdata vrijwel uit",
    diff: "Begeleide sprint voor opdrachtgevers met besluit dat de klant zelf bevestigt",
  },
  {
    name: "Rapidly", kind: "direct", website: "https://www.rapidlyai.com",
    positioning: "Onbekend: de website liet geen geautomatiseerde broncontrole toe (botcontrole). Handmatig bekijken.",
  },
  {
    name: "Strategyzer (playbooks en Testing Business Ideas)", kind: "indirect", website: "https://www.strategyzer.com",
    positioning: "Bewezen methode als begeleide werkruimte en training", buyer: "Ondernemers, consultants, teams",
    model: "Abonnement; teams en enterprise op aanvraag", price: "$299 per jaar (individueel, excl. btw)",
    claim: FINDINGS[0].claim.statement, strengths: "Methode met autoriteit; dezelfde basis als ProofLab",
    weaknesses: "Afgeleid: de klant voert zelf uit; geen gemeten experimenten of bronverificatie in de opdracht",
    diff: "ProofLab voert de methode uit met de opdrachtgever en legt het bewijs vast",
  },
  {
    name: "Algemeen diep onderzoek met een AI-assistent", kind: "alternative",
    positioning: "Eigen aanname: consultants laten een AI-assistent een marktrapport schrijven en gebruiken dat als onderbouwing",
    weaknesses: "Eigen aanname: geen controle of citaten letterlijk in de bron staan; geen experimenten",
  },
];

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mailadres", { exact: true }).fill(email);
  await page.getByLabel("Wachtwoord", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Inloggen", exact: true }).click();
  await page.waitForURL(/\/app/);
  await expect(page.getByRole("heading", { name: /Van goed idee naar/ })).toBeVisible();
}

test("dogfood: ProofLab op ProofLab", async ({ page }) => {
  test.setTimeout(6 * 60_000);
  await login(page);
  if (await page.locator("a.idea", { hasText: TITLE }).count()) {
    test.skip(true, `"${TITLE}" bestaat al in deze werkruimte`);
  }

  // Intake (fase B3): drie vragen en één bevestiging.
  const ideaUrl = await createIdeaViaIntake(page, {
    idea: "Een validatiesprint van 4–6 weken voor opdrachtgevers van Link & Lead in MKB, events/MICE en media/cultuur, waarin de consultant met ProofLab marktonderzoek met controleerbare bronnen, experimenten met echte klanten en een besluit vastlegt dat de opdrachtgever bevestigt.",
    decision: `Maken we van ProofLab de vaste werkwijze voor validatiesprints van Link & Lead, en investeren we € 25.000 in een versie voor opdrachtgevers, vóór ${dutchDate(60)}?`,
    uncertainty: "Of opdrachtgevers een sprint met gemeten bewijs meer waard vinden dan een adviesrapport.",
    fill: {
      "Korte naam": TITLE,
      "Doelgroep": "Opdrachtgevers van Link & Lead in MKB, events/MICE en media/cultuur",
      "Inzet (euro)": "25000",
      "Uiterlijke beslisdatum": isoDate(60),
      "Wat meet je?": "verkochte validatiesprints met ProofLab",
      "Doelwaarde": OUTCOME_TARGET,
      "Minimumbedrag per klant (€)": "3000",
      "Geslaagd als…": `Link & Lead verkoopt binnen zes maanden na het besluit minstens ${OUTCOME_TARGET} validatiesprints met ProofLab.`,
    },
    select: { "Soort klant": "Zakelijke klanten (B2B)", "Regio": "Nederland", "Branche": "smb", "Type project": "new_product", "Opdrachtgever": "none" },
  });

  // Sources with literal fragments, checked against the live page, and one finding per fragment
  for (const f of FINDINGS) {
    await page.goto(`${ideaUrl}/research?tab=sources`);
    await page.getByLabel("Titel van de bron", { exact: true }).fill(f.source.title);
    await page.getByLabel("Type bron", { exact: true }).selectOption(f.source.type);
    await page.getByLabel("URL of dataset-ID", { exact: true }).fill(f.source.url);
    await page.getByLabel("Uitgever / instelling", { exact: true }).fill(f.source.publisher);
    await page.getByLabel("Publicatie- of peildatum", { exact: true }).fill(today);
    await page.getByLabel("Relevant fragment (letterlijk overgenomen)", { exact: true }).fill(f.source.excerpt);
    await page.getByLabel("Vindplaats", { exact: true }).fill(f.source.location);
    await page.getByLabel("Primaire bron (eerste publicatie, niet overgenomen)", { exact: true }).check();
    await expect(page.getByLabel("Controleer het fragment op de live pagina", { exact: true })).toBeChecked();
    await page.getByRole("button", { name: "Bron opslaan" }).click();
    await expect(page.getByText(/Bron opgeslagen/)).toBeVisible({ timeout: 30_000 });

    await page.goto(`${ideaUrl}/research?tab=sources`);
    const excerptValue = await page.locator("#cl-ex option", { hasText: f.source.title }).first().getAttribute("value");
    await page.getByLabel("Bronfragment", { exact: true }).selectOption(excerptValue!);
    await page.getByLabel("Bevinding (één zin)", { exact: true }).fill(f.claim.statement);
    await page.getByLabel("Letterlijk citaat uit het fragment", { exact: true }).fill(f.source.excerpt);
    await expect(page.getByText("✓ Citaat staat letterlijk in het fragment.")).toBeVisible();
    await page.getByLabel("Soort informatie", { exact: true }).selectOption(f.claim.evidenceType);
    await page.getByLabel("Onderdeel", { exact: true }).selectOption(f.claim.section);
    await page.getByLabel("Regio", { exact: true }).fill(f.claim.region ?? "Wereldwijd (online aanbod)");
    await page.getByLabel("Peilperiode", { exact: true }).fill(f.claim.period);
    await page.getByLabel("Hoe snel veroudert dit?", { exact: true }).selectOption(f.claim.freshness);
    await page.getByLabel("Wat ondersteunt dit?", { exact: true }).fill(f.claim.supports);
    await page.getByLabel("Wat bewijst dit nog níét?", { exact: true }).fill(f.claim.doesNotProve);
    if (f.claim.definition) await page.getByLabel("Definitie en beperkingen", { exact: true }).fill(f.claim.definition);
    await page.getByRole("button", { name: "Bevinding toetsen en opslaan" }).click();
    await expect(page.getByText(/Bevinding opgeslagen/)).toBeVisible({ timeout: 30_000 });
  }

  // Competitors and alternatives; a price only with a date, otherwise "niet publiek"
  for (const c of COMPETITORS) {
    await page.goto(`${ideaUrl}/research?tab=competitors`);
    await page.getByRole("button", { name: "+ Aanbieder of alternatief" }).click();
    const drawer = page.getByRole("dialog");
    await drawer.getByLabel("Naam", { exact: true }).fill(c.name);
    await drawer.getByLabel("Type", { exact: true }).selectOption(c.kind);
    if (c.website) await drawer.getByLabel("Website", { exact: true }).fill(c.website);
    await drawer.getByLabel("Positionering", { exact: true }).fill(c.positioning);
    if (c.buyer) await drawer.getByLabel("Doelgroep / koper", { exact: true }).fill(c.buyer);
    if (c.model) await drawer.getByLabel("Verdienmodel", { exact: true }).fill(c.model);
    if (c.price) {
      await drawer.getByLabel("Zichtbare prijs (plan, valuta, btw)", { exact: true }).fill(c.price);
      await drawer.getByLabel("Peildatum prijs", { exact: true }).fill(today);
    }
    if (c.claim) {
      const value = await drawer.locator("#co-claim option", { hasText: c.claim.slice(0, 30) }).first().getAttribute("value");
      await drawer.getByLabel("Onderbouwende bevinding", { exact: true }).selectOption(value!);
    }
    if (c.strengths) await drawer.getByLabel("Sterke punten", { exact: true }).fill(c.strengths);
    if (c.weaknesses) await drawer.getByLabel("Zwakke punten (afgeleid)", { exact: true }).fill(c.weaknesses);
    if (c.diff) await drawer.getByLabel("Waar kunnen we ons aantoonbaar onderscheiden?", { exact: true }).fill(c.diff);
    await drawer.getByRole("button", { name: "Opslaan" }).click();
    await expect(page.locator(".competitor-row", { hasText: c.name })).toBeVisible({ timeout: 15_000 });
  }

  // Assumptions from the template; the experiment stays a concept until a human approves it
  await page.goto(`${ideaUrl}/assumptions`);
  await page.getByRole("button", { name: /Begin met de standaardset|Stel aannames voor/ }).click();
  await expect(page.getByRole("heading", { name: "Risicokaart" })).toBeVisible();

  await page.goto(`${ideaUrl}/experiments`);
  await page.getByRole("radio", { name: /interview/i }).click();
  await page.getByLabel("Bij wie? (verplicht)", { exact: true }).fill("Vijf huidige of recente opdrachtgevers van Link & Lead (directie of eigenaar)");
  await page.getByRole("button", { name: "Leg drempels vast" }).click();
  await page.getByRole("button", { name: /Test Card opslaan als concept/ }).click();
  await page.waitForURL(/\/experiments\?opgeslagen=/);
  await page.getByRole("link", { name: "Open het concept →" }).click();
  await page.waitForURL(/\/experiments\/[0-9a-f-]{36}/);
  await expect(page.getByRole("button", { name: "Ter review aanbieden" })).toBeVisible();

  // Every provider and alternative is on the comparison, with its source or an explicit unknown
  await page.goto(`${ideaUrl}/research?tab=competitors`);
  // Header row plus the "niets doen" entry the intake creates itself
  await expect(page.locator(".competitor-row")).toHaveCount(COMPETITORS.length + 2);
  console.log(`Dossier: ${ideaUrl}`);
});
