// Fase B2, punt 1: onderzoeksvragen afgeleid van de intake, met één beslissende vraag.
//
// Het sjabloon (lib/domain/research-plan.ts) kreeg tot nu toe de brede doelgroepcategorie ("Zakelijke klanten
// (B2B)"). Hier krijgt het de specifieke doelgroep uit de intake ("zelfstandige NVM-kantoren met 2–15
// medewerkers"), het specifieke gebied, het aanbod (de naam van het idee) en de prijs die de consultant noemde. De
// vraag die de grootste onzekerheid raakt, wordt de beslissende vraag: die gaat in elke onderzoeksrun eerst.
//
// Puur (geen database, geen AI), zodat de afleiding met unittests vastligt.

import { splitQuestion, templatePlan, type PlanQuestion } from "@/lib/domain/research-plan";
import type { ProjectType, SectorTemplate } from "@/lib/domain/labels";

export type IntakeFacts = {
  title: string;
  description?: string | null;
  decision_question?: string | null;
  target_audience: string;
  audience_detail?: string | null;
  // Gebruikerstest D8: de korte doelgroep voor in zinnen ("amateursportclubs"), bevestigd in de intake.
  audience_short?: string | null;
  region: string;
  region_detail?: string | null;
  project_type: string;
  sector_template: string;
  key_uncertainty?: string | null;
  outcome_min_value_per_customer?: number | null;
  // Fase B3: de prijs uit de bevestigde intake (ideas.offer_price), als die er is.
  offer_price?: string | null;
};

// Waar de grootste onzekerheid over gaat.
export type UncertaintyTopic = "pricing" | "size" | "problem" | "alternatives" | "channels" | "other";

const clean = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/\s+/g, " ")
    .replace(/[?.!]+$/, "")
    .trim();

// Gebruikerstest D8: een korte doelgroep uit de toelichting, voor in vragen en kopjes. Afgebroken op een bijzin of
// nadere bepaling ("met", "van", "in", "die", een komma of haakje) en hooguit zes woorden: "amateursportclubs met
// 100–500 leden in Nederland" wordt "amateursportclubs". Null als er niets bruikbaars overblijft.
export const AUDIENCE_SHORT_MAX = 60;
export function shortAudience(detail: string | null | undefined): string | null {
  const s = clean(detail);
  if (!s) return null;
  const head = s.split(/\s+(?:met|van|in|die|dat|waar|zonder)\s+|[,;:(]|\s[–-]\s/i)[0]?.trim() ?? "";
  const words = head.split(" ").filter(Boolean).slice(0, 6).join(" ");
  if (words.length < 2) return null;
  return words.length > AUDIENCE_SHORT_MAX ? words.slice(0, AUDIENCE_SHORT_MAX).replace(/\s+\S*$/, "") : words;
}

// De korte doelgroep: bevestigd in de intake, anders afgeleid uit de toelichting. Null als er geen toelichting is.
export function shortAudienceOf(i: Pick<IntakeFacts, "audience_detail" | "audience_short">): string | null {
  return clean(i.audience_short) || shortAudience(i.audience_detail);
}

// De doelgroep zo specifiek als de intake hem noemt, maar kort genoeg voor in een zin (D8): eerst de bevestigde korte
// doelgroep, dan de afgeleide korte vorm, dan de toelichting, dan de brede categorie.
export function specificAudience(i: Pick<IntakeFacts, "target_audience" | "audience_detail" | "audience_short">): string {
  return shortAudienceOf(i) || clean(i.audience_detail) || clean(i.target_audience) || "klanten";
}

// Het gebied zo specifiek als de intake het noemt (bijv. "Randstad" binnen "Nederland").
export function specificRegion(i: Pick<IntakeFacts, "region" | "region_detail">): string {
  return clean(i.region_detail) || clean(i.region) || "Nederland";
}

// Het aanbod: de korte naam van het idee.
export function offerName(i: Pick<IntakeFacts, "title">): string {
  return clean(i.title) || "dit aanbod";
}

const PERIOD = "(?:per|\\/|p\\/?)\\s*(maand|mnd|jaar|jr|kwartaal|week|gebruiker|kantoor|licentie|klant|stuk|maand per kantoor)";
const AMOUNT = "(\\d{1,3}(?:[.\\s]\\d{3})+(?:,\\d{1,2})?|\\d+(?:,\\d{1,2})?)";
const PRICE_RE = [
  new RegExp(`(?:€|eur\\b|euro\\b)\\s?${AMOUNT}(?:\\s*,-)?(?:\\s*euro)?(?:\\s*${PERIOD})?`, "i"),
  new RegExp(`${AMOUNT}\\s?(?:euro|eur)\\b(?:\\s*${PERIOD})?`, "i"),
];

const PERIOD_WORD: Record<string, string> = { mnd: "maand", jr: "jaar" };

// Een bedrag dat de consultant zelf als prijs noemde, als "€ 249 per maand": eerst uit de grootste onzekerheid, dan
// uit de beschrijving (daar alleen met een periode, zodat een investeringsbedrag geen prijs wordt). Het bedrag in de
// beslisvraag is de inzet, geen prijs. Zonder genoemde prijs: de minimale waarde per klant uit de
// uitkomstdefinitie, of null.
export function priceFromIntake(i: Pick<IntakeFacts, "key_uncertainty" | "description" | "outcome_min_value_per_customer" | "offer_price">): string | null {
  // Fase B3: de prijs die de consultant in de intake bevestigde, gaat voor alles.
  const offer = clean(i.offer_price);
  if (offer) {
    for (const re of PRICE_RE) {
      const m = re.exec(offer);
      if (!m) continue;
      const period = m[2] ? (PERIOD_WORD[m[2].toLowerCase()] ?? m[2].toLowerCase()) : null;
      return `€ ${m[1].replace(/\s/g, ".")}${period ? ` per ${period}` : ""}`;
    }
    return offer;
  }
  for (const [text, needsPeriod] of [
    [i.key_uncertainty, false],
    [i.description, true],
  ] as const) {
    if (!text) continue;
    for (const re of PRICE_RE) {
      const m = re.exec(text);
      if (!m || (needsPeriod && !m[2])) continue;
      const amount = m[1].replace(/\s/g, ".");
      const period = m[2] ? (PERIOD_WORD[m[2].toLowerCase()] ?? m[2].toLowerCase()) : null;
      return `€ ${amount}${period ? ` per ${period}` : ""}`;
    }
  }
  const min = i.outcome_min_value_per_customer;
  if (typeof min === "number" && Number.isFinite(min) && min > 0) return `€ ${Math.round(min).toLocaleString("nl-NL")} per klant`;
  return null;
}

const TOPIC_WORDS: [UncertaintyTopic, RegExp][] = [
  ["pricing", /betal|prijs|prijz|€|\beuro\b|tarief|abonnement|kost(en|t)? .*per|budget|geld voor|waard vinden|verdien/i],
  ["alternatives", /concurrent|alternatie|gratis|al (een )?oplossing|overstap|bestaande (tool|software|oplossing)/i],
  ["channels", /kanaal|kanalen|bereik|werven|acquisitie|vinden we|marketing|leads/i],
  ["size", /hoeveel (bedrijven|klanten|kantoren|mensen|organisaties)|marktomvang|markt groot|aantal (bedrijven|klanten)|groot genoeg/i],
  ["problem", /probleem|behoefte|pijn|nodig hebben|urgent|last van|willen ze (dit|het)|gebruiken ze|interesse/i],
];

// Het onderwerp van de grootste onzekerheid (of, zonder onzekerheid, van de beslisvraag).
export function uncertaintyTopic(text: string | null | undefined): UncertaintyTopic {
  const t = clean(text);
  if (!t) return "other";
  for (const [topic, re] of TOPIC_WORDS) if (re.test(t)) return topic;
  return "other";
}

const SOURCE_TOPIC: Partial<Record<string, UncertaintyTopic>> = {
  official_statistic: "size",
  pricing_page: "pricing",
  company_page: "alternatives",
  industry_report: "channels",
  customer_research: "problem",
};

// Het onderwerp van een onderzoeksvraag: eerst de woorden van de vraag, dan het verwachte brontype.
export function questionTopic(q: { question: string; expected_source?: string | null }): UncertaintyTopic {
  const byWords = uncertaintyTopic(q.question);
  if (byWords !== "other") return byWords;
  return (q.expected_source && SOURCE_TOPIC[q.expected_source]) || "other";
}

const perUnit = (price: string | null) => (price && /per jaar/.test(price) ? "euro per klant per jaar" : "euro per klant per maand");

// De beslissende vraag: enkelvoudig en meetbaar, met de specifieke doelgroep, het gebied, het aanbod en (bij een
// prijsvraag) de genoemde prijs.
export function decisiveQuestionFor(i: IntakeFacts): PlanQuestion {
  const a = specificAudience(i);
  const r = specificRegion(i);
  const offer = offerName(i);
  const u = clean(i.key_uncertainty);
  const topic = uncertaintyTopic(u || i.decision_question);
  const why = u ? `Dit is de grootste onzekerheid uit de intake (${u}); het antwoord kan de beslissing omdraaien.` : "Deze vraag raakt de beslissing het meest.";
  const base = (q: Omit<PlanQuestion, "why_it_matters">): PlanQuestion => ({ ...q, why_it_matters: why });
  switch (topic) {
    case "pricing": {
      const price = priceFromIntake(i);
      // Een minimale waarde per klant is geen prijs: dan vragen we wat ze willen betalen.
      const named = price && !/per klant$/.test(price) ? price : null;
      return base({
        question: named ? `Willen ${a} in ${r} ${named} betalen voor ${offer}?` : `Hoeveel willen ${a} in ${r} betalen voor ${offer}?`,
        data_needed: `Prijzen van vergelijkbare en gratis alternatieven, wat ${a} nu uitgeven en signalen van betalingsbereidheid${named ? ` rond ${named}` : ""}.`,
        suggested_sources: "Prijspagina's van aanbieders (ook gratis varianten), brancheorganisaties, interviews met betalers en een prijs-/aanbodtest.",
        method: "both",
        done_criterion: "Minstens 3 gedateerde prijspunten van alternatieven (ook gratis) met bron, en een prijs-/aanbodtest met vooraf vastgelegde drempel.",
        unit: perUnit(price),
        expected_source: "pricing_page",
      });
    }
    case "alternatives":
      return base({
        question: `Welke oplossingen gebruiken ${a} in ${r} nu in plaats van ${offer}?`,
        data_needed: "Directe en indirecte aanbieders, gratis alternatieven, de huidige werkwijze en de optie niets te doen.",
        suggested_sources: "Websites en prijspagina's van aanbieders, reviewsites, brancheorganisaties, interviews.",
        method: "both",
        done_criterion: "Minstens 3 alternatieven per type (direct, indirect, huidig alternatief) met bron en prijs of 'niet publiek'.",
        unit: "aantal alternatieven per type",
        expected_source: "company_page",
      });
    case "channels":
      return base({
        question: `Wat kost het om één klant uit de groep ${a} in ${r} te werven?`,
        data_needed: `Kanalen waar ${a} zitten, indicatieve wervingskosten en het koopproces.`,
        suggested_sources: "Kanaalbenchmarks, brancheplatforms, interviews over hoe men nu zoekt en koopt.",
        method: "both",
        done_criterion: "Twee kanalen met een onderbouwde schatting van bereik en kosten, plus een testbaar kanaal.",
        unit: "euro per geworven klant",
        expected_source: "industry_report",
      });
    case "size":
      return base({
        question: `Hoeveel ${a} zijn er in ${r}?`,
        data_needed: `Aantal ${a} in ${r} dat aan de doelgroepcriteria voldoet, met peiljaar en definitie.`,
        suggested_sources: "CBS StatLine, brancheorganisaties, KVK.",
        method: "desk",
        done_criterion: "Eén geverifieerd basisaantal met bron, peiljaar en definitie, of expliciet 'niet vastgesteld'.",
        unit: "aantal bedrijven of personen",
        expected_source: "official_statistic",
      });
    case "problem":
      return base({
        question: `Hoe vaak ervaren ${a} in ${r} het probleem dat ${offer} oplost?`,
        data_needed: `Concrete recente voorbeelden van het probleem bij ${a}, met frequentie en gevolgen.`,
        suggested_sources: "Klantinterviews over gedrag in het verleden; publieke reviews en fora als aanvulling.",
        method: "customer",
        done_criterion: `Minstens 5 interviews met ${a} met letterlijke citaten over recent gedrag.`,
        unit: "keer per maand, en aandeel van de geïnterviewden",
        expected_source: "customer_research",
      });
    default: {
      // Een eigen onzekerheid zonder herkend onderwerp: de onzekerheid zelf, enkelvoudig gemaakt.
      const own = u ? splitQuestion(u)[0].replace(/\?$/, "") : "";
      return base({
        question: own ? `Wat zeggen bronnen over ${a} in ${r} op dit punt: ${own.charAt(0).toLowerCase()}${own.slice(1)}?` : `Wat is de grootste drempel voor ${a} in ${r} om ${offer} te kiezen?`,
        data_needed: "Bronnen en klantsignalen die de onzekerheid bevestigen of ontkrachten, met datum.",
        suggested_sources: "Branchebronnen, reviews, interviews.",
        method: "both",
        done_criterion: "Minstens 2 bronnen of 5 interviews die de onzekerheid onderbouwen of weerspreken.",
        unit: "aantal onderbouwde bevindingen",
        expected_source: "other",
      });
    }
  }
}

export type DerivedPlan = { questions: PlanQuestion[]; decisiveIndex: number };

// De onderzoekskaart voor een nieuw dossier: het sjabloon met de specifieke doelgroep en het specifieke gebied,
// waarin de beslissende vraag de sjabloonvraag over hetzelfde onderwerp vervangt (of, zonder zo'n vraag, de laatste).
// De volgorde van het sjabloon blijft, zodat een bestaande sjabloonkaart per positie kan worden bijgewerkt.
export function derivePlan(i: IntakeFacts): DerivedPlan {
  const base = templatePlan(i.project_type as ProjectType, i.sector_template as SectorTemplate, { audience: specificAudience(i), region: specificRegion(i), targetAudience: i.target_audience });
  const decisive = decisiveQuestionFor(i);
  const topic = questionTopic(decisive);
  let at = topic === "other" ? -1 : base.findIndex((q) => questionTopic(q) === topic);
  if (at < 0) at = Math.min(base.length, 5) - 1;
  const questions = base.slice(0, 5);
  questions[at] = decisive;
  return { questions, decisiveIndex: at };
}

// Welke van de bestaande vragen de grootste onzekerheid raakt. Een vraag die de genoemde prijs letterlijk noemt
// wint; daarna de eerste vraag met hetzelfde onderwerp; -1 als geen vraag het onderwerp raakt.
export function pickDecisiveIndex(questions: { question: string; expected_source?: string | null }[], i: IntakeFacts): number {
  if (questions.length === 0) return -1;
  const topic = uncertaintyTopic(clean(i.key_uncertainty) || i.decision_question);
  if (topic === "other") return -1;
  const same = questions.map((q, idx) => ({ q, idx })).filter(({ q }) => questionTopic(q) === topic);
  if (same.length === 0) return -1;
  const price = topic === "pricing" ? priceFromIntake(i) : null;
  const amount = price?.match(/€ ([\d.,]+)/)?.[1];
  const withPrice = amount ? same.find(({ q }) => q.question.includes(amount)) : undefined;
  return (withPrice ?? same[0]).idx;
}

// Of een vraag nog de brede sjabloontekst draagt terwijl de intake een specifiekere doelgroep noemt.
export function isGenericTemplate(q: { question: string; origin?: string | null }, i: IntakeFacts): boolean {
  if (q.origin !== "template") return false;
  // D8: een vraag met de korte doelgroep of de volledige toelichting is specifiek.
  const specific = specificAudience(i);
  const detail = clean(i.audience_detail);
  return detail.length > 0 && !q.question.includes(specific) && !q.question.includes(detail);
}

// De vragen in onderzoeksvolgorde: de beslissende vraag eerst, daarna de rest op positie (zonder markering: de
// eerste vraag eerst, zoals voor fase B2).
export function decisiveFirst<Q extends { id: string; position: number; is_decisive?: boolean }>(questions: Q[]): Q[] {
  const sorted = [...questions].sort((a, b) => a.position - b.position);
  const at = sorted.findIndex((q) => q.is_decisive === true);
  if (at <= 0) return sorted;
  return [sorted[at], ...sorted.slice(0, at), ...sorted.slice(at + 1)];
}
