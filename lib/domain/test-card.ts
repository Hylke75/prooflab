// Test Card (fase B1): één validatie voor scherm en server, en het benodigde aantal deelnemers als bandbreedte.
// De scherm- en servercontrole gebruiken dezelfde regels, zodat een fout altijd bij het juiste veld staat en
// opslaan nooit stil mislukt.

import { checkHypothesis } from "./hypothesis";
import { recruitmentMissing } from "./recruitment";
import { betaQuantile, requiredSample, type BetaPrior, type DecisionRule } from "./stats";

export type TestCardInput = {
  type: string;
  title: string;
  we_believe: string;
  target_group: string;
  test_method: string;
  metric_label: string;
  metric_numerator: string;
  metric_denominator: string;
  success_threshold_pct: number | null;
  fail_threshold_pct: number | null;
  min_sample: number | null;
  max_duration_days: number | null;
  rule: DecisionRule | null; // null = methode 2026-11-a (intervalregel)
  success_count: number | null;
  thresholds_locked: boolean; // stap 1 afgerond: drempels vastgelegd vóór het rekenen
  recruitment_group: string;
  channels: string[];
  headline: string;
  price_points: number; // aantal geldige prijspunten
  guide_questions: number;
};

export type FieldErrors = Record<string, string>;

// Volgorde = volgorde op het scherm, zodat de eerste fout ook bovenaan de samenvatting staat.
export const FIELD_LABELS: Record<string, string> = {
  title: "Naam van het experiment",
  we_believe: "Wij denken dat…",
  target_group: "Bij wie?",
  test_method: "Dat toetsen we door…",
  metric_label: "En we meten…",
  metric_numerator: "Teller en noemer",
  success_threshold_pct: "Succesdrempel",
  fail_threshold_pct: "Faaldrempel",
  success_count: "Geslaagd bij minimaal (aantal)",
  thresholds: "Drempels vastleggen",
  min_sample: "Minimale steekproef",
  max_duration_days: "Maximale looptijd",
  recruitment_group: "Wervingsgroep",
  channels: "Wervingskanalen",
  guide: "Gespreksleidraad",
  headline: "Kop",
  price_points: "Prijspunten",
  survey: "Enquête",
};

export function validateTestCard(c: TestCardInput): FieldErrors {
  const e: FieldErrors = {};
  const add = (k: string, m: string) => {
    if (!e[k]) e[k] = m;
  };
  if (c.title.trim().length < 3) add("title", "Geef het experiment een naam.");
  if (c.test_method.trim().length < 3) add("test_method", "Beschrijf hoe je toetst.");
  if (c.metric_label.trim().length < 3) add("metric_label", "Beschrijf wat je meet.");
  const absolute = c.rule === "absolute";
  if (absolute && c.type !== "interview") add("success_count", "Een vast aantal past alleen bij sterke handelingen in gesprekken. Kies de kansregel.");
  if (absolute) {
    if (c.success_count == null || c.success_count < 1) add("success_count", "Leg vast hoeveel sterke handelingen minimaal nodig zijn.");
    else if (c.min_sample != null && c.success_count > c.min_sample) add("success_count", "Het afgesproken aantal kan niet groter zijn dan de minimale steekproef.");
  }
  const coach = checkHypothesis({
    we_believe: c.we_believe,
    target_group: c.target_group,
    metric_numerator: c.metric_numerator,
    metric_denominator: c.metric_denominator,
    success_threshold_pct: absolute ? (c.success_count && c.min_sample ? (c.success_count / c.min_sample) * 100 : null) : c.success_threshold_pct,
    fail_threshold_pct: absolute ? null : c.fail_threshold_pct,
    min_sample: c.min_sample,
    max_duration_days: c.max_duration_days,
  });
  for (const i of coach.issues) add(i.field === "general" ? "we_believe" : absolute && i.field === "success_threshold_pct" ? "success_count" : i.field, i.message);
  if (c.success_threshold_pct != null && c.success_threshold_pct > 100) add("success_threshold_pct", "Een drempel is hoogstens 100%.");
  if (c.rule && !c.thresholds_locked && !e.success_threshold_pct && !e.fail_threshold_pct && !e.success_count) {
    add("thresholds", "Leg eerst de drempels vast: daarna rekent ProofLab uit hoeveel deelnemers je nodig hebt.");
  }
  if (recruitmentMissing(c.type, c.recruitment_group)) add("recruitment_group", "Kies de wervingsgroep: via welke weg bereik je de deelnemers?");
  if (c.channels.length === 0) add("channels", "Kies minstens één wervingskanaal. Zonder werving zegt een test niets.");
  if (c.type === "interview" && c.guide_questions < 3) add("guide", "Een gespreksleidraad heeft minstens drie vragen.");
  if ((c.type === "landing" || c.type === "pricing") && c.headline.trim().length < 5) add("headline", "Schrijf een kop voor de testpagina (minstens 5 tekens).");
  if (c.type === "pricing" && c.price_points === 0) add("price_points", "Voeg minstens één prijspunt toe, met naam en bedrag.");
  return e;
}

// Fouten in schermvolgorde, voor de samenvatting bij de knop.
export function orderedErrors(e: FieldErrors): { field: string; label: string; message: string }[] {
  const order = Object.keys(FIELD_LABELS);
  return Object.entries(e)
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map(([field, message]) => ({ field, label: FIELD_LABELS[field] ?? field, message }));
}

export function errorSummary(e: FieldErrors): string {
  const n = Object.keys(e).length;
  return n === 1 ? "De Test Card is nog niet opgeslagen: 1 punt moet nog worden aangevuld." : `De Test Card is nog niet opgeslagen: ${n} punten moeten nog worden aangevuld.`;
}

// ---------------------------------------------------------------------------
// Benodigd aantal deelnemers (B1b). De drempels liggen eerst vast; pas daarna rekent ProofLab, niet met één
// gok van de gebruiker, maar voor drie scenario's van het echte percentage:
// - met minstens drie afgeronde tests van hetzelfde type in de organisatie: het 25e, 50e en 75e percentiel van
//   wat die tests lieten zien (empirische prior, zie stats.ts);
// - anders: scenario's net boven de succesdrempel (1,25×, 1,5× en 2× de drempel). Dat is geen voorspelling, maar
//   de vraag "hoeveel deelnemers heb je nodig als het idee de drempel ruim haalt?".
// Het getal dat het scherm toont is het voorzichtige scenario: bij een lage drempel haalt de kansregel met de
// vlakke prior Beta(1,1) bij een ruim scenario al met een handvol deelnemers 80%, en dat zou een te klein getal
// suggereren. Is het voorzichtige scenario niet haalbaar maar het middenscenario wel, dan telt dat, met een
// waarschuwing. Een lagere drempel stelt het systeem nooit voor.
// ---------------------------------------------------------------------------

export type SampleScenario = { key: "low" | "mid" | "high"; label: string; ratePct: number; requiredN: number | null };
export type SampleBand = {
  basis: "earlier_tests" | "threshold";
  earlierTests: number;
  scenarios: SampleScenario[];
  requiredN: number | null; // het getoonde scenario (zie hierboven)
  expectedPct: number; // percentage van dat scenario, wordt bewaard als expected_pct
  shown: SampleScenario["key"];
  feasible: boolean;
  capacity: number | null; // bereik binnen de looptijd
  advice: string | null;
};

const round1 = (x: number) => Math.round(x * 10) / 10;

export function sampleBand(input: {
  rule: DecisionRule;
  thresholdPct: number; // succesdrempel in %, bij de aantalregel het aantal gedeeld door de steekproef
  successCount?: number | null;
  prior?: BetaPrior | null;
  availablePerWeek?: number | null;
  maxDurationDays: number;
}): SampleBand {
  const t = Math.max(0.1, Math.min(99, input.thresholdPct));
  const empirical = input.prior?.source === "empirical" ? input.prior : null;
  const rates: Record<SampleScenario["key"], number> = empirical
    ? {
        low: betaQuantile(0.25, empirical.alpha, empirical.beta) * 100,
        mid: betaQuantile(0.5, empirical.alpha, empirical.beta) * 100,
        high: betaQuantile(0.75, empirical.alpha, empirical.beta) * 100,
      }
    : { low: Math.min(99, t * 1.25), mid: Math.min(99, t * 1.5), high: Math.min(99, t * 2) };
  const label = { low: "Voorzichtig", mid: "Midden", high: "Ruim" } as const;
  const scenarios: SampleScenario[] = (["low", "mid", "high"] as const).map((key) => {
    const ratePct = round1(Math.max(0.1, rates[key]));
    return {
      key,
      label: label[key],
      ratePct,
      requiredN: requiredSample({ rule: input.rule, expectedPct: ratePct, thresholdPct: t, successCount: input.successCount ?? null }),
    };
  });
  const mid = scenarios[0].requiredN != null || scenarios[1].requiredN == null ? scenarios[0] : scenarios[1];
  const capacity = input.availablePerWeek != null && input.availablePerWeek > 0 ? Math.floor((input.availablePerWeek * input.maxDurationDays) / 7) : null;
  const reachable = mid.requiredN != null && (capacity == null || capacity >= mid.requiredN);
  let advice: string | null = null;
  if (mid.requiredN == null) {
    advice = empirical
      ? `Eerdere tests van dit type kwamen uit rond ${scenarios[1].ratePct}%, onder de succesdrempel van ${round1(t)}%. Met dit testtype is de drempel waarschijnlijk niet te halen: kies een ander testtype of verleng de looptijd.`
      : "Met dit testtype is de drempel binnen 20.000 deelnemers niet aantoonbaar te halen: kies een ander testtype of verleng de looptijd.";
  } else if (!reachable) {
    advice = `Niet haalbaar binnen de looptijd: ongeveer ${mid.requiredN} deelnemers nodig, en met ${input.availablePerWeek} per week in ${input.maxDurationDays} dagen bereik je er ongeveer ${capacity}. Kies een ander testtype of verleng de looptijd.`;
  }
  if (!advice && mid.key === "mid") {
    advice = `Bij de voorzichtige schatting (${scenarios[0].ratePct}%) is de drempel niet te halen; het getal geldt alleen als het echte percentage rond ${mid.ratePct}% ligt. Overweeg een ander testtype of een langere looptijd.`;
  }
  return {
    basis: empirical ? "earlier_tests" : "threshold",
    shown: mid.key,
    earlierTests: input.prior?.tests ?? 0,
    scenarios,
    requiredN: mid.requiredN,
    expectedPct: mid.ratePct,
    feasible: reachable,
    capacity,
    advice,
  };
}
