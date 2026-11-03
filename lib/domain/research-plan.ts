// Research map: at most five decisive questions per idea. These templates are the fallback
// when no AI is configured, and the reference the AI planner is checked against.
//
// Elke vraag is enkelvoudig en meetbaar: één vraag, met een meeteenheid en het soort bron dat het antwoord moet
// leveren. Het sjabloon vult doelgroep, regio en branche uit de intake in; er blijven nooit plaatshouders over.

import { SECTOR_TEMPLATES, type ProjectType, type SectorTemplate } from "./labels";

// Het soort bron dat het antwoord op een vraag moet leveren (research_questions.expected_source).
export const EXPECTED_SOURCES = {
  official_statistic: "Officiële statistiek",
  industry_report: "Branchrapport",
  pricing_page: "Prijspagina",
  customer_research: "Klantonderzoek",
  company_page: "Bedrijfswebsite",
  internal_data: "Eigen gegevens",
  other: "Overig",
} as const;
export type ExpectedSource = keyof typeof EXPECTED_SOURCES;
export const EXPECTED_SOURCE_KEYS = Object.keys(EXPECTED_SOURCES) as [ExpectedSource, ...ExpectedSource[]];
export const isExpectedSource = (v: unknown): v is ExpectedSource => typeof v === "string" && v in EXPECTED_SOURCES;

export type PlanQuestion = {
  question: string;
  why_it_matters: string;
  data_needed: string;
  suggested_sources: string;
  method: "desk" | "customer" | "both";
  done_criterion: string;
  unit: string;
  expected_source: ExpectedSource;
};

// Wat het sjabloon uit de intake invult.
export type PlanContext = { audience: string; region: string };

type Ctx = { a: string; r: string; b: string };
type Template = (c: Ctx) => PlanQuestion;

const size: Template = ({ a, r, b }) => ({
  question: `Hoeveel ${a} zijn er in ${r}${b}?`,
  why_it_matters: "Zonder een herleidbaar aantal potentiële klanten is elke omzetprognose een gok.",
  data_needed: `Aantal ${a} in ${r} dat aan de doelgroepcriteria voldoet, met peiljaar en definitie.`,
  suggested_sources: "CBS StatLine, Eurostat, brancheorganisaties, KVK.",
  method: "desk",
  done_criterion: "Eén geverifieerd basisaantal met bron, peiljaar en definitie, of expliciet 'niet vastgesteld'.",
  unit: "aantal bedrijven of personen",
  expected_source: "official_statistic",
});
const problem: Template = ({ a, r }) => ({
  question: `Hoe vaak ervaren ${a} in ${r} het probleem dat dit idee oplost?`,
  why_it_matters: "Een idee zonder urgent probleem verkoopt niet, hoe goed de oplossing ook is.",
  data_needed: `Concrete recente voorbeelden van het probleem bij ${a}, met frequentie en gevolgen.`,
  suggested_sources: "Klantinterviews over gedrag in het verleden; publieke reviews en fora als aanvulling.",
  method: "customer",
  done_criterion: `Minstens 5 interviews met ${a} met letterlijke citaten over recent gedrag.`,
  unit: "keer per maand, en aandeel van de geïnterviewden",
  expected_source: "customer_research",
});
const alternatives: Template = ({ a, r }) => ({
  question: `Welke oplossingen gebruiken ${a} in ${r} nu, inclusief niets doen?`,
  why_it_matters: "De grootste concurrent is vaak Excel, het eigen netwerk of de bestaande gewoonte.",
  data_needed: "Directe en indirecte aanbieders, huidige alternatieven en de optie niets te doen.",
  suggested_sources: "Websites en prijspagina's van aanbieders, reviewsites, interviews.",
  method: "both",
  done_criterion: "Minstens 3 alternatieven per type (direct, indirect, huidig alternatief) met bron.",
  unit: "aantal alternatieven per type",
  expected_source: "company_page",
});
const pricing: Template = ({ a, r }) => ({
  question: `Wat betalen ${a} in ${r} nu per jaar voor vergelijkbare oplossingen?`,
  why_it_matters: "Bestaande uitgaven zijn het beste anker voor een realistische prijs.",
  data_needed: `Publieke prijspunten met datum, budgetten en huidige uitgaven van ${a}.`,
  suggested_sources: "Prijspagina's van concurrenten, offertes, interviews over huidige uitgaven.",
  method: "both",
  done_criterion: "Minstens 3 gedateerde prijspunten of uitgaven; ontbrekende prijzen als 'niet publiek'.",
  unit: "euro per klant per jaar",
  expected_source: "pricing_page",
});
const channels: Template = ({ a, r }) => ({
  question: `Wat kost het om één klant uit de groep ${a} in ${r} te werven via het beste kanaal?`,
  why_it_matters: "Een goed product dat niemand bereikt, groeit niet.",
  data_needed: `Kanalen waar ${a} zitten, indicatieve wervingskosten en het koopproces.`,
  suggested_sources: "Kanaalbenchmarks, brancheplatforms, interviews over hoe men nu zoekt en koopt.",
  method: "both",
  done_criterion: "Twee kanalen met een onderbouwde schatting van bereik en kosten, plus een testbaar kanaal.",
  unit: "euro per geworven klant",
  expected_source: "industry_report",
});

const PLANS: Record<ProjectType, Template[]> = {
  new_business: [size, problem, alternatives, pricing, channels],
  new_product: [problem, alternatives, size, pricing, channels],
  expansion: [
    size,
    (c) => ({ ...channels(c), question: `Via welk kanaal bereiken we ${c.a} in ${c.r} tegen de laagste kosten per klant?` }),
    alternatives,
    pricing,
    ({ a, r }) => ({
      question: `Welke investering is nodig om ${a} in ${r} te kunnen bedienen?`,
      why_it_matters: "Uitbreiding faalt vaak op capaciteit, niet op vraag.",
      data_needed: "Benodigde capaciteit, partners, investering en doorlooptijd.",
      suggested_sources: "Interne gegevens, leveranciers, branchecijfers.",
      method: "desk",
      done_criterion: "Een overzicht van kritieke randvoorwaarden met eigenaar en onzekerheid.",
      unit: "euro investering en fte",
      expected_source: "internal_data",
    }),
  ],
  revenue_model: [
    pricing,
    ({ a }) => ({
      question: `Welk aandeel van ${a} kiest een betaalde variant in een prijs-/aanbodtest?`,
      why_it_matters: "Een verdienmodel staat of valt met acceptatie in het koopgedrag.",
      data_needed: "Keuzes en bezwaren bij concrete prijsvarianten, gemeten in gedrag.",
      suggested_sources: "Prijs-/aanbodtest, interviews met betalers, vergelijkbare modellen.",
      method: "customer",
      done_criterion: "Een prijs-/aanbodtest met vooraf vastgelegde drempel.",
      unit: "% van de bezoekers",
      expected_source: "customer_research",
    }),
    () => ({
      question: "Wat is de brutomarge per klant in dit verdienmodel?",
      why_it_matters: "Meer omzet met slechtere marges maakt het bedrijf niet gezonder.",
      data_needed: "Kostprijs, wervingskosten, klantverloop en brutomarge.",
      suggested_sources: "Eigen administratie, leveranciers, benchmarks.",
      method: "desk",
      done_criterion: "Ingevulde unit economics met bron of aanname per waarde.",
      unit: "euro per klant per jaar",
      expected_source: "internal_data",
    }),
    alternatives,
    size,
  ],
  internal_innovation: [
    () => ({
      question: "Aan welk meetbaar strategisch doel van de organisatie draagt dit idee bij?",
      why_it_matters: "Zonder strategische fit krijgt een interne innovatie geen draagvlak of budget.",
      data_needed: "Strategische doelen, betrokken stakeholders en hun beslissingscriteria.",
      suggested_sources: "Strategiedocumenten, interviews met budgethouders.",
      method: "both",
      done_criterion: "Een expliciete koppeling aan een doel met meetbare indicator en eigenaar.",
      unit: "indicator met streefwaarde",
      expected_source: "internal_data",
    }),
    problem,
    ({ a }) => ({
      question: `Hoeveel kritieke randvoorwaarden (systemen, regels, capaciteit) ontbreken nog om dit idee voor ${a} uit te voeren?`,
      why_it_matters: "Interne innovaties stranden vaak op IT, juridische of operationele drempels.",
      data_needed: "Benodigde capaciteit, systemen, juridische randvoorwaarden en afhankelijkheden.",
      suggested_sources: "IT, juridische afdeling, operations, vergelijkbare projecten.",
      method: "desk",
      done_criterion: "Een lijst kritieke randvoorwaarden met status en eigenaar.",
      unit: "aantal randvoorwaarden",
      expected_source: "internal_data",
    }),
    alternatives,
    () => ({
      question: "Op basis van welk criterium beslist de budgethouder over dit idee?",
      why_it_matters: "Draagvlak bij de budgethouder bepaalt of het idee doorgaat.",
      data_needed: "Beslissers, hun criteria en eerdere besluiten over vergelijkbare initiatieven.",
      suggested_sources: "Gesprekken met stakeholders, eerdere businesscases.",
      method: "customer",
      done_criterion: "Gesprekken met minstens de budgethouder en één gebruiker, met citaten.",
      unit: "beslissingscriterium met drempelwaarde",
      expected_source: "customer_research",
    }),
  ],
};

const SECTOR_NOTES: Record<SectorTemplate, string> = {
  generic: "",
  smb: "Let op betaalbereidheid bij kleine budgetten en de rol van de ondernemer als gebruiker én beslisser.",
  events: "Houd rekening met seizoensinvloed en lange leadtijden: meet eerder aanvragen dan boekingen.",
  media_culture:
    "Levensvatbaarheid kan via leden, subsidie, donaties of bereik lopen in plaats van directe betaling.",
};

const clean = (s: string) => s.replace(/\s+/g, " ").replace(/[?.!]+$/, "").trim();

export function templatePlan(projectType: ProjectType, sector: SectorTemplate, ctx: PlanContext): PlanQuestion[] {
  const note = SECTOR_NOTES[sector];
  const c: Ctx = {
    a: clean(ctx.audience) || "klanten",
    r: clean(ctx.region) || "Nederland",
    b: sector === "generic" ? "" : ` in de branche ${SECTOR_TEMPLATES[sector]}`,
  };
  return PLANS[projectType]
    .map((t) => t(c))
    .map((q) => (note ? { ...q, why_it_matters: `${q.why_it_matters} ${note}` } : q))
    .slice(0, 5);
}

// ---------------------------------------------------------------------------
// Samengestelde vragen splitsen (nabewerking van het AI-plan)
// ---------------------------------------------------------------------------
// "Hoe groot is de markt en wat betalen klanten?" wordt twee vragen; ook meerdere vraagtekens in één vraag. Een
// staartje zonder eigen inhoud (", en waarom?") valt weg: de vraag blijft enkelvoudig en meetbaar.

const QUESTION_START =
  "wat|hoe|hoeveel|welke|welk|wie|waar|wanneer|waarom|waardoor|waarmee|in hoeverre|is|zijn|kan|kunnen|wil|willen|heeft|hebben|betalen|gebruiken|bestaat|bestaan";
const CONNECTOR = new RegExp(`\\s*,?\\s+(?:en|of)\\s+(?=(?:${QUESTION_START})\\b)`, "i");

const asQuestion = (s: string) => {
  const t = s.trim().replace(/[,;:\s]+$/, "").replace(/\?+$/, "").trim();
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}?` : "";
};
const words = (s: string) => s.replace(/\?/g, "").trim().split(/\s+/).filter(Boolean).length;

export function splitQuestion(text: string): string[] {
  const out: string[] = [];
  // Meerdere vraagtekens: elke deelzin met een vraagteken is een eigen vraag.
  const segments = text
    .split(/(?<=\?)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const seg of segments) {
    let rest = seg;
    for (;;) {
      const m = CONNECTOR.exec(rest);
      if (!m) break;
      const left = rest.slice(0, m.index);
      const right = rest.slice(m.index + m[0].length);
      if (words(left) < 3) break;
      out.push(asQuestion(left));
      // Een staart als "waarom?" heeft geen eigen inhoud: weglaten.
      if (words(right) < 3) {
        rest = "";
        break;
      }
      rest = right;
    }
    if (rest && words(rest) >= 2) out.push(asQuestion(rest));
  }
  return out.length ? out : [asQuestion(text)];
}

// Splitst samengestelde vragen en houdt er hooguit `max` over: eerst het eerste deel van elke oorspronkelijke
// vraag, dan de extra delen, in de oorspronkelijke volgorde.
export function splitCompoundQuestions<Q extends { question: string }>(questions: Q[], max = 5): Q[] {
  const parts = questions.map((q) => splitQuestion(q.question).map((text) => ({ ...q, question: text })));
  const keep = new Set<Q>();
  for (const p of parts) if (p[0] && keep.size < max) keep.add(p[0]);
  for (const p of parts) for (const extra of p.slice(1)) if (keep.size < max) keep.add(extra);
  return parts.flat().filter((q) => keep.has(q));
}
