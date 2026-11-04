// Fase 1, punt 2: "Stand van het bewijs", één beslisscherm per idee. Puur, zonder database: alle invoer komt uit de
// bestaande berekening (kans en bewijsregister per aanname, tests, informatiewaarde, coach). Er wordt niets nieuws
// berekend aan de kans: de zekerheid is de laagste kans onder de kritieke aannames plus het niveau op de bewijsschaal,
// geen nieuwe gecombineerde kans.
//
// Begrippen
// - Kritieke aanname: belangrijkheid 4 of 5 én gekozen om nu te testen (selectedForTest, fase B4).
// - Getest: de hoofdtest van de aanname heeft een goedgekeurde Learning Card met uitslag geslaagd of niet geslaagd
//   (onbeslist telt niet als getest, net als in de beslisregel).
// - Bewijsniveau van een aanname: de hoogste trede op de bewijsschaal onder het ondersteunende klantbewijs dat volledig
//   meetelt (register: counted, geen half gewicht). Bureauonderzoek is nooit klantbewijs: dat blijft verkenning.
//
// Zekerheid (drempels, bewust eenvoudig en uitlegbaar)
// - hoog: de laagste kans onder de kritieke aannames is minstens 70% én elke kritieke aanname heeft minstens gedrag op
//   de schaal. Door de plafonds kan 70% pas vanaf een keuze bij een prijs (plafond 75%); meningen alleen nooit.
// - midden: de laagste kans is minstens 50% én elke kritieke aanname heeft minstens gedrag op de schaal.
// - laag: alles daaronder, en zolang er geen kritieke aanname gekozen is.
// Kansen zijn niet gekalibreerd zolang de werkruimte te weinig opgeloste dossiers heeft; het scherm zegt dat één keer.

import { outcomeWithLevel, asEvidenceLevel, testEvidenceLevel, registerLine, registerTally, type EvidenceLevel, type RegisterItem, type RegisterTally } from "./evidence";
import { scaleIndex, scaleLabel, scaleOf, type ScaleStep } from "./evidence-scale";
import { formatProbability } from "./probability-display";

export const CRITICAL_IMPORTANCE = 4;
export const CERTAINTY_HIGH = 0.7;
export const CERTAINTY_MEDIUM = 0.5;
// De laagste trede die nodig is voor midden en hoog.
export const CERTAINTY_MIN_STEP: ScaleStep = "behaviour";

export type Certainty = "low" | "medium" | "high";
export const CERTAINTY_LABEL: Record<Certainty, string> = { low: "laag", medium: "midden", high: "hoog" };

export type StandingAssumptionInput = {
  id: string;
  statement: string;
  importance: number;
  selectedForTest?: boolean;
  probability: { probability: number; band: { low: number; high: number } };
  register: RegisterItem[];
  primaryExperimentId: string | null;
};

export type StandingTestInput = {
  experimentId: string;
  title?: string | null;
  state: string;
  verdict: "pass" | "fail" | "inconclusive" | "running" | null;
  cardStatus?: "approved" | "draft" | null;
  type?: string | null;
  evidenceLevel?: string | null;
  successes?: number | null;
};

export type StandingNext = { title: string; detail: string; href: string };

export type StandingInput = {
  ideaId: string;
  // In de volgorde van de informatiewaarde (zoals de risicokaart); het nummer van een aanname is haar plek in deze lijst.
  assumptions: StandingAssumptionInput[];
  tests: StandingTestInput[];
  // De volgende beste stap (loader: informatiewaarde, of op Besluit de coach).
  next: StandingNext | null;
  calibrated: boolean;
};

export type StandingReason = { label: string; direction: "supports" | "contradicts"; fate: "counted" | "not_counted"; reason: string | null };

export type StandingPrimary = { title: string; status: string; tested: boolean; href: string };

export type StandingAssumption = {
  id: string;
  number: number; // plek op de risicokaart (informatiewaarde)
  statement: string;
  importance: number;
  probability: number;
  band: { low: number; high: number };
  tally: RegisterTally;
  tallyLine: string; // "3 voor (2 tellen mee) · 1 tegen"
  reasons: StandingReason[]; // per item, zonder citaten (soort en bron)
  step: ScaleStep;
  level: EvidenceLevel | null;
  primary: StandingPrimary | null;
  tested: boolean;
};

export type EvidenceStanding = {
  version: 1;
  certainty: Certainty;
  certaintyReason: string;
  critical: { total: number; tested: number };
  lowest: { number: number; probability: number } | null;
  strongest: { step: ScaleStep; level: EvidenceLevel | null; label: string; persons: number | null; sources: number };
  next: StandingNext | null;
  assumptions: StandingAssumption[]; // alleen de kritieke
  calibrated: boolean;
  summary: string; // één regel
  // Afgeleid uit een rapportversie van vóór dit blok (standingFromSnapshot): zonder bewijsregister en zonder de keuze
  // "nu testen"; dat staat er dan ook bij.
  derived?: boolean;
};

// Korte naam van het sterkste bewijs (voor de samenvattende regel).
const STRONGEST_TEXT: Record<EvidenceLevel, string> = {
  opinion: "uitgesproken intentie",
  problem: "probleem in eigen gedrag",
  small_action: "kleine handeling",
  quote: "keuze bij een prijs",
  deposit: "aanbetaling",
  repeat: "herhaalaankoop",
};

const LEVEL_RANK: Record<EvidenceLevel, number> = { opinion: 0, problem: 1, small_action: 2, quote: 3, deposit: 4, repeat: 5 };

export const isCritical = (a: Pick<StandingAssumptionInput, "importance" | "selectedForTest">) => a.importance >= CRITICAL_IMPORTANCE && a.selectedForTest === true;

// Telt een item als volwaardig klantbewijs (voor het niveau op de schaal)?
const fullCustomerSupport = (i: RegisterItem) => i.itemType === "observation" && i.fate === "counted" && i.direction === "supports" && !i.notes.includes("ai_half");

function highestLevel(items: RegisterItem[]): EvidenceLevel | null {
  return items.filter(fullCustomerSupport).reduce<EvidenceLevel | null>((best, i) => (best == null || LEVEL_RANK[i.level] > LEVEL_RANK[best] ? i.level : best), null);
}

const VERDICT_TEXT: Record<"pass" | "fail" | "inconclusive", string> = { pass: "geslaagd", fail: "niet geslaagd", inconclusive: "onbeslist" };

// De status van de hoofdtest in gewone taal: "Geslaagd · niveau: kleine handeling", "loopt", "nog geen hoofdtest".
export function primaryStatus(a: Pick<StandingAssumptionInput, "primaryExperimentId">, tests: StandingTestInput[], ideaId: string): StandingPrimary | null {
  if (!a.primaryExperimentId) return null;
  const t = tests.find((x) => x.experimentId === a.primaryExperimentId);
  const href = `/app/ideas/${ideaId}/experiments/${a.primaryExperimentId}`;
  if (!t) return { title: "Hoofdtest", status: "onbekend", tested: false, href };
  const title = t.title?.trim() || "Hoofdtest";
  const level = asEvidenceLevel(t.evidenceLevel) ?? (t.type ? testEvidenceLevel(t.type) : null);
  if (t.verdict === "pass" || t.verdict === "fail" || t.verdict === "inconclusive") {
    const approved = t.cardStatus !== "draft";
    const status = outcomeWithLevel(VERDICT_TEXT[t.verdict], level) + (approved ? "" : " (Learning Card nog niet goedgekeurd)");
    return { title, status, tested: approved && t.verdict !== "inconclusive", href };
  }
  if (["draft", "ready_for_review", "approved"].includes(t.state)) return { title, status: "nog niet gestart", tested: false, href };
  if (t.state === "live") return { title, status: "loopt", tested: false, href };
  if (t.state === "paused") return { title, status: "gepauzeerd", tested: false, href };
  return { title, status: "afgerond, uitslag nog niet vastgelegd", tested: false, href };
}

function reasonsOf(items: RegisterItem[]): StandingReason[] {
  return items.map((i) => ({
    label: i.itemType === "claim" ? `${i.label} (bureauonderzoek)` : `${i.label}${i.sourceLabel ? ` · ${i.sourceLabel}` : ""}`,
    direction: i.direction,
    fate: i.fate,
    reason: i.reason,
  }));
}

// Personen achter het sterkste bewijs: per interview één persoon, per losse waarneming één, per test het aantal geslaagde
// deelnemers van de Learning Card. Onbekend (null) als een test geen aantal heeft.
function personsAt(items: RegisterItem[], level: EvidenceLevel, tests: StandingTestInput[]): { persons: number | null; sources: number } {
  const keys = new Set(items.filter((i) => fullCustomerSupport(i) && i.level === level).map((i) => i.sourceKey ?? `item:${i.id}`));
  let persons: number | null = 0;
  for (const k of keys) {
    if (k.startsWith("experiment:")) {
      const n = tests.find((t) => t.experimentId === k.slice("experiment:".length))?.successes;
      persons = persons == null || n == null ? null : persons + n;
    } else if (persons != null) persons += 1;
  }
  return { persons, sources: keys.size };
}

const pct = (p: number, calibrated: boolean) => formatProbability(p, calibrated).text;

export function evidenceStanding(input: StandingInput): EvidenceStanding {
  const all = input.assumptions.map((a, i) => ({ a, number: i + 1 }));
  const critical = all.filter(({ a }) => isCritical(a));
  const rows: StandingAssumption[] = critical.map(({ a, number }) => {
    const tally = registerTally(a.register);
    const level = highestLevel(a.register);
    const primary = primaryStatus(a, input.tests, input.ideaId);
    return {
      id: a.id,
      number,
      statement: a.statement,
      importance: a.importance,
      probability: a.probability.probability,
      band: a.probability.band,
      tally,
      tallyLine: registerLine(tally),
      reasons: reasonsOf(a.register),
      step: scaleOf(level),
      level,
      primary,
      tested: !!primary?.tested,
    };
  });

  // Sterkste bewijs over alle aannames heen (elk item één keer).
  const seen = new Set<string>();
  const items: RegisterItem[] = [];
  for (const { a } of all) {
    for (const i of a.register) {
      if (i.id) {
        const key = `${i.itemType}:${i.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      items.push(i);
    }
  }
  const top = highestLevel(items);
  const strongestPeople = top ? personsAt(items, top, input.tests) : { persons: null, sources: 0 };
  const strongest = { step: scaleOf(top), level: top, label: top ? STRONGEST_TEXT[top] : "nog geen echte waarneming", ...strongestPeople };

  // Zekerheid: laagste kans onder de kritieke aannames plus de zwakste trede onder hen.
  const lowestRow = rows.reduce<StandingAssumption | null>((low, r) => (low == null || r.probability < low.probability ? r : low), null);
  const weakestStep = rows.reduce<ScaleStep | null>((w, r) => (w == null || scaleIndex(r.step) < scaleIndex(w) ? r.step : w), null);
  let certainty: Certainty = "low";
  let certaintyReason: string;
  if (!lowestRow || !weakestStep) {
    certaintyReason = "nog geen kritieke aanname gekozen om te testen (belangrijkheid 4 of 5)";
  } else {
    const enoughStep = scaleIndex(weakestStep) >= scaleIndex(CERTAINTY_MIN_STEP);
    if (enoughStep && lowestRow.probability >= CERTAINTY_HIGH) certainty = "high";
    else if (enoughStep && lowestRow.probability >= CERTAINTY_MEDIUM) certainty = "medium";
    certaintyReason = `laagste kans onder de kritieke aannames ${pct(lowestRow.probability, input.calibrated)} (aanname ${lowestRow.number}); zwakste bewijs: ${scaleLabel(weakestStep).toLowerCase()}`;
  }
  const tested = rows.filter((r) => r.tested).length;
  const persons = strongest.persons != null && top ? ` (${strongest.persons} ${strongest.persons === 1 ? "persoon" : "personen"})` : "";
  const summary = [
    `Zekerheid: ${CERTAINTY_LABEL[certainty]}`,
    `${tested} van ${rows.length} kritieke ${rows.length === 1 ? "aanname" : "aannames"} getest`,
    `sterkste bewijs: ${strongest.label}${persons}`,
    ...(input.next ? [`volgende stap: ${lowerFirst(input.next.title)}`] : []),
  ].join(" · ");
  return {
    version: 1,
    certainty,
    certaintyReason,
    critical: { total: rows.length, tested },
    lowest: lowestRow ? { number: lowestRow.number, probability: lowestRow.probability } : null,
    strongest,
    next: input.next,
    assumptions: rows,
    calibrated: input.calibrated,
    summary,
  };
}

const lowerFirst = (s: string) => (s && !/^[A-Z]{2}/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const upperFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// De volgende beste stap uit de informatiewaarde: de eerste aanname in de rangorde, met de passende test en de reden.
export function nextFromInformationValue(
  ideaId: string,
  ranked: { id: string; voi: { test: { label: string; short?: string; external: boolean }; reason: string } }[],
): StandingNext | null {
  const first = ranked[0];
  if (!first) return null;
  const test = first.voi.test.external ? (first.voi.test.short ?? first.voi.test.label) : first.voi.test.label;
  return { title: `${upperFirst(test)} (aanname 1)`, detail: first.voi.reason, href: `/app/ideas/${ideaId}/experiments?assumption=${first.id}` };
}

// Een opgeslagen blok uit een rapportmomentopname, of null.
export function asEvidenceStanding(v: unknown): EvidenceStanding | null {
  const s = v as Partial<EvidenceStanding> | null | undefined;
  return s && s.version === 1 && typeof s.summary === "string" && Array.isArray(s.assumptions) ? (s as EvidenceStanding) : null;
}

// ---------------------------------------------------------------------------
// Terugval voor rapporten van vóór dit blok (zoals sheetFromSnapshot voor het beslisblad). Wat een oude momentopname
// wel heeft: per aanname belangrijkheid, status en kans; voor het dossier de bewijsladder. Wat ze niet heeft: het
// bewijsregister, de keuze "nu testen" en de hoofdtest. Daarom:
// - kritiek = belangrijkheid 4 of 5 (zonder de keuze om nu te testen);
// - getest = status ondersteund of weerlegd (de uitslag die de aanname kreeg);
// - zwakste trede = het sterkste klantbewijs van het dossier (er is geen niveau per aanname);
// - geen telling en geen volgende stap.
// ---------------------------------------------------------------------------

export type LegacyStandingSnapshot = {
  standing?: unknown;
  assumptions: { statement: string; importance: number; status: string; probability?: { point: number; low: number; high: number } | null }[];
  observationCounts?: { highest: { label: string; level?: string } | null } | null;
  calibration?: { calibrated: boolean } | null;
};

// Labels van de bewijsladder (ook van vóór de bewijsschaal) terug naar het bewijsniveau.
const LEGACY_LADDER_LEVEL: Record<string, EvidenceLevel> = {
  "Uitgesproken belangstelling": "opinion",
  "Probleem in eigen gedrag": "problem",
  "Kleine handeling (aanmelding)": "small_action",
  "Kleine handeling (aanmelding, demo-aanvraag)": "small_action",
  "Concrete aanvraag of keuze bij prijs": "quote",
  "Offerte of keuze bij prijs": "quote",
  Aanbetaling: "deposit",
  "Herhaalde aankoop": "repeat",
};

const LEGACY_STATUS: Record<string, string> = { untested: "niet getest", testing: "wordt getest", supported: "ondersteund", refuted: "weerlegd", inconclusive: "onbeslist" };

export function standingFromSnapshot(r: LegacyStandingSnapshot): EvidenceStanding {
  const stored = asEvidenceStanding(r.standing);
  if (stored) return stored;
  const calibrated = !!r.calibration?.calibrated;
  const highest = r.observationCounts?.highest ?? null;
  const top = highest ? (asEvidenceLevel(highest.level) ?? LEGACY_LADDER_LEVEL[highest.label] ?? null) : null;
  const step = scaleOf(top);
  const empty: RegisterTally = { supports: 0, supportsCounted: 0, contradicts: 0, contradictsCounted: 0, notCounted: 0 };
  const rows: StandingAssumption[] = r.assumptions
    .map((a, i) => ({ a, number: i + 1 }))
    .filter(({ a }) => a.importance >= CRITICAL_IMPORTANCE && a.probability)
    .map(({ a, number }) => {
      const tested = a.status === "supported" || a.status === "refuted";
      return {
        id: `legacy-${number}`,
        number,
        statement: a.statement,
        importance: a.importance,
        probability: a.probability!.point,
        band: { low: a.probability!.low, high: a.probability!.high },
        tally: empty,
        tallyLine: "telling niet vastgelegd in deze versie",
        reasons: [],
        step,
        level: top,
        primary: { title: "Status", status: LEGACY_STATUS[a.status] ?? a.status, tested, href: "" },
        tested,
      };
    });
  const lowestRow = rows.reduce<StandingAssumption | null>((low, x) => (low == null || x.probability < low.probability ? x : low), null);
  let certainty: Certainty = "low";
  let certaintyReason = "nog geen kritieke aanname (belangrijkheid 4 of 5) met een kans in deze versie";
  if (lowestRow) {
    const enoughStep = scaleIndex(step) >= scaleIndex(CERTAINTY_MIN_STEP);
    if (enoughStep && lowestRow.probability >= CERTAINTY_HIGH) certainty = "high";
    else if (enoughStep && lowestRow.probability >= CERTAINTY_MEDIUM) certainty = "medium";
    certaintyReason = `laagste kans onder de kritieke aannames ${pct(lowestRow.probability, calibrated)} (aanname ${lowestRow.number}); sterkste klantbewijs van het dossier: ${scaleLabel(step).toLowerCase()}`;
  }
  const tested = rows.filter((x) => x.tested).length;
  const label = top ? STRONGEST_TEXT[top] : "nog geen echte waarneming";
  return {
    version: 1,
    certainty,
    certaintyReason,
    critical: { total: rows.length, tested },
    lowest: lowestRow ? { number: lowestRow.number, probability: lowestRow.probability } : null,
    strongest: { step, level: top, label, persons: null, sources: 0 },
    next: null,
    assumptions: rows,
    calibrated,
    summary: [`Zekerheid: ${CERTAINTY_LABEL[certainty]}`, `${tested} van ${rows.length} kritieke ${rows.length === 1 ? "aanname" : "aannames"} getest`, `sterkste bewijs: ${label}`].join(" · "),
    derived: true,
  };
}
