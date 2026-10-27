// Experiment recommender: compares the executable experiments on five criteria and explains
// why. Discovery (understand) comes before validation (prove), as in the method.

import type { AssumptionCategory, ExperimentType } from "./labels";

export type Option = {
  tier: "Snel" | "Sterker bewijs" | "Meest overtuigend";
  type: ExperimentType;
  why: string;
  learn: string;
  cannotConclude: string;
  effort: string;
  duration: string;
  cost: string;
  strength: "Zwak" | "Middel" | "Sterk";
  canChangeDecision: string;
  followUp: string;
};

export type RecommendInput = {
  category: AssumptionCategory;
  evidence: number; // 0..1 from the assumption map
  hasDiscoveryEvidence: boolean; // interviews or other qualitative evidence exists
};

const interview = (focus: string): Omit<Option, "tier" | "why"> => ({
  type: "interview",
  learn: `Hoe mensen ${focus} nu echt aanpakken, met concrete recente voorbeelden.`,
  cannotConclude: "Of mensen gaan kopen of hoeveel er bereid zijn te betalen.",
  effort: "5–10 gesprekken van 30 minuten",
  duration: "1–2 weken",
  cost: "€ 0, alleen tijd",
  strength: "Middel",
  canChangeDecision: "Ja, als het probleem in recent gedrag niet terugkomt.",
  followUp: "Positief: landingspagina of prijs-/aanbodtest. Negatief: propositie of doelgroep bijsturen.",
});

const landing: Omit<Option, "tier" | "why"> = {
  type: "landing",
  learn: "Of onbekende, relevante mensen in een echte context een aanvraag of demo-verzoek doen.",
  cannotConclude: "Of ze zullen betalen, en of ze het product blijven gebruiken.",
  effort: "Pagina opzetten, verkeer werven via 1–2 kanalen",
  duration: "2–3 weken",
  cost: "€ 0–500 (advertenties optioneel)",
  strength: "Middel",
  canChangeDecision: "Ja, als vrijwel niemand van de relevante bezoekers actie onderneemt.",
  followUp: "Positief: prijs-/aanbodtest. Negatief: belofte of kanaal aanpassen.",
};

const pricing: Omit<Option, "tier" | "why"> = {
  type: "pricing",
  learn: "Welk deel van de relevante bezoekers een concreet aanbod met prijs kiest, per prijspunt.",
  cannotConclude: "Werkelijke betaling (er wordt niets afgerekend) en herhaalaankopen.",
  effort: "Aanbod en 2–3 prijspunten formuleren, verkeer werven",
  duration: "2–4 weken",
  cost: "€ 0–750 (advertenties optioneel)",
  strength: "Sterk",
  canChangeDecision: "Ja: een prijs die niemand kiest, verandert de businesscase direct.",
  followUp: "Positief: betaalde pilot of aanbetaling met voorwaarden. Negatief: prijsmodel of segment herzien.",
};

export function recommend(input: RecommendInput): { options: Option[]; warning: string | null } {
  let options: Option[];
  switch (input.category) {
    case "viability":
      options = [
        { tier: "Snel", ...interview("het probleem oplossen en wat ze daar nu voor betalen"), why: "Huidige uitgaven zijn het beste anker voor een prijs." },
        { tier: "Sterker bewijs", ...landing, why: "Toont of er belangstelling is voordat je prijzen test." },
        { tier: "Meest overtuigend", ...pricing, why: "Meet keuzegedrag bij een echte prijs: dichter bij betalen dan elke enquête." },
      ];
      break;
    case "feasibility":
      options = [
        { tier: "Snel", ...interview("dit organiseren of leveren (leveranciers, experts)"), why: "Haalbaarheid toets je eerst bij mensen die het moeten leveren." },
        { tier: "Sterker bewijs", ...interview("dit organiseren of leveren (leveranciers, experts)"), effort: "Gesprekken plus een kleine handmatige proef", why: "Een concierge-proef (handmatig leveren) volgt als begeleide template." },
        { tier: "Meest overtuigend", ...landing, why: "Laat zien of de vraag groot genoeg is om de investering in levering te rechtvaardigen." },
      ];
      break;
    case "context":
      options = [
        { tier: "Snel", ...interview("met regels, partners of data omgaan"), why: "Randvoorwaarden zitten bij stakeholders, niet bij klanten." },
        { tier: "Sterker bewijs", ...interview("met regels, partners of data omgaan"), effort: "Gesprekken met partner en budgethouder", why: "Toets of partners echt meewerken." },
        { tier: "Meest overtuigend", ...landing, why: "Toon dat klanten in de praktijk reageren binnen deze randvoorwaarden." },
      ];
      break;
    default:
      options = [
        { tier: "Snel", ...interview("dit probleem"), why: "Eerst begrijpen of het probleem echt bestaat en hoe vaak." },
        { tier: "Sterker bewijs", ...landing, why: "Meet echte handelingen in plaats van meningen." },
        { tier: "Meest overtuigend", ...pricing, why: "Belangstelling bij een concrete prijs is het sterkste signaal dat zonder betaling te meten is." },
      ];
  }
  const warning =
    !input.hasDiscoveryEvidence && input.evidence < 0.2
      ? "Er is nog geen ontdekkend onderzoek gedaan. Begin met de snelle optie: eerst begrijpen, dan bewijzen."
      : null;
  return { options, warning };
}

// Default templates for each experiment type, filled into the Test Card.
export function testCardDefaults(type: ExperimentType, statement: string, audience: string) {
  if (type === "interview") {
    return {
      test_method: "Probleeminterviews over recent gedrag (geen pitch)",
      metric_label: "Probleem herkend in eigen recent gedrag",
      metric_numerator: "geïnterviewden die het probleem met een recent voorbeeld beschrijven",
      metric_denominator: "geïnterviewden uit de doelgroep",
      success_threshold_pct: 60,
      fail_threshold_pct: 30,
      min_sample: 8,
      max_duration_days: 14,
      we_believe: statement,
      target_group: audience,
      expected_biases: "Bekenden zijn positiever; mensen overschatten wat ze in de toekomst zouden doen.",
    };
  }
  if (type === "pricing") {
    return {
      test_method: "Aanbod met prijspunten op een testpagina (zonder afrekenen)",
      metric_label: "Kiest een aanbod met prijs",
      metric_numerator: "unieke bezoekers die een prijsaanbod kiezen",
      metric_denominator: "unieke relevante bezoekers",
      success_threshold_pct: 8,
      fail_threshold_pct: 2,
      min_sample: 150,
      max_duration_days: 28,
      we_believe: statement,
      target_group: audience,
      expected_biases: "Een klik op een prijs is geen betaling; warm verkeer uit het eigen netwerk converteert hoger.",
    };
  }
  return {
    test_method: "Landingspagina met één concrete belofte en één actie",
    metric_label: "Aanvraag op de testpagina",
    metric_numerator: "unieke aanvragen",
    metric_denominator: "unieke relevante bezoekers",
    success_threshold_pct: 15,
    fail_threshold_pct: 5,
    min_sample: 80,
    max_duration_days: 21,
    we_believe: statement,
    target_group: audience,
    expected_biases: "Belangstelling is geen betaling; bezoekers uit het eigen netwerk zijn positiever.",
  };
}

export const TEMPLATE_ASSUMPTIONS: { statement: string; category: AssumptionCategory; importance: number }[] = [
  { statement: "De doelgroep ervaart dit probleem vaak genoeg om er iets aan te willen doen.", category: "desirability", importance: 5 },
  { statement: "De doelgroep wil overstappen van de huidige werkwijze naar onze oplossing.", category: "desirability", importance: 4 },
  { statement: "Klanten zijn bereid een prijs te betalen die het model rendabel maakt.", category: "viability", importance: 5 },
  { statement: "We kunnen klanten bereiken tegen acceptabele wervingskosten.", category: "viability", importance: 4 },
  { statement: "We kunnen de oplossing leveren met de beschikbare mensen, data en techniek.", category: "feasibility", importance: 3 },
  { statement: "Regels, partners of platforms staan de oplossing niet in de weg.", category: "context", importance: 3 },
];
