// Experiment recommender: compares the executable experiments on five criteria and explains
// why. Discovery (understand) comes before validation (prove), as in the method.

import type { AssumptionCategory, ExperimentType } from "./labels";
import { assumptionKind, type AssumptionKind } from "./assumption-kind";

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
// update with the factor of that test for this kind of assumption). A test is suitable when p⁺ and p⁻
// lie on different sides of the decision boundary (50%: above it you act as if the assumption holds).
// Cost index = weeks of duration + € / 500. Deterministic; the weights are starting assumptions, to be
// calibrated like the LRs.
//
// Fase B4: de kandidaat-tests hangen af van de soort aanname (markt, prijs, gedrag, technisch). Vóór B4 kreeg
// elke aanname zonder ontdekkend bewijs dezelfde test (klantinterviews), terwijl elke aanname zonder bewijs op het
// plafond van 40% staat (startkans 50%, begrensd op het laagste bewijsniveau). Belang 5, kans 40%, dezelfde test:
// exact dezelfde score, dus drie keer "IW 100, 40%, 21% of 63%". Nu: een test per soort (met een eigen factor en
// eigen kosten), sorteren op de onafgeronde score, en bij gelijke score beslist eerst de directe relatie met de
// beslissende vraag, dan de laagste testkosten, dan het belang en ten slotte de invoervolgorde (stabiel).
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

// Een test zoals de rangorde hem voorstelt. type "prototype": een technische proef buiten ProofLab (geen klanttest;
// de uitkomst wordt als bron vastgelegd).
// Gebruikerstest B3: "outreach" (kanaalproef) en "desk_check" (bureauonderzoek of juridische check) zijn net als
// "prototype" proeven buiten ProofLab: geen nieuwe testtypes (EXPERIMENT_TYPES blijft gelijk).
export type VoiTestType = ExperimentType | "prototype" | "outreach" | "desk_check";
export type VoiTest = {
  type: VoiTestType;
  label: string; // in een zin: "Met {label} (…)"
  duration: string;
  cost: string;
  days: number;
  costEur: number;
  lr: number; // factor van één duidelijke uitkomst, voor deze soort aanname
  external: boolean; // buiten ProofLab uit te voeren
  note?: string; // aanvulling, alleen in het uitklapdeel
  short?: string; // korte naam voor de prioriteitenlijst (proeven buiten ProofLab)
};

const fromOption = (o: Pick<Option, "type" | "duration" | "cost" | "days" | "costEur">, label: string, lr = TEST_LR[o.type]): VoiTest => ({
  type: o.type,
  label,
  duration: o.duration,
  cost: o.cost,
  days: o.days,
  costEur: o.costEur,
  lr,
  external: false,
});

// Bij een prijsaanname meten interviews wat mensen nu uitgeven en wie over het budget beslist (gedrag in het
// verleden): een indirect anker voor een prijs, dus een iets zwakkere factor (2,25) dan bij een probleemaanname (2,5).
export const PRICE_INTERVIEW_LR = 2.25;
// Een werkende technische proef (koppeling, prototype) zegt veel over haalbaarheid: factor 4. Kosten zijn een
// startaanname: twee weken en € 1.000 aan ontwikkeltijd.
export const PROTOTYPE_LR = 4;
export const PROTOTYPE_TEST: VoiTest = {
  type: "prototype",
  label: "een technische proef of prototype buiten ProofLab",
  duration: "1–2 weken",
  cost: "€ 0–1.000 (ontwikkeltijd)",
  days: 14,
  costEur: 1000,
  lr: PROTOTYPE_LR,
  external: true,
  short: "technische proef",
};

// Gebruikerstest B3: een kanaalaanname toets je door het kanaal echt te proberen: een kleine outreach-proef (bijv. 30
// clubs via de bond benaderen en tellen wie reageert en wat het kost). Factor 3, zoals een landingpage: het is waargenomen
// gedrag. Startaanname voor kosten: twee weken en € 250.
export const OUTREACH_LR = 3;
export const OUTREACH_TEST: VoiTest = {
  type: "outreach",
  label: "een kanaaltest of outreach-proef (bijv. een kleine groep via het kanaal benaderen en reacties en kosten tellen)",
  duration: "1–2 weken",
  cost: "€ 0–250 (tijd en eventueel advertenties)",
  days: 14,
  costEur: 250,
  lr: OUTREACH_LR,
  external: true,
  short: "outreach-proef",
  note: "Meet per kanaal: geef elk kanaal een eigen link op een landingpage, dan zie je bereik en conversie per kanaal.",
};

// Gebruikerstest B3: of iets mag (AVG, vergunning, regels) zoek je uit met bureauonderzoek of een juridische check, niet
// met klanten. Factor 4: een duidelijk juridisch oordeel zegt veel. Startaanname: één week en € 500 (advies).
export const DESK_CHECK_LR = 4;
export const DESK_CHECK_TEST: VoiTest = {
  type: "desk_check",
  label: "bureauonderzoek of een juridische check buiten ProofLab",
  duration: "1 week",
  cost: "€ 0–500 (advies)",
  days: 7,
  costEur: 500,
  lr: DESK_CHECK_LR,
  external: true,
  short: "juridische check",
  note: "Leg de uitkomst vast als bron met een letterlijk citaat onder Marktverkenning. Vertrouwen van klanten kun je daarnaast uitvragen in interviews.",
};

// De tests die bij een soort aanname passen. Zonder ontdekkend bewijs (nog geen echte interviews) eerst begrijpen,
// dan bewijzen: bij markt en prijs alleen de interviews. Gedrag meet je aan wat mensen doen (landingpage,
// enquête), techniek met een technische proef: nooit met klantinterviews.
export function testsForKind(kind: AssumptionKind, hasDiscoveryEvidence: boolean): VoiTest[] {
  const iv = interview("dit");
  switch (kind) {
    case "technical":
      return [PROTOTYPE_TEST];
    case "channel":
      return [OUTREACH_TEST, fromOption(landing, "een landingpage-test per kanaal")];
    case "regulation":
      return [DESK_CHECK_TEST];
    case "behaviour":
      return [fromOption(landing, "een landingpage-test"), fromOption(survey(hasDiscoveryEvidence), "een enquête")];
    case "price": {
      const first = fromOption(iv, "klantinterviews met betaalvragen", PRICE_INTERVIEW_LR);
      return hasDiscoveryEvidence ? [first, fromOption(pricing, "een prijs-/aanbodtest")] : [first];
    }
    default: {
      const first = { ...fromOption(iv, "klantinterviews"), note: "Vul aan met bureauonderzoek: bronnen met een letterlijk citaat onder Marktverkenning." };
      return hasDiscoveryEvidence ? [first, fromOption(landing, "een landingpage-test")] : [first];
    }
  }
}

export type VoiInput = {
  id: string;
  statement: string;
  importance: number;
  probability: number;
  category: AssumptionCategory;
  evidence: number;
  hasDiscoveryEvidence: boolean;
  // Fase B4: de soort (vastgelegd of afgeleid); zonder waarde afgeleid uit de tekst.
  kind?: AssumptionKind;
  // Fase B4: de aanname raakt direct de beslissende vraag (eerste tiebreak).
  decisive?: boolean;
};

export type TieBreak = "decisive" | "cost" | "importance" | "order";

export type VoiResult = {
  id: string;
  score: number; // onafgerond; de rangorde sorteert hierop
  index: number; // 0–100, highest assumption of the dossier = 100 (alleen voor weergave afgerond)
  uncertainty: number; // 4·p(1−p), 0..1
  after: { negative: number; positive: number };
  canFlip: boolean;
  kind: AssumptionKind;
  decisive: boolean;
  test: VoiTest;
  cost: number;
  why: string; // technische uitleg met kansen (uitklapdeel)
  reason: string; // gewone taal: "Test deze eerst, omdat …"
  // Bij een gelijke score met de volgende aanname: waarom deze voorgaat.
  tieBreak: TieBreak | null;
};

const pctNl = (p: number) => `${Math.round(p * 100)}%`;
const logitP = (p: number) => Math.log(p / (1 - p));
const update = (p: number, lnLr: number) => {
  const q = Math.min(0.99, Math.max(0.01, p));
  return Math.min(0.99, Math.max(0.01, 1 / (1 + Math.exp(-(logitP(q) + lnLr)))));
};

export function valueOfInformation(a: VoiInput): Omit<VoiResult, "index" | "reason" | "tieBreak"> {
  const kind = a.kind ?? assumptionKind({ statement: a.statement, category: a.category });
  const candidates = testsForKind(kind, a.hasDiscoveryEvidence).map((t) => {
    const ln = Math.log(t.lr);
    const positive = update(a.probability, ln);
    const negative = update(a.probability, -ln);
    return { t, positive, negative, canFlip: positive >= DECISION_BOUNDARY !== negative >= DECISION_BOUNDARY, cost: costIndex(t) };
  });
  const suitable = candidates.filter((c) => c.canFlip);
  const pool = suitable.length ? suitable : candidates;
  const best = [...pool].sort((x, y) => x.cost - y.cost || y.t.lr - x.t.lr)[0];
  const p = Math.min(0.99, Math.max(0.01, a.probability));
  const uncertainty = 4 * p * (1 - p);
  const move = best.positive - best.negative;
  const score = ((Math.min(5, Math.max(1, a.importance)) / 5) * uncertainty * move * (best.canFlip ? 1 : 0.5)) / best.cost;
  const level = a.importance >= 4 ? "Kritiek" : a.importance >= 3 ? "Belangrijk" : "Minder belangrijk";
  const why =
    `${level} (${a.importance}/5), geschatte kans ${pctNl(p)}. ` +
    `Met ${best.t.label} (${best.t.duration}, ${best.t.cost}) komt de kans op ${pctNl(best.negative)} of ${pctNl(best.positive)}` +
    (best.canFlip ? ": de uitkomst kan het besluit omdraaien." : ": het besluit draait daar waarschijnlijk niet door om.") +
    (best.t.note ? ` ${best.t.note}` : "");
  return {
    id: a.id,
    score,
    uncertainty,
    after: { negative: best.negative, positive: best.positive },
    canFlip: best.canFlip,
    kind,
    decisive: !!a.decisive,
    test: best.t,
    cost: best.cost,
    why,
  };
}

// Twee scores zijn gelijk als ze op afrondingsruis na hetzelfde zijn.
export function sameScore(x: number, y: number): boolean {
  return Math.abs(x - y) <= 1e-9 * Math.max(Math.abs(x), Math.abs(y), 1e-12);
}

type Scored = Omit<VoiResult, "index" | "reason" | "tieBreak"> & { i: number; importance: number };

// Waarom x vóór y komt bij een gelijke score (null: de score beslist).
function tieBreakBetween(x: Scored, y: Scored): TieBreak | null {
  if (!sameScore(x.score, y.score)) return null;
  if (x.decisive !== y.decisive) return "decisive";
  if (Math.abs(x.cost - y.cost) > 1e-9) return "cost";
  if (x.importance !== y.importance) return "importance";
  return "order";
}

function compare(x: Scored, y: Scored): number {
  if (!sameScore(x.score, y.score)) return y.score - x.score;
  if (x.decisive !== y.decisive) return x.decisive ? -1 : 1;
  if (Math.abs(x.cost - y.cost) > 1e-9) return x.cost - y.cost;
  if (x.importance !== y.importance) return y.importance - x.importance;
  return x.i - y.i;
}

const importanceText = (n: number) =>
  n >= 5 ? "het idee omvalt als dit niet klopt" : n >= 4 ? "het idee sterk wankelt als dit niet klopt" : n >= 3 ? "dit belangrijk is voor het idee" : "dit het idee maar beperkt raakt";

const knowledgeText = (p: number, uncertainty: number) =>
  uncertainty >= 0.8
    ? "we nog niet weten of het klopt"
    : uncertainty >= 0.5
      ? `we nog twijfelen (we denken eerder van ${p >= 0.5 ? "wel" : "niet"})`
      : `we al vrij zeker denken dat het ${p >= 0.5 ? "wel" : "niet"} klopt`;

const TIE_TEXT: Record<TieBreak, string> = {
  decisive: "deze raakt direct de beslissende vraag",
  cost: "de test hiervoor is goedkoper of sneller",
  importance: "deze is belangrijker",
  order: "deze staat eerder in de lijst",
};
const TIE_TEXT_PREVIOUS: Record<TieBreak, string> = {
  decisive: "die direct de beslissende vraag raakt",
  cost: "de test daarvoor goedkoper of sneller is",
  importance: "die belangrijker is",
  order: "die eerder in de lijst staat",
};

// De rangorde in gewone taal (fase B4): belang, wat we weten en wat de voorgestelde test kan opleveren; bij een
// gelijke score ook waarom deze voorgaat. Geen scores of kansen: die staan in het uitklapdeel (why, index).
export function plainReason(
  v: Pick<VoiResult, "test" | "canFlip" | "uncertainty" | "decisive" | "tieBreak">,
  position: number,
  probability: number,
  importance: number,
  tiedWithPrevious: TieBreak | null,
): string {
  const lead = ["Test deze eerst, omdat", "Test deze als tweede, omdat", "Test deze als derde, omdat"][position] ?? "Minder dringend, omdat";
  // Kosten zonder toelichting tussen haakjes ("€ 0–500 (advertenties optioneel)" → "€ 0–500").
  const cost = v.test.cost.replace(/\s*\([^)]*\)\s*$/, "");
  const test = v.test.external
    ? `${v.test.label} (${v.test.duration}) hier de passende toets is, geen klanttest`
    : `${v.test.label} (${v.test.duration}, ${cost}) ${v.canFlip ? "het besluit kan omdraaien" : "het besluit waarschijnlijk niet omdraait"}`;
  const parts = [`${lead} ${importanceText(importance)}, ${knowledgeText(probability, v.uncertainty)} en ${test}.`];
  if (v.decisive) parts.push("Ze raakt direct de beslissende vraag.");
  if (v.tieBreak) parts.push(`Even hoog als de volgende, maar ${TIE_TEXT[v.tieBreak]}.`);
  else if (tiedWithPrevious) parts.push(`Even hoog als de vorige; die gaat voor omdat ${TIE_TEXT_PREVIOUS[tiedWithPrevious]}.`);
  return parts.join(" ");
}

// Highest information value first, on the unrounded score. Ties: direct relation with the decisive question,
// then the cheapest test, then importance, then input order (stable).
export function rankByInformationValue(list: VoiInput[]): VoiResult[] {
  const scored: Scored[] = list.map((a, i) => ({ ...valueOfInformation(a), i, importance: a.importance }));
  const probabilityOf = new Map(list.map((a) => [a.id, a.probability]));
  const max = Math.max(0, ...scored.map((s) => s.score));
  const sorted = [...scored].sort(compare);
  return sorted.map((s, pos) => {
    const tieBreak = pos + 1 < sorted.length ? tieBreakBetween(s, sorted[pos + 1]) : null;
    const prevTie = pos > 0 ? tieBreakBetween(sorted[pos - 1], s) : null;
    const base = {
      id: s.id,
      score: s.score,
      uncertainty: s.uncertainty,
      after: s.after,
      canFlip: s.canFlip,
      kind: s.kind,
      decisive: s.decisive,
      test: s.test,
      cost: s.cost,
      why: s.why,
      tieBreak,
      index: max > 0 ? Math.round((s.score / max) * 100) : 0,
    };
    return { ...base, reason: plainReason(base, pos, probabilityOf.get(s.id) ?? 0.5, s.importance, prevTie) };
  });
}

// Fase B4: de consultant kiest maximaal zoveel aannames om nu te testen; de rest blijft zichtbaar als "later".
// De database dwingt hetzelfde af (supabase/migrations/20261110100000_b4_aannames.sql).
export const MAX_SELECTED_FOR_TEST = 3;

// Null als de keuze mag; anders de melding voor het scherm.
export function selectionError(currentlySelected: number, select: boolean, alreadySelected: boolean): string | null {
  if (!select || alreadySelected) return null;
  return currentlySelected >= MAX_SELECTED_FOR_TEST
    ? `Je hebt al ${MAX_SELECTED_FOR_TEST} aannames gekozen om te testen. Zet er eerst één op later.`
    : null;
}

// Gekozen aannames eerst (in rangorde), daarna de rest als "later".
export function splitBySelection<T extends { selectedForTest?: boolean }>(ranked: T[]): { now: T[]; later: T[] } {
  return { now: ranked.filter((a) => a.selectedForTest), later: ranked.filter((a) => !a.selectedForTest) };
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
