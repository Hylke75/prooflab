// Evidence strength along the four dimensions of the method: fact vs opinion, what people do vs
// say, real-world vs lab setting, and how much the participant invested. Synthetic = 0.

import type { ClaimStatus, ObservationKind } from "./labels";

export type ObservationDims = {
  isFact: boolean;
  isBehaviour: boolean;
  isRealContext: boolean;
  isCostly: boolean;
  isSynthetic: boolean;
};

// Default dimensions per observation kind (the behaviour ladder).
export const KIND_DEFAULTS: Record<ObservationKind, Omit<ObservationDims, "isSynthetic">> = {
  opinion: { isFact: false, isBehaviour: false, isRealContext: false, isCostly: false },
  objection: { isFact: false, isBehaviour: false, isRealContext: false, isCostly: false },
  problem_absent: { isFact: true, isBehaviour: false, isRealContext: false, isCostly: false },
  problem_confirmed: { isFact: true, isBehaviour: true, isRealContext: false, isCostly: false },
  current_behaviour: { isFact: true, isBehaviour: true, isRealContext: false, isCostly: false },
  current_spend: { isFact: true, isBehaviour: true, isRealContext: false, isCostly: true },
  counter_example: { isFact: true, isBehaviour: true, isRealContext: false, isCostly: false },
  waitlist_signup: { isFact: true, isBehaviour: true, isRealContext: true, isCostly: false },
  demo_request: { isFact: true, isBehaviour: true, isRealContext: true, isCostly: false },
  quote_request: { isFact: true, isBehaviour: true, isRealContext: true, isCostly: false },
  deposit: { isFact: true, isBehaviour: true, isRealContext: true, isCostly: true },
  repeat_purchase: { isFact: true, isBehaviour: true, isRealContext: true, isCostly: true },
  survey_answer: { isFact: true, isBehaviour: false, isRealContext: false, isCostly: false },
  other: { isFact: false, isBehaviour: false, isRealContext: false, isCostly: false },
};

export function strength(d: ObservationDims): number {
  if (d.isSynthetic) return 0;
  return (d.isFact ? 1 : 0) + (d.isBehaviour ? 1 : 0) + (d.isRealContext ? 1 : 0) + (d.isCostly ? 1 : 0);
}

export function strengthLabel(score: number): { label: string; pill: string } {
  if (score >= 4) return { label: "Sterk", pill: "green" };
  if (score >= 3) return { label: "Redelijk sterk", pill: "green" };
  if (score >= 2) return { label: "Middel", pill: "blue" };
  if (score >= 1) return { label: "Zwak", pill: "orange" };
  return { label: "Geen bewijs", pill: "gray" };
}

export function explainStrength(d: ObservationDims): string {
  if (d.isSynthetic) return "Synthetisch: telt niet mee.";
  return [
    d.isFact ? "feit" : "mening",
    d.isBehaviour ? "wat mensen doen" : "wat mensen zeggen",
    d.isRealContext ? "echte situatie" : "gesprek of testsituatie",
    d.isCostly ? "met inzet (tijd/geld)" : "zonder inzet",
  ].join(" · ");
}

const CLAIM_WEIGHT: Record<ClaimStatus, number> = {
  verified: 1.2,
  estimate: 0.6,
  insufficient: 0,
  contested: 0,
  outdated: 0.2,
};

// Evidence axis of the assumption map, 0 (no evidence) .. 1 (strong evidence). Desk research can
// lift an assumption to at most ~0.45; only real-world behaviour gets it further.
export function assumptionEvidence(
  claims: { status: ClaimStatus; relation: "supports" | "contradicts" }[],
  observations: (ObservationDims & { relation: "supports" | "contradicts" })[],
): { score: number; supporting: number; contradicting: number } {
  let desk = 0;
  let field = 0;
  let supporting = 0;
  let contradicting = 0;
  for (const c of claims) {
    const w = CLAIM_WEIGHT[c.status];
    if (w === 0) continue;
    desk += w;
    if (c.relation === "supports") supporting++;
    else contradicting++;
  }
  for (const o of observations) {
    const s = strength(o);
    if (s === 0) continue;
    field += s * s; // stronger observations count disproportionately
    if (o.relation === "supports") supporting++;
    else contradicting++;
  }
  const deskPart = Math.min(0.45, desk * 0.15);
  const fieldPart = Math.min(0.55, field / 40);
  return { score: Math.min(1, deskPart + fieldPart), supporting, contradicting };
}

export type CardVerdict = "pass" | "fail" | "inconclusive";

// The status of an assumption follows all approved experiments that tested it, not only the latest:
// a later inconclusive test does not erase an earlier result, and conflicting results stay visible.
export function assumptionStatusFromVerdicts(verdicts: CardVerdict[]): "supported" | "refuted" | "inconclusive" | "untested" {
  if (verdicts.length === 0) return "untested";
  const pass = verdicts.includes("pass");
  const fail = verdicts.includes("fail");
  if (pass && fail) return "inconclusive";
  if (pass) return "supported";
  if (fail) return "refuted";
  return "inconclusive";
}

// ---------------------------------------------------------------------------
// Probability per assumption (research 3.5 + 3.7): Bayes in odds with an explicit likelihood
// ratio (LR) per kind of evidence. Deterministic, no model involved.
//
// - Start at a prior (default 50%: "we weten het niet"), or a chosen value.
// - Each observation or finding multiplies the odds by its LR when it supports the assumption and
//   by 1/LR when it contradicts it. Objections, "probleem niet herkend" and counter-examples are
//   counter-evidence by nature and always count against, whatever the link says.
// - Intent correction (3.7): an opinion or stated intent gets LR 1,1: saying is not doing.
// - Diminishing returns: n items of the same kind and direction contribute ln(LR) × log2(1 + n),
//   so 20 identical opinions move a 50% prior only to ≈ 60%, never to certainty.
// - Synthetic data has LR 1 (no effect). AI-coded observations count fully once a consultant
//   accepted them, not at all when rejected, and at half strength (in log-odds) while unreviewed.
// - The result is clamped to 1%–99%: ProofLab never shows certainty.
//
// The LRs are starting assumptions, to be calibrated on our own resolved dossiers (research 3.4).
// ---------------------------------------------------------------------------

export type LrEntry = { lr: number; label: string; against?: boolean; why: string };

export const OBSERVATION_LR: Record<ObservationKind, LrEntry> = {
  opinion: { lr: 1.1, label: "Mening of uitgesproken koopintentie", why: "Intentiecorrectie: zeggen is niet doen." },
  survey_answer: { lr: 1.3, label: "Enquête-uitkomst", why: "Veel mensen over hun eigen recente gedrag, maar zelf gerapporteerd." },
  other: { lr: 1, label: "Overige observatie", why: "Niet in te delen; telt niet mee." },
  problem_confirmed: { lr: 1.5, label: "Probleem herkend in eigen recent gedrag", why: "Echt probleem, maar nog geen koopgedrag." },
  current_behaviour: { lr: 2, label: "Huidige werkwijze", why: "Wat mensen nu al doen om het op te lossen." },
  current_spend: { lr: 3, label: "Huidige uitgaven", why: "Er gaat nu al geld of tijd naartoe." },
  waitlist_signup: { lr: 3, label: "Aanmelding wachtlijst", why: "Handeling in een echte situatie." },
  demo_request: { lr: 3, label: "Demo aangevraagd", why: "Handeling in een echte situatie." },
  quote_request: { lr: 3, label: "Offerte of prijsaanbod gekozen", why: "Keuze bij een concrete prijs, zonder betaling." },
  deposit: { lr: 6, label: "Aanbetaling", why: "Er is echt geld ingezet." },
  repeat_purchase: { lr: 8, label: "Herhaalaankoop", why: "Sterkste signaal: opnieuw betaald." },
  objection: { lr: 1.5, label: "Bezwaar", against: true, why: "Altijd tegenbewijs." },
  problem_absent: { lr: 1.5, label: "Probleem niet herkend", against: true, why: "Altijd tegenbewijs." },
  counter_example: { lr: 2, label: "Tegenvoorbeeld", against: true, why: "Concreet gedrag dat de aanname tegenspreekt." },
};

export const CLAIM_LR: Record<ClaimStatus, LrEntry> = {
  verified: { lr: 1.5, label: "Geverifieerde bevinding", why: "Gecontroleerde bron, maar bureauonderzoek." },
  estimate: { lr: 1.2, label: "Onderbouwde schatting", why: "Eén secundaire bron of schatting van derden." },
  insufficient: { lr: 1, label: "Bevinding met onvoldoende bewijs", why: "Niet controleerbaar; telt niet mee." },
  contested: { lr: 1, label: "Bevinding met tegenstrijdige bronnen", why: "Telt niet mee tot de tegenspraak is opgelost." },
  outdated: { lr: 1, label: "Verouderde bevinding", why: "Telt niet mee tot opnieuw gecontroleerd." },
};

// Weight in log-odds of an AI-coded observation that no consultant has reviewed yet.
export const AI_UNREVIEWED_WEIGHT = 0.5;
export const PROBABILITY_FLOOR = 0.01;
export const PROBABILITY_CEIL = 0.99;
// Sensitivity for the band: every ln(LR) scaled by 0,5 and 1,5 (LRs ±50% in log space).
export const SENSITIVITY = 0.5;

export type ProbabilityClaim = { status: ClaimStatus; relation: "supports" | "contradicts" };
export type ProbabilityObservation = {
  kind: string;
  relation: "supports" | "contradicts";
  isSynthetic: boolean;
  origin?: string | null; // 'ai' observations need a review
  reviewStatus?: string | null; // 'accepted' | 'rejected' | null
};

export type Contribution = {
  key: string;
  label: string;
  direction: "supports" | "contradicts";
  count: number;
  lr: number; // per item, in the direction of the effect (< 1 lowers the probability)
  weight: number; // 1, or 0,5 for unreviewed AI coding
  logOdds: number; // total contribution of this group
};

export type AssumptionProbability = {
  prior: number;
  probability: number;
  band: { low: number; high: number };
  shift: number; // total log-odds shift, independent of the prior
  contributions: Contribution[]; // sorted by absolute effect
  top: Contribution[]; // the three largest
  counted: number;
  ignored: { synthetic: number; rejected: number; neutral: number };
};

const clampP = (p: number) => Math.min(PROBABILITY_CEIL, Math.max(PROBABILITY_FLOOR, p));
const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

// Diminishing returns: total weight of n items of one kind (1 → 1, 3 → 2, 7 → 3, 20 → 4,4).
export function diminishing(n: number): number {
  return n <= 0 ? 0 : Math.log2(1 + n);
}

// Probability from a prior and a log-odds shift (also used for the what-if prior on screen).
export function probabilityFromShift(prior: number, shift: number, scale = 1): number {
  return clampP(sigmoid(logit(clampP(prior)) + shift * scale));
}

export function bandFromShift(prior: number, shift: number): { low: number; high: number } {
  const a = probabilityFromShift(prior, shift, 1 - SENSITIVITY);
  const b = probabilityFromShift(prior, shift, 1 + SENSITIVITY);
  return { low: Math.min(a, b), high: Math.max(a, b) };
}

export function assumptionProbability(
  claims: ProbabilityClaim[],
  observations: ProbabilityObservation[],
  prior = 0.5,
): AssumptionProbability {
  const groups = new Map<string, Omit<Contribution, "logOdds">>();
  const ignored = { synthetic: 0, rejected: 0, neutral: 0 };
  let counted = 0;
  const add = (key: string, label: string, entry: LrEntry, supports: boolean, weight: number) => {
    if (entry.lr === 1) {
      ignored.neutral++;
      return;
    }
    const direction = supports ? "supports" : "contradicts";
    const k = `${key}:${direction}:${weight}`;
    const g = groups.get(k) ?? { key: k, label, direction, count: 0, lr: supports ? entry.lr : 1 / entry.lr, weight };
    g.count++;
    groups.set(k, g);
    counted++;
  };
  for (const c of claims) {
    add(`claim:${c.status}`, CLAIM_LR[c.status].label, CLAIM_LR[c.status], c.relation === "supports", 1);
  }
  for (const o of observations) {
    if (o.isSynthetic) {
      ignored.synthetic++;
      continue;
    }
    let weight = 1;
    if (o.origin === "ai") {
      if (o.reviewStatus === "rejected") {
        ignored.rejected++;
        continue;
      }
      if (o.reviewStatus !== "accepted") weight = AI_UNREVIEWED_WEIGHT;
    }
    const entry = OBSERVATION_LR[o.kind as ObservationKind] ?? OBSERVATION_LR.other;
    const supports = entry.against ? false : o.relation === "supports";
    const label = weight < 1 ? `${entry.label} (AI-codering, nog niet beoordeeld)` : entry.label;
    add(`obs:${o.kind}`, label, entry, supports, weight);
  }
  const contributions: Contribution[] = [...groups.values()]
    .map((g) => ({ ...g, logOdds: Math.log(g.lr) * diminishing(g.count) * g.weight }))
    .sort((a, b) => Math.abs(b.logOdds) - Math.abs(a.logOdds) || a.key.localeCompare(b.key));
  const shift = contributions.reduce((s, c) => s + c.logOdds, 0);
  const p0 = clampP(prior);
  return {
    prior: p0,
    probability: probabilityFromShift(p0, shift),
    band: bandFromShift(p0, shift),
    shift,
    contributions,
    top: contributions.slice(0, 3),
    counted,
    ignored,
  };
}

export function fmtLr(x: number): string {
  return x.toLocaleString("nl-NL", { maximumFractionDigits: 2 });
}

// One line per contribution, for the screen and the report.
export function explainContribution(c: Contribution): string {
  const factor = c.lr >= 1 ? `× ${fmtLr(c.lr)}` : `÷ ${fmtLr(1 / c.lr)}`;
  const n = c.count === 1 ? "1 keer" : `${c.count} keer (afnemend meegeteld)`;
  return `${c.label}: ${n}, kansverhouding ${factor} per stuk${c.weight < 1 ? ", half gewicht" : ""}.`;
}
