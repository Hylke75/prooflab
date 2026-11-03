// Experiment recommender: compares the executable experiments on five criteria and explains
// why. Discovery (understand) comes before validation (prove), as in the method.

import type { AssumptionCategory, ExperimentType } from "./labels";

export type Option = {
  tier: "Snel" | "Sterker bewijs" | "Meest overtuigend" | "Breder beeld";
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
  // Upper bounds of cost and duration above, as numbers for the information value ranking.
  costEur: number;
  days: number;
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
  costEur: 0,
  days: 14,
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
  costEur: 500,
  days: 21,
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
  costEur: 750,
  days: 28,
};

// A survey quantifies what interviews uncovered: how often it happens and what people do now, among many
// people. Self-reported, so it never replaces a behaviour test; known, invited respondents preferred (7.5).
const survey = (hasDiscoveryEvidence: boolean): Option => ({
  tier: "Breder beeld",
  type: "survey",
  why: hasDiscoveryEvidence
    ? "Meet hoe vaak wat je in de interviews hoorde voorkomt, bij veel meer mensen."
    : "Werkt het best na een paar interviews: dan weet je welke vragen en antwoordopties kloppen.",
  learn: "Hoe vaak het probleem voorkomt, wat mensen nu doen en uitgeven, volgens henzelf, bij veel meer mensen dan je spreekt.",
  cannotConclude: "Wat mensen werkelijk gaan doen of betalen: het blijft zelfrapportage, geen waargenomen gedrag.",
  effort: "8–12 vragen, persoonlijk uitnodigen via eigen kanalen",
  duration: "1–2 weken",
  cost: "€ 0, alleen tijd",
  strength: "Zwak",
  canChangeDecision: "Ja, als het probleem bij uitgenodigde respondenten veel minder voorkomt dan gedacht.",
  followUp: "Positief: bevestig met een gedragstest (landingspagina of prijs-/aanbodtest). Negatief: doelgroep of probleem herzien.",
  costEur: 0,
  days: 14,
});

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
  // The survey comes as a fourth choice; the information-value ranking below does not consider it.
  options = [...options, survey(input.hasDiscoveryEvidence)];
  const warning =
    !input.hasDiscoveryEvidence && input.evidence < 0.2
      ? "Er is nog geen ontdekkend onderzoek gedaan. Begin met de snelle optie: eerst begrijpen, dan bewijzen."
      : null;
  return { options, warning };
}

// ---------------------------------------------------------------------------
// Value of information (research 3.9): which assumption to test next. Not "important × little
// evidence", but how much a test could change the decision, divided by what the test costs.
//
//   score = (importance / 5) × 4·p(1−p) × |p⁺ − p⁻| × (1 if the test can flip the decision, else ½)
//           ÷ cost index of the cheapest suitable test
//
// p⁺ and p⁻ are the probability after a clear positive or negative result of that test (one
// update with TEST_LR). A test is suitable when p⁺ and p⁻ lie on different sides of the decision
// boundary (50%: above it you act as if the assumption holds); without discovery evidence only the
// quick option counts (first understand, then prove). Cost index = weeks of duration + € / 500.
// Deterministic; the weights are starting assumptions, to be calibrated like the LRs.
// ---------------------------------------------------------------------------

export const DECISION_BOUNDARY = 0.5;
// LR of one clear result per test type, consistent with OBSERVATION_LR: a landing page yields a
// demo request (3), a pricing test a choice at a price (3), an interview series several problem
// confirmations in recent behaviour (≈ 2,5 after diminishing returns).
export const TEST_LR: Record<ExperimentType, number> = { interview: 2.5, landing: 3, pricing: 3, survey: 1.3 };
export const EUR_PER_COST_UNIT = 500;

export function costIndex(o: Pick<Option, "days" | "costEur">): number {
  return o.days / 7 + o.costEur / EUR_PER_COST_UNIT;
}

export type VoiInput = {
  id: string;
  statement: string;
  importance: number;
  probability: number;
  category: AssumptionCategory;
  evidence: number;
  hasDiscoveryEvidence: boolean;
};

export type VoiResult = {
  id: string;
  score: number;
  index: number; // 0–100, highest assumption of the dossier = 100
  uncertainty: number; // 4·p(1−p), 0..1
  after: { negative: number; positive: number };
  canFlip: boolean;
  test: Option;
  cost: number;
  why: string;
};

const pctNl = (p: number) => `${Math.round(p * 100)}%`;
const logitP = (p: number) => Math.log(p / (1 - p));
const update = (p: number, lnLr: number) => {
  const q = Math.min(0.99, Math.max(0.01, p));
  return Math.min(0.99, Math.max(0.01, 1 / (1 + Math.exp(-(logitP(q) + lnLr)))));
};

export function valueOfInformation(a: VoiInput): Omit<VoiResult, "index"> {
  const { options, warning } = recommend({ category: a.category, evidence: a.evidence, hasDiscoveryEvidence: a.hasDiscoveryEvidence });
  const candidates = (warning ? options.slice(0, 1) : options.filter((o) => o.type !== "survey")).map((o) => {
    const ln = Math.log(TEST_LR[o.type]);
    const positive = update(a.probability, ln);
    const negative = update(a.probability, -ln);
    return { o, positive, negative, canFlip: positive >= DECISION_BOUNDARY !== negative >= DECISION_BOUNDARY, cost: costIndex(o) };
  });
  const suitable = candidates.filter((c) => c.canFlip);
  const pool = suitable.length ? suitable : candidates;
  const best = [...pool].sort((x, y) => x.cost - y.cost || TEST_LR[y.o.type] - TEST_LR[x.o.type])[0];
  const p = Math.min(0.99, Math.max(0.01, a.probability));
  const uncertainty = 4 * p * (1 - p);
  const move = best.positive - best.negative;
  const score = ((Math.min(5, Math.max(1, a.importance)) / 5) * uncertainty * move * (best.canFlip ? 1 : 0.5)) / best.cost;
  const level = a.importance >= 4 ? "Kritiek" : a.importance >= 3 ? "Belangrijk" : "Minder belangrijk";
  const testName = { interview: "klantinterviews", landing: "een landingpage-test", pricing: "een prijs-/aanbodtest", survey: "een enquête" }[best.o.type];
  const why =
    `${level} (${a.importance}/5), geschatte kans ${pctNl(p)}. ` +
    `Met ${testName} (${best.o.duration}, ${best.o.cost}) komt de kans op ${pctNl(best.negative)} of ${pctNl(best.positive)}` +
    (best.canFlip ? ": de uitkomst kan het besluit omdraaien." : ": het besluit draait daar waarschijnlijk niet door om.");
  return { id: a.id, score, uncertainty, after: { negative: best.negative, positive: best.positive }, canFlip: best.canFlip, test: best.o, cost: best.cost, why };
}

// Highest information value first; ties keep the input order.
export function rankByInformationValue(list: VoiInput[]): VoiResult[] {
  const scored = list.map((a, i) => ({ ...valueOfInformation(a), i }));
  const max = Math.max(0, ...scored.map((s) => s.score));
  return scored
    .sort((x, y) => y.score - x.score || x.i - y.i)
    .map(({ i: _i, ...s }) => ({ ...s, index: max > 0 ? Math.round((s.score / max) * 100) : 0 }));
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
  if (type === "survey") {
    return {
      test_method: "Enquête over recent gedrag met één vooraf vastgelegde kernvraag",
      metric_label: "Kernvraag: gekozen succesantwoord",
      metric_numerator: "respondenten die een succesantwoord kozen",
      metric_denominator: "respondenten die de kernvraag beantwoordden",
      success_threshold_pct: 40,
      fail_threshold_pct: 15,
      min_sample: 50,
      max_duration_days: 21,
      we_believe: statement,
      target_group: audience,
      expected_biases: "Zelfrapportage: mensen overschatten hun eigen gedrag. Wie reageert is vaak betrokkener (zelfselectie); via een open link kunnen bots en mensen buiten de doelgroep meedoen.",
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
