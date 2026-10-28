// Research map: at most five decisive questions per idea. These templates are the fallback
// when no AI is configured, and the reference the AI planner is checked against.

import type { ProjectType, SectorTemplate } from "./labels";

export type PlanQuestion = {
  question: string;
  why_it_matters: string;
  data_needed: string;
  suggested_sources: string;
  method: "desk" | "customer" | "both";
  done_criterion: string;
};

const size: PlanQuestion = {
  question: "Hoe groot is de relevante doelgroep in het gekozen gebied?",
  why_it_matters: "Zonder een herleidbaar aantal potentiële klanten is elke omzetprognose een gok.",
  data_needed: "Aantal organisaties of personen dat aan de doelgroepcriteria voldoet, met peiljaar en definitie.",
  suggested_sources: "CBS StatLine, Eurostat, brancheorganisaties, KVK.",
  method: "desk",
  done_criterion: "Eén geverifieerd basisaantal met bron, peiljaar en definitie, of expliciet 'niet vastgesteld'.",
};
const problem: PlanQuestion = {
  question: "Welk probleem ervaart de doelgroep werkelijk, en hoe vaak?",
  why_it_matters: "Een idee zonder urgent probleem verkoopt niet, hoe goed de oplossing ook is.",
  data_needed: "Concrete recente voorbeelden van het probleem, frequentie en gevolgen.",
  suggested_sources: "Klantinterviews over gedrag in het verleden; publieke reviews en fora als aanvulling.",
  method: "customer",
  done_criterion: "Minstens 5 interviews uit de doelgroep met letterlijke citaten over recent gedrag.",
};
const alternatives: PlanQuestion = {
  question: "Welke oplossingen gebruiken mensen nu, inclusief niets doen?",
  why_it_matters: "De grootste concurrent is vaak Excel, het eigen netwerk of de bestaande gewoonte.",
  data_needed: "Directe en indirecte aanbieders, huidige alternatieven en de optie niets te doen.",
  suggested_sources: "Websites en prijspagina's van aanbieders, reviewsites, interviews.",
  method: "both",
  done_criterion: "Minstens 3 alternatieven per type (direct, indirect, huidig alternatief) met bron.",
};
const pricing: PlanQuestion = {
  question: "Wat betalen klanten nu al voor vergelijkbare oplossingen?",
  why_it_matters: "Bestaande uitgaven zijn het beste anker voor een realistische prijs.",
  data_needed: "Publieke prijspunten met datum, budgetten en huidige uitgaven van de doelgroep.",
  suggested_sources: "Prijspagina's van concurrenten, offertes, interviews over huidige uitgaven.",
  method: "both",
  done_criterion: "Minstens 3 gedateerde prijspunten of uitgaven; ontbrekende prijzen als 'niet publiek'.",
};
const channels: PlanQuestion = {
  question: "Hoe bereiken we deze klanten tegen acceptabele kosten?",
  why_it_matters: "Een goed product dat niemand bereikt, groeit niet.",
  data_needed: "Kanalen waar de doelgroep zit, indicatieve wervingskosten en het koopproces.",
  suggested_sources: "Kanaalbenchmarks, brancheplatforms, interviews over hoe men nu zoekt en koopt.",
  method: "both",
  done_criterion: "Twee kanalen met een onderbouwde schatting van bereik en kosten, plus een testbaar kanaal.",
};

const PLANS: Record<ProjectType, PlanQuestion[]> = {
  new_business: [size, problem, alternatives, pricing, channels],
  new_product: [problem, alternatives, size, pricing, channels],
  expansion: [
    size,
    { ...channels, question: "Via welke kanalen bereiken we de nieuwe markt, en wat kost dat?" },
    alternatives,
    pricing,
    {
      question: "Wat moet er operationeel veranderen om de uitbreiding te leveren?",
      why_it_matters: "Uitbreiding faalt vaak op capaciteit, niet op vraag.",
      data_needed: "Benodigde capaciteit, partners, investering en doorlooptijd.",
      suggested_sources: "Interne gegevens, leveranciers, branchecijfers.",
      method: "desk",
      done_criterion: "Een overzicht van kritieke randvoorwaarden met eigenaar en onzekerheid.",
    },
  ],
  revenue_model: [
    pricing,
    {
      question: "Welk prijsmodel accepteert de doelgroep, en waarom?",
      why_it_matters: "Een verdienmodel staat of valt met acceptatie in het koopgedrag.",
      data_needed: "Voorkeuren en bezwaren bij concrete prijsvarianten, liefst gemeten in gedrag.",
      suggested_sources: "Prijs-/aanbodtest, interviews met betalers, vergelijkbare modellen.",
      method: "customer",
      done_criterion: "Een prijs-/aanbodtest met vooraf vastgelegde drempel.",
    },
    {
      question: "Wat zijn de marges en kosten per klant in dit model?",
      why_it_matters: "Meer omzet met slechtere marges maakt het bedrijf niet gezonder.",
      data_needed: "Kostprijs, wervingskosten, klantverloop en brutomarge.",
      suggested_sources: "Eigen administratie, leveranciers, benchmarks.",
      method: "desk",
      done_criterion: "Ingevulde unit economics met bron of aanname per waarde.",
    },
    alternatives,
    size,
  ],
  internal_innovation: [
    {
      question: "Welk strategisch doel van de organisatie dient dit, en hoe meten we dat?",
      why_it_matters: "Zonder strategische fit krijgt een interne innovatie geen draagvlak of budget.",
      data_needed: "Strategische doelen, betrokken stakeholders en hun beslissingscriteria.",
      suggested_sources: "Strategiedocumenten, interviews met budgethouders.",
      method: "both",
      done_criterion: "Een expliciete koppeling aan een doel met meetbare indicator en eigenaar.",
    },
    problem,
    {
      question: "Is dit haalbaar met de huidige mensen, systemen en regels?",
      why_it_matters: "Interne innovaties stranden vaak op IT, juridische of operationele drempels.",
      data_needed: "Benodigde capaciteit, systemen, juridische randvoorwaarden en afhankelijkheden.",
      suggested_sources: "IT, juridische afdeling, operations, vergelijkbare projecten.",
      method: "desk",
      done_criterion: "Een lijst kritieke randvoorwaarden met status en eigenaar.",
    },
    alternatives,
    {
      question: "Wie moet ja zeggen, en wat overtuigt die persoon?",
      why_it_matters: "Draagvlak bij de budgethouder bepaalt of het idee doorgaat.",
      data_needed: "Beslissers, hun criteria en eerdere besluiten over vergelijkbare initiatieven.",
      suggested_sources: "Gesprekken met stakeholders, eerdere businesscases.",
      method: "customer",
      done_criterion: "Gesprekken met minstens de budgethouder en één gebruiker, met citaten.",
    },
  ],
};

const SECTOR_NOTES: Record<SectorTemplate, string> = {
  generic: "",
  smb: "Let op betaalbereidheid bij kleine budgetten en de rol van de ondernemer als gebruiker én beslisser.",
  events: "Houd rekening met seizoensinvloed en lange leadtijden: meet eerder aanvragen dan boekingen.",
  media_culture:
    "Levensvatbaarheid kan via leden, subsidie, donaties of bereik lopen in plaats van directe betaling.",
};

export function templatePlan(projectType: ProjectType, sector: SectorTemplate): PlanQuestion[] {
  const note = SECTOR_NOTES[sector];
  return PLANS[projectType].map((q) => (note ? { ...q, why_it_matters: `${q.why_it_matters} ${note}` } : q)).slice(0, 5);
}
