// Prediction core (docs/ProofLab_Voorspelkracht_v1.md §3.1–3.4): a measurable outcome six months after the
// decision, a base rate as starting point, blind probability forecasts at four fixed moments, an interim
// check-in at three months and a Brier score once the real outcome is known. Pure functions only, on
// calendar dates (YYYY-MM-DD) so results do not depend on the server's time zone.

import { stepsDone } from "@/lib/steps";
import type { IdeaProgress } from "@/lib/domain/coach";

export const FORECAST_MOMENTS = ["intake", "research", "experiment", "decision"] as const;
export type ForecastMoment = (typeof FORECAST_MOMENTS)[number];
export type ForecasterKind = "consultant" | "client" | "ai";
export type Achieved = "yes" | "partial" | "no";
export type OnTrack = "yes" | "unsure" | "no";
// Welke vraag zes maanden na het definitieve besluit wordt gesteld (golf B, punt 1). Na een stop of pauze vervalt
// de oorspronkelijke uitkomstvraag: dan volgt "Was stoppen achteraf terecht?".
export type OutcomeQuestion = "success" | "stop_review";
export type Justified = "yes" | "no" | "unknown";

export const MOMENT_LABELS: Record<ForecastMoment, { label: string; when: string }> = {
  intake: { label: "Na de intake", when: "Voordat er onderzoek is gedaan" },
  research: { label: "Na het marktonderzoek", when: "De marktverkenning heeft bronnen en alternatieven" },
  experiment: { label: "Na het eerste experiment", when: "De eerste test is afgerond" },
  decision: { label: "Bij het besluit", when: "Na de Reality Check, vóór het besluit" },
};

export const FORECASTER_LABELS: Record<ForecasterKind, string> = { consultant: "Consultant", client: "Opdrachtgever", ai: "AI" };
export const ACHIEVED_LABELS: Record<Achieved, string> = { yes: "Gehaald", partial: "Deels gehaald", no: "Niet gehaald" };
export const ON_TRACK_LABELS: Record<OnTrack, string> = { yes: "Op koers", unsure: "Onzeker", no: "Niet op koers" };
export const JUSTIFIED_LABELS: Record<Justified, string> = { yes: "Ja, terecht", no: "Nee, onterecht", unknown: "Onbekend" };
export const STOP_REVIEW_QUESTION = "Was stoppen achteraf terecht?";

// De uitkomstvraag die hoort bij het besluit dat de klok start (dezelfde regel als stamp_outcome_question in de database).
export function outcomeQuestionFor(action: string): OutcomeQuestion {
  return action === "stop" || action === "pause" ? "stop_review" : "success";
}

// Product owner decision: the outcome is measured six months after the decision, with a check-in at three.
export const OUTCOME_HORIZON_MONTHS = 6;
export const CHECKIN_AFTER_MONTHS = 3;
// People and the model forecast between 5% and 95%: certainty is never on offer.
export const PROBABILITY_MIN = 0.05;
export const PROBABILITY_MAX = 0.95;
// Forecasts for the decision moment stay open for the decision session (client confirmation) after the decision.
export const DECISION_GRACE_DAYS = 14;
// Own base rates are shown from this many resolved ideas (matches own_base_rate's default).
export const OWN_BASE_RATE_MIN = 10;
// reference_class value when the consultant finds no usable reference class.
export const NO_REFERENCE = "none";
export const OWN_REFERENCE_PREFIX = "own:";

// yes = 1, partial = 0.5, no = 0 (the same mapping the database uses in forecast_scores).
export function outcomeValue(a: Achieved): number {
  return a === "yes" ? 1 : a === "partial" ? 0.5 : 0;
}

// Brier score of one forecast: squared distance between the probability and what happened. 0 is perfect,
// 0.25 is what always saying 50% earns, 1 is confidently wrong.
export function brier(probability: number, achieved: Achieved): number {
  const d = probability - outcomeValue(achieved);
  return d * d;
}

export function clampProbability(p: number): number {
  return Math.min(PROBABILITY_MAX, Math.max(PROBABILITY_MIN, p));
}

export type Aggregate = { n: number; mean: number; min: number; max: number; sd: number };

// Mean and spread of the forecasts at one moment. sd is the population standard deviation.
export function aggregate(probabilities: number[]): Aggregate | null {
  const list = probabilities.filter((p) => Number.isFinite(p));
  if (list.length === 0) return null;
  const n = list.length;
  const mean = list.reduce((s, p) => s + p, 0) / n;
  const variance = list.reduce((s, p) => s + (p - mean) ** 2, 0) / n;
  return { n, mean, min: Math.min(...list), max: Math.max(...list), sd: Math.sqrt(variance) };
}

// Short Dutch explanation of one Brier contribution. One dossier says little on its own; calibration only
// shows across many resolved dossiers (the outcome page says so next to the table).
export function explainBrier(probability: number, achieved: Achieved): string {
  const score = brier(probability, achieved);
  const pct = Math.round(probability * 100);
  const happened = achieved === "yes" ? "het doel is gehaald" : achieved === "partial" ? "het doel is deels gehaald" : "het doel is niet gehaald";
  const quality = score <= 0.1 ? "dicht bij de uitkomst" : score < 0.25 ? "beter dan een gok van 50%" : score === 0.25 ? "even goed als een gok van 50%" : "verder van de uitkomst dan een gok van 50%";
  return `${pct}% gegeven en ${happened}: ${quality}.`;
}

// ---------------------------------------------------------------------------
// Calendar maths
// ---------------------------------------------------------------------------

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

// Adds calendar months; the day is clamped to the end of a shorter month (31 Aug + 6 months = 28/29 Feb).
export function addMonths(date: string, months: number): string {
  const m = ISO.exec(date);
  if (!m) throw new Error(`Ongeldige datum: ${date}`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1 + months;
  const year = y + Math.floor(mo / 12);
  const month = ((mo % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(Number(m[3]), last);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Bij de stopvraag ligt de vraagdatum altijd zes maanden na het besluit (de meetdatum hoort bij de vervallen succesvraag).
export function outcomeDueForQuestion(question: OutcomeQuestion, decidedOn: string, measureDate: string | null | undefined): string {
  return question === "stop_review" ? outcomeDueFor(decidedOn) : outcomeDueAtDecision(decidedOn, measureDate);
}

// The outcome is measured six months after the (calendar) date of the decision.
export function outcomeDueFor(decisionDate: string): string {
  return addMonths(decisionDate, OUTCOME_HORIZON_MONTHS);
}

// De geplande meetdatum van het succescriterium ligt na de beslisdatum en binnen het venster van zes maanden
// daarna. Geeft een Nederlandse melding terug, of null als de datum past.
export function measureWindowProblem(measureDate: string, decisionDate: string): string | null {
  if (!ISO.test(measureDate)) return "Kies een geldige meetdatum.";
  if (!ISO.test(decisionDate)) return null;
  if (measureDate <= decisionDate) return `De meetdatum moet na de beslisdatum (${decisionDate}) liggen: je meet het effect van het besluit.`;
  const end = outcomeDueFor(decisionDate);
  if (measureDate > end) return `De meetdatum valt buiten het venster van ${OUTCOME_HORIZON_MONTHS} maanden na de beslisdatum. Kies uiterlijk ${end}.`;
  return null;
}

// De uitkomstdatum bij een besluit: de vooraf geplande meetdatum als die nog na het besluit en binnen zes maanden
// valt, anders zes maanden na het besluit.
export function outcomeDueAtDecision(decidedOn: string, measureDate: string | null | undefined): string {
  return measureDate && measureWindowProblem(measureDate, decidedOn) === null ? measureDate : outcomeDueFor(decidedOn);
}

// The interim check-in opens three months after the decision, i.e. three months before the outcome date.
export function checkinDueFor(outcomeDue: string): string {
  return addMonths(outcomeDue, CHECKIN_AFTER_MONTHS - OUTCOME_HORIZON_MONTHS);
}

// ---------------------------------------------------------------------------
// Moments and follow-up, derived from the state of the dossier
// ---------------------------------------------------------------------------

// The part of the dossier the prediction loop needs, loaded with the progress of an idea.
export type ForecastState = {
  outcomeDefined: boolean;
  baseRateChosen: boolean;
  outcomeDue: string | null;
  clockStart?: string | null; // decision date that started the six-month clock (stored since 2026-11)
  ownMoments: ForecastMoment[]; // moments at which the current user already forecast
  checkins: number;
  // Uitkomst vastgelegd: bij de succesvraag de uitkomst, bij de stopvraag het antwoord op "was stoppen terecht?".
  resolved: boolean;
  // Ontbreekt bij oudere databases: dan geldt de succesvraag.
  question?: OutcomeQuestion;
  today: string;
};

export type MomentInput = {
  outcomeDefined: boolean;
  resolved: boolean;
  marketDone: boolean;
  experimentEnded: boolean;
  realityCheckDone: boolean;
  outcomeDue: string | null;
  clockStart?: string | null;
  // Na een stop of pauze is er geen slagingskans meer om te voorspellen.
  stopped?: boolean;
  today: string;
};

// Only the latest reached moment is open: a missed earlier moment stays missed, because a forecast made
// with later knowledge is not a forecast at that moment. Nothing is open before the outcome is defined or
// after it is known; the decision moment closes two weeks after the decision that started the clock.
export function openMoment(i: MomentInput): ForecastMoment | null {
  if (!i.outcomeDefined || i.resolved || i.stopped) return null;
  if (i.realityCheckDone) {
    if (!i.outcomeDue) return "decision";
    const decidedOn = i.clockStart ?? addMonths(i.outcomeDue, -OUTCOME_HORIZON_MONTHS);
    return i.today <= addDaysIso(decidedOn, DECISION_GRACE_DAYS) ? "decision" : null;
  }
  if (i.experimentEnded) return "experiment";
  if (i.marketDone) return "research";
  return "intake";
}

export function momentInput(p: IdeaProgress, f: ForecastState): MomentInput {
  return {
    outcomeDefined: f.outcomeDefined,
    resolved: f.resolved,
    marketDone: stepsDone(p).market,
    experimentEnded: p.experimentsEnded > 0,
    realityCheckDone: !!p.latestRealityCheckAt,
    outcomeDue: f.outcomeDue,
    clockStart: f.clockStart ?? null,
    stopped: f.question === "stop_review",
    today: f.today,
  };
}

export function openMomentFor(p: IdeaProgress): ForecastMoment | null {
  return p.forecast ? openMoment(momentInput(p, p.forecast)) : null;
}

// True when the current user still has to forecast at the open moment.
export function forecastDue(p: IdeaProgress): ForecastMoment | null {
  const m = openMomentFor(p);
  return m && p.forecast && !p.forecast.ownMoments.includes(m) ? m : null;
}

// Why a decision cannot be saved yet: the outcome must be defined, and while the decision moment is open the
// decider gives their own forecast first. Null when nothing blocks (or the prediction schema is absent).
export function decisionBlocker(p: IdeaProgress): string | null {
  const f = p.forecast;
  if (!f || f.resolved) return null;
  if (!f.outcomeDefined) return "Leg eerst vast wanneer dit idee geslaagd is (Voorspelling & uitkomst). Zonder uitkomstdefinitie kan niemand later toetsen of het besluit goed was.";
  if (openMomentFor(p) === "decision" && !f.ownMoments.includes("decision")) return "Geef eerst je eigen voorspelling bij het besluit: hoe groot is de kans dat het doel over zes maanden is gehaald?";
  return null;
}

export type FollowUp = {
  checkinDate: string | null;
  outcomeDate: string | null;
  checkinDue: boolean;
  outcomeDue: boolean;
};

// The interim check-in is due from three months after the decision until it is given (or the outcome is
// due, which then takes over); the outcome is due from the outcome date until it is recorded. Bij de stopvraag is er
// geen tussenstand: er is geen doel meer dat op koers kan liggen.
export function followUp(s: { outcomeDue: string | null; clockStart?: string | null; checkins: number; resolved: boolean; today: string; question?: OutcomeQuestion }): FollowUp {
  if (!s.outcomeDue) return { checkinDate: null, outcomeDate: null, checkinDue: false, outcomeDue: false };
  const outcomeDue = !s.resolved && s.today >= s.outcomeDue;
  if (s.question === "stop_review") return { checkinDate: null, outcomeDate: s.outcomeDue, checkinDue: false, outcomeDue };
  // From the stored decision date when available; deriving it back from the due date can shift at month ends.
  const checkinDate = s.clockStart ? addMonths(s.clockStart, CHECKIN_AFTER_MONTHS) : checkinDueFor(s.outcomeDue);
  return {
    checkinDate,
    outcomeDate: s.outcomeDue,
    outcomeDue,
    checkinDue: !s.resolved && !outcomeDue && s.checkins === 0 && s.today >= checkinDate,
  };
}

export function followUpFor(p: IdeaProgress): FollowUp | null {
  return p.forecast ? followUp(p.forecast) : null;
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

export type CalibrationRow = { bucket: number; forecasts: number; meanProbability: number; observed: number };

// Bucket label for the database buckets floor(p * 10): 0 → "0–10%", …, 9 → "90–100%".
export function bucketLabel(bucket: number): string {
  return `${bucket * 10}–${bucket * 10 + 10}%`;
}

// Scores of a set of resolved forecasts, e.g. per moment.
export function scoreSet(list: { probability: number; achieved: Achieved }[]): { n: number; brier: number; meanProbability: number; hitRate: number } | null {
  if (list.length === 0) return null;
  const n = list.length;
  return {
    n,
    brier: list.reduce((s, f) => s + brier(f.probability, f.achieved), 0) / n,
    meanProbability: list.reduce((s, f) => s + f.probability, 0) / n,
    hitRate: list.reduce((s, f) => s + outcomeValue(f.achieved), 0) / n,
  };
}

export const pct = (p: number) => `${Math.round(p * 100)}%`;
