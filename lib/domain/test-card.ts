// Test Card (fase B1): één validatie voor scherm en server, en het benodigde aantal deelnemers als bandbreedte.
// De scherm- en servercontrole gebruiken dezelfde regels, zodat een fout altijd bij het juiste veld staat en
// opslaan nooit stil mislukt.

import { checkHypothesis } from "./hypothesis";
import { recruitmentMissing } from "./recruitment";
import { betaQuantile, requiredSample, type BetaPrior, type DecisionRule } from "./stats";
import { contactProblem } from "./test-privacy";
import { absoluteRuleAllowed, type SuccessMetric } from "./success-metric";

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
  // Gebruikerstest C3: het vooraf berekende aantal deelnemers (kansregel) en de motivering als de minimale steekproef
  // daaronder ligt. Zonder berekening (oude methode, aantalregel) geen controle.
  required_n?: number | null;
  sample_below_reason?: string | null;
  // Fase 2 · punt 4: verwerkingsverantwoordelijke op de testpagina (landing en prijs). Ontbreekt het veld (undefined),
  // dan geen controle (oudere aanroepers).
  privacy_controller?: string;
  privacy_contact?: string;
  // Fase 2 · punt 4: wat telt als succes bij een landing- of prijstest (zonder: aanmelding).
  success_metric?: SuccessMetric;
  deposit_enabled?: boolean;
};

// Gebruikerstest C3: een minimale steekproef onder het berekende aantal vraagt een motivering van minstens 10 tekens.
export const SAMPLE_REASON_MIN = 10;
export function sampleBelowRequired(c: Pick<TestCardInput, "rule" | "min_sample" | "required_n">): boolean {
  return c.rule === "probability" && c.required_n != null && c.min_sample != null && c.min_sample < c.required_n;
}

export type FieldErrors = Record<string, string>;

// Volgorde = volgorde op het scherm, zodat de eerste fout ook bovenaan de samenvatting staat. Fase B5: eerst de vijf
// zichtbare velden, daarna wat onder "Details" staat.
export const FIELD_LABELS: Record<string, string> = {
  // Gebruikerstest C4: de naam staat zichtbaar bovenaan; C5: "Wij denken dat …" (een bewering, geen vraag).
  title: "Naam van het experiment",
  we_believe: "Wij denken dat …",
  target_group: "Bij wie?",
  success_threshold_pct: "Succesdrempel",
  fail_threshold_pct: "Faaldrempel",
  success_metric: "Wat telt als succes?",
  success_count: "Geslaagd bij minimaal (aantal)",
  thresholds: "Drempels vastleggen",
  min_sample: "Minimale steekproef",
  sample_below_reason: "Reden voor minder deelnemers dan berekend",
  max_duration_days: "Deadline",
  test_method: "Dat toetsen we door…",
  metric_label: "En we meten…",
  metric_numerator: "Teller en noemer",
  recruitment_group: "Wervingsgroep",
  channels: "Wervingskanalen",
  guide: "Gespreksleidraad",
  headline: "Kop",
  price_points: "Prijspunten",
  privacy_controller: "Verwerkingsverantwoordelijke",
  privacy_contact: "Contact voor privacy",
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
  if (absolute && !absoluteRuleAllowed(c.type, c.success_metric)) {
    add("success_count", "Een vast aantal past alleen bij sterke handelingen: in gesprekken, of op een testpagina bij betaling, toezegging of afspraak. Kies de kansregel.");
  }
  if (c.success_metric && c.success_metric !== "signup" && c.type !== "landing" && c.type !== "pricing") add("success_metric", "Deze succesmaat past alleen bij een landing- of prijstest.");
  if (c.success_metric === "payment" && c.deposit_enabled === false) add("success_metric", "Met betaling als succesmaat hoort de betaalstap aan te staan (onder Details). Zonder Mollie: kies een andere succesmaat.");
  if (absolute) {
    if (c.success_count == null || c.success_count < 1) add("success_count", "Leg vast hoeveel sterke handelingen minimaal nodig zijn.");
    else if (c.min_sample != null && c.success_count > c.min_sample) add("success_count", "Het afgesproken aantal kan niet groter zijn dan de minimale steekproef.");
  }
  // B5: de looptijd staat op het scherm als deadline (een datum); de melding spreekt dezelfde taal.
  if (c.max_duration_days == null || c.max_duration_days < 1) add("max_duration_days", "Kies een deadline na vandaag.");
  else if (c.max_duration_days > 180) add("max_duration_days", "Kies een deadline binnen 180 dagen: een langere test verliest zijn waarde voor het besluit.");
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
  // Gebruikerstest C5: een hypothese is een bewering die kan kloppen of niet, geen vraag.
  if (c.we_believe.trim().endsWith("?")) add("we_believe", "Schrijf een bewering, geen vraag: wat denk je dat er gebeurt? Haal het vraagteken weg.");
  if (sampleBelowRequired(c) && (c.sample_below_reason ?? "").trim().length < SAMPLE_REASON_MIN) {
    add("sample_below_reason", `De minimale steekproef ligt onder het berekende aantal (${c.required_n}). Leg in een zin uit waarom (minstens ${SAMPLE_REASON_MIN} tekens), of neem ${c.required_n} over.`);
  }
  if (recruitmentMissing(c.type, c.recruitment_group)) add("recruitment_group", "Kies de wervingsgroep: via welke weg bereik je de deelnemers?");
  if (c.channels.length === 0) add("channels", "Kies minstens één wervingskanaal. Zonder werving zegt een test niets.");
  if (c.type === "interview" && c.guide_questions < 3) add("guide", "Een gespreksleidraad heeft minstens drie vragen.");
  if ((c.type === "landing" || c.type === "pricing") && c.headline.trim().length < 5) add("headline", "Schrijf een kop voor de testpagina (minstens 5 tekens).");
  if (c.type === "pricing" && c.price_points === 0) add("price_points", "Voeg minstens één prijspunt toe, met naam en bedrag.");
  if (c.type === "landing" || c.type === "pricing") {
    if (c.privacy_controller !== undefined && c.privacy_controller.trim().length < 2) {
      add("privacy_controller", "Vul de naam van de verwerkingsverantwoordelijke in (de organisatie die het onderzoek laat doen). Die staat in de privacytekst op de testpagina.");
    }
    if (c.privacy_contact !== undefined) {
      const problem = contactProblem(c.privacy_contact);
      if (problem) add("privacy_contact", problem);
    }
  }
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

// ---------------------------------------------------------------------------
// Fase B5: een korte Test Card. Zichtbaar zijn alleen wat je test, bij wie, wanneer de test geslaagd is (drempels),
// hoeveel deelnemers en de deadline. De rest staat vooringevuld onder "Details". Een verplicht detailveld met een
// fout opent "Details" vanzelf: een verplicht veld zit nooit verborgen in een dichtgeklapt deel.
// ---------------------------------------------------------------------------

// Velden (sleutels van FieldErrors) die op het zichtbare deel van de Test Card staan.
export const VISIBLE_FIELDS = ["title", "we_believe", "target_group", "success_metric", "success_threshold_pct", "fail_threshold_pct", "success_count", "thresholds", "min_sample", "sample_below_reason", "max_duration_days"] as const;

// Alle andere velden staan onder "Details" (de enquête staat in de preview en telt niet als detailveld).
export function detailFieldErrors(e: FieldErrors): string[] {
  return Object.keys(e).filter((k) => !(VISIBLE_FIELDS as readonly string[]).includes(k) && k !== "survey");
}

// Deadline: op het scherm een einddatum, in de database de maximale looptijd in dagen (hypotheses.max_duration_days).
// De echte einddatum volgt bij de start (ends_at = start + looptijd); de datum hier geldt als de test vandaag start.
const DAY_MS = 86_400_000;
const utcDay = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
};
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function deadlineFromDays(days: number, today: string): string {
  const t = utcDay(today);
  if (!Number.isFinite(t) || !Number.isFinite(days)) return "";
  return new Date(t + Math.round(days) * DAY_MS).toISOString().slice(0, 10);
}

// Aantal dagen van vandaag tot de deadline; null bij een ongeldige datum.
export function daysUntil(deadline: string, today: string): number | null {
  const a = utcDay(today);
  const b = utcDay(deadline);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

// Prijs uit de intake ("€ 249 per maand"). Eerst een expliciet prijsveld (als het dossier dat heeft), anders de
// eerste prijs met een periode in de teksten, in de gegeven volgorde. Een bedrag zonder periode telt alleen na
// "voor", "kost" of "prijs" (bijv. "voor € 1.500"); zo wordt een investering of omzetdoel geen prijspunt.
export type IntakePrice = { amount: number; period: string | null; text: string };

const PERIODS: [RegExp, string][] = [
  [/^(per\s+maand|per\s+mnd|p\/m|pm|\/\s*maand|\/\s*mnd|\/\s*m|maandelijks)(?![a-z])/i, "per maand"],
  [/^(per\s+jaar|per\s+jr|p\/j|pj|\/\s*jaar|\/\s*jr|\/\s*j|jaarlijks)(?![a-z])/i, "per jaar"],
  [/^(per\s+week|p\/w|\/\s*week|wekelijks)(?![a-z])/i, "per week"],
  [/^(per\s+kwartaal|\/\s*kwartaal)(?![a-z])/i, "per kwartaal"],
  [/^eenmalig(?![a-z])/i, "eenmalig"],
];

// Een bedrag in Nederlandse notatie: "249", "1.250", "49,95", "1.250,50", "249,-".
export function parseDutchAmount(s: string): number | null {
  let t = s.trim().replace(/\s/g, "").replace(/,-$/, "");
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(",", ".");
  else if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function periodAfter(rest: string): string | null {
  const r = rest
    .replace(/^\s*(excl\.?|incl\.?|ex\.?)\s*(btw)?\s*/i, "")
    .replace(/^\s*per\s+(gebruiker|kantoor|klant|licentie|persoon|vestiging)\s*/i, "")
    .trimStart();
  for (const [re, label] of PERIODS) if (re.test(r)) return label;
  return null;
}

export function priceFromText(text: string | null | undefined): IntakePrice | null {
  if (!text) return null;
  const re = /(?:€|EUR)\s*(\d+(?:[.,]\d+)*(?:,-)?)|(\d+(?:[.,]\d+)*)\s*(?:euro|EUR)(?![a-z])/gi;
  let loose: IntakePrice | null = null;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    const amount = parseDutchAmount(m[1] ?? m[2] ?? "");
    if (amount == null) continue;
    const end = start + m[0].length;
    const period = periodAfter(text.slice(end, end + 40));
    const phrase = `€ ${formatAmount(amount)}${period ? ` ${period}` : ""}`;
    if (period) return { amount, period, text: phrase };
    const before = text.slice(Math.max(0, start - 24), start).toLowerCase();
    if (!loose && /(voor|kost|kosten|prijs|prijs van|à)\s*:?\s*$/.test(before)) loose = { amount, period: null, text: phrase };
  }
  return loose;
}

export function intakePrice(intake: { price_eur?: number | null; price_period?: string | null; texts: (string | null | undefined)[] }): IntakePrice | null {
  if (intake.price_eur != null && Number.isFinite(intake.price_eur) && intake.price_eur > 0) {
    const period = intake.price_period?.trim() || null;
    return { amount: intake.price_eur, period, text: `€ ${formatAmount(intake.price_eur)}${period ? ` ${period}` : ""}` };
  }
  let loose: IntakePrice | null = null;
  for (const t of intake.texts) {
    const p = priceFromText(t);
    if (p?.period) return p;
    if (p && !loose) loose = p;
  }
  return loose;
}

// Bedrag voor een invoerveld: "249" of "49,95".
export function formatAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", ",");
}

// Kop van de testpagina als voorstel: de eerste zin van het idee, zonder de prijs (die staat bij de prijspunten).
export function headlineFromIdea(description: string | null | undefined, title: string): string {
  const first = (description ?? "").trim().split(/(?<=[.!?])\s+/)[0]?.trim() ?? "";
  const clean = first
    .replace(/,?\s*(voor|à|vanaf)\s*(€|EUR)\s*\d[\d.,]*(,-)?\s*(euro)?\s*(per\s+\w+|p\/m|pm|\/\s*\w+)?/gi, "")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/[.,]+$/, "")
    .trim();
  const text = clean.length >= 5 ? clean : title.trim();
  return text.length > 140 ? `${text.slice(0, 137).replace(/\s+\S*$/, "")}…` : text;
}

// Wervingsgroep als standaard, afgeleid uit de kanalen (definities in recruitment.ts): organische kanalen en
// persoonlijke uitnodigingen bereiken vooral het eigen netwerk (ook volgers van het eigen account); advertenties en
// koude outreach zijn koud. Gemengd met het eigen netwerk telt als eigen netwerk: dat is het voorzichtigst, omdat
// signalen uit het eigen netwerk minder onafhankelijk zijn. De consultant past het zo nodig aan onder "Details".
const OWN_CHANNELS = ["network", "linkedin", "meta", "x", "email", "newsletter"];
const COLD_CHANNELS = ["linkedin_ads", "meta_ads", "google_ads", "outreach"];
export function recruitmentFromChannels(channels: string[]): "own_network" | "cold" | "unknown" {
  if (channels.some((c) => OWN_CHANNELS.includes(c))) return "own_network";
  if (channels.some((c) => COLD_CHANNELS.includes(c))) return "cold";
  return "unknown";
}

// Statusbalk: Concept → Klaar voor goedkeuring → Loopt. "Goedgekeurd" is de laatste stap vóór de start: de tweede
// stap is dan afgerond. Na de meting zijn alle drie de stappen afgerond.
export type StatusStep = { key: "concept" | "review" | "live"; label: string; status: "done" | "current" | "todo" };
export function testCardStatus(state: string): { steps: StatusStep[]; note: string } {
  const labels: [StatusStep["key"], string][] = [
    ["concept", "Concept"],
    ["review", "Klaar voor goedkeuring"],
    ["live", "Loopt"],
  ];
  const at: Record<string, { index: number; done: boolean; note: string }> = {
    draft: { index: 0, done: false, note: "Vul de Test Card aan en bied hem aan voor goedkeuring." },
    ready_for_review: { index: 1, done: false, note: "Wacht op goedkeuring. Goedkeuren vergrendelt hypothese en drempels." },
    approved: { index: 1, done: true, note: "Goedgekeurd en vergrendeld. Start de test om te gaan meten." },
    live: { index: 2, done: false, note: "Metingen worden geteld tot de deadline of de afgesproken eindconditie." },
    paused: { index: 2, done: false, note: "Gepauzeerd: bezoeken worden nu niet geteld." },
  };
  const s = at[state] ?? { index: 2, done: true, note: "De meting is afgerond." };
  const steps = labels.map(([key, label], i) => ({
    key,
    label,
    status: (i < s.index || (i === s.index && s.done) ? "done" : i === s.index ? "current" : "todo") as StatusStep["status"],
  }));
  return { steps, note: s.note };
}
