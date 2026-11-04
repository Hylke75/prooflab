// Beslisblad (fase B6): pagina 1 van elk rapport. Eén pagina met het besluit (Doorgaan, Stoppen of Nog niet
// beslisbaar) en het bewijsniveau, de drie sterkste bewijsstukken met hun bron, wat níét bewezen is (hooguit drie
// punten) en de volgende stap met een datum. Het volledige dossier volgt als bijlage, in de bestaande opbouw.
//
// Puur en deterministisch: geen database, geen AI. lib/report.ts bouwt de invoer bij het maken van een rapportversie
// en bewaart het resultaat in de momentopname (veld `sheet`), zodat een rapport later precies hetzelfde beslisblad
// toont. Oudere rapporten zonder dat veld krijgen een beslisblad dat uit de bestaande velden van de momentopname is
// afgeleid (sheetFromSnapshot); dat staat er dan ook bij.
//
// De regels voor "Nog niet beslisbaar", expliciet:
// 1. Er is geen definitief besluit: geen besluit, of het laatste besluit is verder testen, bijsturen of pauzeren.
//    Alleen doorgaan en stoppen ronden de stap Besluit af (getDossierStatus, lib/domain/dossier-status.ts).
// 2. Er is geen echt bewijs: geen enkele stap heeft een geverifieerde bron of een echte (niet-oefen, niet-synthetische)
//    waarneming (getDossierStatus().stepsWithEvidence = 0).
// 3. Doorgaan zonder gemeten uitslag: er is geen afgeronde test met uitslag geslaagd of niet geslaagd (stap Testen
//    niet klaar). Doorgaan vraagt gemeten gedrag; stoppen mag op tegenbewijs uit bronnen of gesprekken.
// Een besluit dat afwijkt van de beslisregel blijft het besluit (de mens beslist, met motivering), maar staat bij
// wat niet bewezen is.

import type { DossierStatus } from "@/lib/domain/dossier-status";
import { getDossierStatus, isConclusiveDecision } from "@/lib/domain/dossier-status";
import { EVIDENCE_LEVELS, LEVEL_SHORT, type EvidenceLevel } from "@/lib/domain/evidence";
import type { EvidenceLadder } from "@/lib/domain/dossier-label";

export type SheetVerdict = "continue" | "stop" | "undecidable";
export const SHEET_VERDICT_LABELS: Record<SheetVerdict, string> = { continue: "Doorgaan", stop: "Stoppen", undecidable: "Nog niet beslisbaar" };

export type SheetEvidence = {
  text: string; // één zin
  source: string; // waar het vandaan komt, leesbaar
  note: number | null; // voetnoot in de bronnenlijst (alleen bij bronnen)
  url: string | null;
  level: string; // bewijsniveau in woorden
  against: boolean; // tegenbewijs
};

export type DecisionSheet = {
  verdict: SheetVerdict;
  verdictLabel: string;
  // Waarom "Nog niet beslisbaar" (leeg bij doorgaan of stoppen).
  reasons: string[];
  // Het vastgelegde besluit zelf, ook als het niet definitief is ("Verder testen · 4 november 2026").
  decisionLine: string | null;
  evidenceLevel: string;
  ladder: string | null;
  strongest: SheetEvidence[]; // hooguit 3
  notProven: string[]; // hooguit 3
  notProvenMore: number; // hoeveel punten er nog meer zijn (staan in de bijlage)
  nextStep: { text: string; date: string | null; dateLabel: string };
  // Afgeleid uit een rapport van vóór het beslisblad.
  derived: boolean;
};

export type SheetInput = {
  status: Pick<DossierStatus, "steps" | "stepsWithEvidence">;
  decision: { action: string; label: string; decidedOn: string; nextStep: string | null; extendWeeks: number | null; ruleMet: boolean | null; deviation: boolean } | null;
  evidenceLevel: string;
  ladder: string | null;
  claims: { statement: string; verified: boolean; contradicted: boolean; notes: number[]; source: string | null; url: string | null; strong: boolean }[];
  observations: { text: string; source: string; level: EvidenceLevel; strength: number; against: boolean; group: string }[];
  assumptions: { statement: string; importance: number; status: string; evidence: number }[];
  decisiveQuestion: { question: string; answered: boolean; verifiedClaims: number } | null;
  paymentShown: boolean | null; // null = onbekend (oudere rapporten)
  labelMissing: string[];
  dates: { today: string; sprintEnd: string | null; decisionDeadline: string | null; outcomeDue: string | null };
  fallbackNext: string | null; // de volgende actie van de coach (nextAction), als het besluit geen volgende stap noemt
};

const MAX = 3;
const LEVEL_INDEX = (l: EvidenceLevel) => EVIDENCE_LEVELS.findIndex((x) => x.level === l);
const STATUS_TEXT: Record<string, string> = { untested: "niet getest", testing: "wordt getest", inconclusive: "onbeslist", refuted: "weerlegd", supported: "ondersteund" };

export const sheetDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }) : "onbekend";

export function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Eén zin: tot de eerste zinsgrens, hooguit `max` tekens (afgekapt op een woordgrens).
export function oneSentence(s: string, max = 200): string {
  const clean = s.replace(/\s+/g, " ").trim();
  const m = clean.match(/^(.{20,}?[.!?])(\s|$)/);
  let out = m ? m[1] : clean;
  if (out.length > max) out = `${out.slice(0, max).replace(/\s+\S*$/, "")}…`;
  else if (!/[.!?…]$/.test(out)) out = `${out}.`;
  return out;
}

// De drie sterkste bewijsstukken: geverifieerde bronnen en echte waarnemingen, gesorteerd op bewijsniveau. Per
// persoon of test hooguit één stuk (de sterkste), zodat één enthousiaste geïnterviewde niet drie plekken vult. Bij
// gelijk niveau gaat een geverifieerde bron vóór een mening, en een officiële of primaire bron vóór een andere.
export function strongestEvidence(input: Pick<SheetInput, "claims" | "observations">): SheetEvidence[] {
  type Cand = SheetEvidence & { rank: number; tie: number; group: string };
  const perGroup = new Map<string, Cand>();
  for (const o of input.observations) {
    const c: Cand = { text: oneSentence(o.text), source: o.source, note: null, url: null, level: LEVEL_SHORT[o.level], against: o.against, rank: LEVEL_INDEX(o.level), tie: o.strength, group: o.group };
    const prev = perGroup.get(o.group);
    if (!prev || c.rank > prev.rank || (c.rank === prev.rank && c.tie > prev.tie)) perGroup.set(o.group, c);
  }
  const cands: Cand[] = [...perGroup.values()];
  input.claims
    .filter((c) => c.verified && c.notes.length > 0)
    .forEach((c, i) =>
      cands.push({
        text: oneSentence(c.statement),
        source: c.source ?? "Bron in de bronnenlijst",
        note: c.notes[0],
        url: c.url,
        level: c.contradicted ? "geverifieerde bron, deels tegengesproken" : "geverifieerde bron",
        against: false,
        rank: 0,
        // Bij bureauonderzoek: officiële of primaire bron eerst, tegengesproken bronnen achteraan.
        tie: 10 + (c.strong ? 2 : 1) - (c.contradicted ? 2 : 0) - i / 1000,
        group: `claim:${i}`,
      }),
    );
  return cands
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.rank - a.c.rank || b.c.tie - a.c.tie || a.i - b.i)
    .slice(0, MAX)
    .map(({ c }) => ({ text: c.text, source: c.source, note: c.note, url: c.url, level: c.level, against: c.against }));
}

// Wat níét bewezen is: de beslissende vraag als die open is, kritieke aannames (belang 4 of 5) zonder voldoende
// bewijs, en ontbrekende metingen. Om en om, zodat elk soort punt een plek krijgt; hooguit drie.
export function notProven(input: SheetInput): { items: string[]; more: number } {
  const question: string[] = [];
  const dq = input.decisiveQuestion;
  if (dq && !(dq.answered && dq.verifiedClaims > 0)) {
    question.push(
      dq.answered
        ? `De beslissende vraag heeft nog geen geverifieerde bron: ${dq.question}`
        : `De beslissende vraag is nog niet beantwoord: ${dq.question}`,
    );
  } else if (!dq) {
    question.push("Er is geen beslissende onderzoeksvraag vastgelegd.");
  }
  const critical = input.assumptions
    .filter((a) => a.importance >= 4 && a.status !== "supported")
    .map((a, i) => ({ a, i }))
    .sort((x, y) => y.a.importance - x.a.importance || x.a.evidence - y.a.evidence || x.i - y.i)
    .map(({ a }) => `Kritieke aanname ${a.status === "refuted" ? "weerlegd" : "niet aangetoond"} (${STATUS_TEXT[a.status] ?? a.status}): ${a.statement}`);
  const measure: string[] = [];
  const test = input.status.steps.find((s) => s.key === "test");
  if (test && test.state !== "done") measure.push(`Nog geen afgeronde test met een uitslag (geslaagd of niet geslaagd): ${test.statusLabel.toLowerCase()}.`);
  if (input.paymentShown === false) measure.push("Betaalbereidheid is niet gemeten: nog geen aanbetaling of herhaalaankoop.");
  if (input.decision?.deviation) measure.push("Het besluit wijkt af van de vooraf vastgelegde beslisregel (motivering in de bijlage).");
  for (const m of input.labelMissing) {
    const line = `Voor een hoger bewijsniveau ontbreekt: ${m}.`;
    if (!measure.includes(line)) measure.push(line);
  }
  const all: string[] = [];
  const lists = [question, critical, measure];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) all.push(l[i]);
  return { items: all.slice(0, MAX), more: Math.max(0, all.length - MAX) };
}

// De volgende stap met een datum. Tekst: de volgende stap uit het besluit, anders de volgende actie van de coach.
// Datum, in deze volgorde: einde van de testperiode (verder testen), de meetdatum van de uitkomst (na doorgaan of
// stoppen), het einde van de sprint, de beslisdatum. Ligt geen van die in de toekomst, dan staat er dat er nog geen
// datum is; nooit een verzonnen datum.
export function nextStepOf(input: SheetInput): DecisionSheet["nextStep"] {
  const d = input.decision;
  const today = input.dates.today;
  const future = (x: string | null) => (x && x.slice(0, 10) >= today ? x.slice(0, 10) : null);
  let date: string | null = null;
  let dateLabel = "Nog geen datum vastgelegd";
  const testUntil = d && d.extendWeeks ? addDaysIso(d.decidedOn, d.extendWeeks * 7) : null;
  if (testUntil) {
    date = testUntil;
    dateLabel = "einde van de testperiode";
  } else if (d && isConclusiveDecision(d.action) && input.dates.outcomeDue) {
    date = input.dates.outcomeDue.slice(0, 10);
    dateLabel = "meetdatum van de uitkomst";
  } else if (future(input.dates.sprintEnd)) {
    date = future(input.dates.sprintEnd);
    dateLabel = "einde van de sprint";
  } else if (future(input.dates.decisionDeadline)) {
    date = future(input.dates.decisionDeadline);
    dateLabel = "beslisdatum";
  }
  const own = d?.nextStep?.trim();
  const text = own
    ? oneSentence(own, 240)
    : testUntil
      ? `Verder testen tot ${sheetDate(testUntil)}; daarna volgt het definitieve besluit (doorgaan of stoppen).`
      : input.fallbackNext
        ? oneSentence(input.fallbackNext, 240)
        : "Leg bij het besluit de concrete volgende stap vast.";
  return { text, date, dateLabel };
}

export function buildDecisionSheet(input: SheetInput, derived = false): DecisionSheet {
  const d = input.decision;
  const reasons: string[] = [];
  if (!d) reasons.push("Er is nog geen besluit vastgelegd.");
  else if (!isConclusiveDecision(d.action)) reasons.push(`Het laatste besluit is "${d.label}": dat is geen definitief besluit (doorgaan of stoppen).`);
  if (input.status.stepsWithEvidence === 0) reasons.push("Er is nog geen echt bewijs: geen geverifieerde bron en geen echte waarneming.");
  const test = input.status.steps.find((s) => s.key === "test");
  if (d?.action === "continue" && test && test.state !== "done") reasons.push("Doorgaan vraagt een afgeronde test met een uitslag; die is er nog niet.");
  const verdict: SheetVerdict = reasons.length ? "undecidable" : d!.action === "continue" ? "continue" : "stop";
  const np = notProven(input);
  return {
    verdict,
    verdictLabel: SHEET_VERDICT_LABELS[verdict],
    reasons,
    decisionLine: d ? `${d.label} · vastgelegd op ${sheetDate(d.decidedOn)}` : null,
    evidenceLevel: input.evidenceLevel,
    ladder: input.ladder,
    strongest: strongestEvidence(input),
    notProven: np.items,
    notProvenMore: np.more,
    nextStep: nextStepOf(input),
    derived,
  };
}

// ---------------------------------------------------------------------------
// Oudere rapporten: het beslisblad afgeleid uit de bestaande velden van de momentopname.
// ---------------------------------------------------------------------------

// De velden van een momentopname die het afgeleide beslisblad leest (alle rapportversies hebben ze).
export type LegacySnapshot = {
  generatedAt: string;
  label: string;
  labelMissing: string[];
  observationCounts?: EvidenceLadder;
  questions: { position: number; question: string; status: string }[];
  claims: { statement: string; statusKey: string; notes: number[]; contradicted: boolean; type?: string }[];
  counts: { claims: number; verified: number };
  assumptions: { statement: string; importance: number; status: string; evidence: number }[];
  experiments: { title: string; type: string; state: string; n: number; successes: number; metric: string; verdict: string | null; level?: unknown; selfReported?: boolean }[];
  learningCards: { verdict: string; title?: string | null }[];
  decision: { action: string; nextStep: string | null; at: string; extendWeeks?: number | null; rule?: { deviation: unknown } | null } | null;
  sources: { n: number; title: string; url: string | null; publisher: string | null; type: string; primary: boolean }[];
  sheet?: DecisionSheet;
};

// Labels zoals oudere rapporten ze opsloegen, terug naar de actie.
const LEGACY_ACTIONS: Record<string, string> = {
  Doorgaan: "continue",
  Stoppen: "stop",
  Bijsturen: "adjust",
  Pauzeren: "pause",
  "Verder testen": "test_more",
  "Doorgaan met testen (verlengde testfase)": "extend",
};

const LEVELS = new Set(EVIDENCE_LEVELS.map((l) => l.level as string));
const asLevel = (v: unknown): EvidenceLevel => (typeof v === "string" && LEVELS.has(v) ? (v as EvidenceLevel) : "opinion");

export function sheetFromSnapshot(r: LegacySnapshot, ladderLine: string | null): DecisionSheet {
  if (r.sheet) return r.sheet;
  const action = r.decision ? (LEGACY_ACTIONS[r.decision.action] ?? "unknown") : null;
  const q = [...r.questions].sort((a, b) => a.position - b.position)[0] ?? null;
  const verdictCards = r.learningCards.filter((c) => c.verdict === "pass" || c.verdict === "fail").length;
  const measured = r.experiments.filter((e) => e.n > 0 && !["draft", "ready_for_review"].includes(e.state));
  const status = getDossierStatus({
    questions: r.questions.length,
    claims: r.counts.claims,
    verifiedClaims: r.counts.verified,
    // Oudere momentopnamen koppelen bevindingen niet aan een vraag: beantwoord met een geverifieerde bron in het dossier.
    decisiveQuestion: q ? { status: q.status, verifiedClaims: r.counts.verified } : null,
    assumptions: r.assumptions.length,
    criticalWithPrimaryTest: 0,
    assumptionsWithEvidence: r.assumptions.filter((a) => a.evidence > 0).length,
    experiments: r.experiments.length,
    experimentsLive: r.experiments.filter((e) => e.state === "live" || e.state === "paused").length,
    experimentsEnded: r.experiments.filter((e) => ["ended", "analyzed", "decided"].includes(e.state)).length,
    testsWithVerdict: verdictCards,
    realTestObservations: measured.length,
    decisions: r.decision ? 1 : 0,
    latestDecisionAction: action,
  });
  const src = new Map(r.sources.map((s) => [s.n, s]));
  return buildDecisionSheet(
    {
      status,
      decision: r.decision
        ? { action: action ?? "unknown", label: r.decision.action, decidedOn: r.decision.at.slice(0, 10), nextStep: r.decision.nextStep, extendWeeks: action === "extend" ? (r.decision.extendWeeks ?? null) : null, ruleMet: null, deviation: !!r.decision.rule?.deviation }
        : null,
      evidenceLevel: r.label,
      ladder: ladderLine,
      claims: r.claims.map((c) => {
        const s = src.get(c.notes[0]);
        return { statement: c.statement, verified: c.statusKey === "verified", contradicted: c.contradicted, notes: c.notes, source: s ? `${s.publisher ? `${s.publisher}, ` : ""}${s.title}` : null, url: s?.url ?? null, strong: !!s?.primary };
      }),
      observations: measured.map((e) => ({
        text: `${e.successes} van ${e.n} deelnemers: ${e.metric}${e.selfReported ? " (zelfrapportage)" : ""}.`,
        source: `Test "${e.title}" (${e.type})`,
        level: asLevel(e.level),
        strength: e.selfReported ? 0 : 1,
        against: e.verdict === "fail",
        group: `exp:${e.title}`,
      })),
      assumptions: r.assumptions,
      decisiveQuestion: q ? { question: q.question, answered: q.status === "answered", verifiedClaims: r.counts.verified } : null,
      paymentShown: r.observationCounts ? r.observationCounts.paymentShown : null,
      labelMissing: r.labelMissing,
      dates: { today: r.generatedAt.slice(0, 10), sprintEnd: null, decisionDeadline: null, outcomeDue: null },
      fallbackNext: null,
    },
    true,
  );
}

// ---------------------------------------------------------------------------
// Bereikbare jaaromzet: geen "€ 0" als de marktomvang niet is vastgesteld.
// ---------------------------------------------------------------------------

const NOT_ESTABLISHED = /niet vastgesteld/i;

export type RevenueKpi = { established: boolean; value: string; note: string };

// established ontbreekt in rapporten van vóór B6; dan volgt het uit het label van de berekening ("marktomvang niet
// vastgesteld"). Een uitkomst van € 0 of minder is ook geen vastgestelde omzet.
export function reachableRevenue(s: { somRevenue: number | null; status: string; established?: boolean } | null | undefined): RevenueKpi {
  if (!s) return { established: false, value: "Niet vastgesteld", note: "Er is nog geen marktomvang berekend." };
  const established = s.established ?? !NOT_ESTABLISHED.test(s.status);
  if (!established)
    return { established: false, value: "Niet vastgesteld", note: "Het aantal potentiële klanten (basisomvang) heeft nog geen geverifieerde bron of onderbouwde schatting." };
  if (s.somRevenue == null || !Number.isFinite(s.somRevenue) || s.somRevenue <= 0)
    return { established: false, value: "Niet vastgesteld", note: "De berekening komt op € 0: een of meer factoren (zoals omzet per klant of het winbare aandeel) staan nog op nul." };
  return { established: true, value: `€ ${Math.round(s.somRevenue).toLocaleString("nl-NL")}`, note: s.status };
}
