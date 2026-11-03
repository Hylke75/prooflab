// Learning loop (docs/ProofLab_Voorspelkracht_v1.md §8): what resolved dossiers teach about the evidence
// factors, the coach and the forecasts. Pure functions only; the database returns counts
// (supabase/migrations/20261104130000_learning.sql) and everything is computed here, so it is unit-tested.
//
// 1. Learned evidence weights: per observation kind and test type, how much more often a dossier with a
//    positive (or negative) result of that kind reached its outcome. Smoothed towards the fixed default, and
//    only shown as "learned" from LEARN_MIN_DOSSIERS dossiers with such a result.
// 2. Survey versus behaviour: did a survey's key metric agree with a later landing or pricing test on the
//    same assumption?
// 3. Coach tips: how often each rule posts, how often a tip is followed or dismissed, how long that takes,
//    and (descriptive, correlational) the Brier score of the decision forecast in those dossiers.
// 4. Starting calibration before there are own resolved dossiers: forecasts far from the base rate without
//    behavioural evidence, and a blended suggestion of people, AI and base rate.

import { OBSERVATION_LR, type LrEntry } from "./evidence";
import { TEST_LR } from "./recommend";
import type { ExperimentType, ObservationKind } from "./labels";

export type Achieved = "yes" | "partial" | "no";

// ---------------------------------------------------------------------------
// 1. Learned evidence weights
// ---------------------------------------------------------------------------

// Below this many resolved dossiers with a result of a kind, the default factor stays in use.
export const LEARN_MIN_DOSSIERS = 8;
// Pseudo-dossiers per outcome group in the prior (Beta(1,1)-style: two), so few dossiers barely move it.
export const PRIOR_STRENGTH = 2;
// A learned factor in use never turns evidence around (≥ 1) and never exceeds the strongest default × 2,5.
export const LEARNED_LR_MIN = 1;
export const LEARNED_LR_MAX = 20;

export type EvidenceDimension = "observation" | "test";

// One row of learning_evidence_counts: resolved dossiers per kind, outcome and net direction. The row with
// dimension 'resolved' holds the number of resolved dossiers per outcome (kind and direction empty).
export type EvidenceCountRow = {
  dimension: EvidenceDimension | "resolved";
  kind: string;
  achieved: Achieved;
  direction: "positive" | "negative" | "";
  dossiers: number;
};

export type LearnedStatus = "learned" | "too_few" | "no_spread" | "not_learnable";

export type LearnedWeight = {
  dimension: EvidenceDimension;
  kind: string;
  label: string;
  defaultLr: number;
  // Resolved dossiers with a positive or negative result of this kind (the N in "x/8").
  n: number;
  status: LearnedStatus;
  // Factor for a supporting result (× on the odds) and for a contradicting result (÷ on the odds), as
  // estimated (may be below 1: then the data suggest the opposite of the default) and as applied (clamped).
  learnedFor: number | null;
  learnedAgainst: number | null;
  appliedFor: number | null;
  appliedAgainst: number | null;
  note: string;
};

type Groups = { ach: number; not: number };

// "Partial" counts half as reached and half as not reached, like yes = 1, partial = 0,5, no = 0 elsewhere.
function split(achieved: Achieved, n: number): Groups {
  if (achieved === "yes") return { ach: n, not: 0 };
  if (achieved === "no") return { ach: 0, not: n };
  return { ach: n / 2, not: n / 2 };
}

const add = (a: Groups, b: Groups): Groups => ({ ach: a.ach + b.ach, not: a.not + b.not });
const ZERO: Groups = { ach: 0, not: 0 };

// Smoothed likelihood ratio of "a dossier has this result": P(result | favoured group) / P(result | other
// group). The prior has the pooled rate of the result and the default ratio between the groups, worth
// PRIOR_STRENGTH dossiers per group: with no data the answer is exactly the default, and it moves towards the
// data as dossiers accumulate.
export function smoothedLr(defaultLr: number, present: Groups, total: Groups, favoured: "ach" | "not"): number {
  const other = favoured === "ach" ? "not" : "ach";
  const all = total.ach + total.not;
  const q = (present.ach + present.not + 1) / (all + 2); // pooled rate, Laplace-smoothed
  const pOther = Math.min(0.98, (2 * q) / (1 + defaultLr));
  const pFav = Math.min(0.99, defaultLr * pOther);
  const k = PRIOR_STRENGTH;
  const fav = (present[favoured] + k * pFav) / (total[favoured] + k);
  const oth = (present[other] + k * pOther) / (total[other] + k);
  return fav / oth;
}

const clampLr = (x: number) => Math.min(LEARNED_LR_MAX, Math.max(LEARNED_LR_MIN, x));

const TEST_LABELS: Record<ExperimentType, string> = {
  interview: "Klantinterviews (oordeel van de test)",
  landing: "Landingpage-test (oordeel van de test)",
  pricing: "Prijs-/aanbodtest (oordeel van de test)",
  survey: "Enquête (oordeel op de kernvraag)",
};

// The learned factor per observation kind and per test type, next to the default. Kinds that never move the
// probability ("other") are listed as not learnable.
export function learnWeights(rows: EvidenceCountRow[]): LearnedWeight[] {
  let total = ZERO;
  for (const r of rows) if (r.dimension === "resolved") total = add(total, split(r.achieved, r.dossiers));
  const spread = total.ach > 0 && total.not > 0;

  const tally = (dimension: EvidenceDimension, kind: string) => {
    let pos = ZERO;
    let neg = ZERO;
    let n = 0;
    for (const r of rows) {
      if (r.dimension !== dimension || r.kind !== kind) continue;
      const g = split(r.achieved, r.dossiers);
      if (r.direction === "positive") pos = add(pos, g);
      else if (r.direction === "negative") neg = add(neg, g);
      n += r.dossiers;
    }
    return { pos, neg, n };
  };

  const one = (dimension: EvidenceDimension, kind: string, label: string, entry: Pick<LrEntry, "lr" | "against">): LearnedWeight => {
    const { pos, neg, n } = tally(dimension, kind);
    const base = { dimension, kind, label, defaultLr: entry.lr, n, learnedFor: null, learnedAgainst: null, appliedFor: null, appliedAgainst: null };
    if (entry.lr === 1) return { ...base, status: "not_learnable", note: "Telt niet mee in de kans; er valt niets te ijken." };
    if (n < LEARN_MIN_DOSSIERS) return { ...base, status: "too_few", note: `Nog te weinig dossiers: ${n}/${LEARN_MIN_DOSSIERS}.` };
    if (!spread) return { ...base, status: "no_spread", note: "Alle afgeronde dossiers hebben dezelfde uitkomst; daaruit valt geen verschil te leren." };
    // Counter-evidence kinds only ever count against; their factor is learned from the negative side only.
    const learnedFor = entry.against ? null : smoothedLr(entry.lr, pos, total, "ach");
    const learnedAgainst = smoothedLr(entry.lr, neg, total, "not");
    return {
      ...base,
      status: "learned",
      learnedFor,
      learnedAgainst,
      appliedFor: learnedFor == null ? null : clampLr(learnedFor),
      appliedAgainst: clampLr(learnedAgainst),
      note:
        (learnedFor != null && learnedFor < 1) || learnedAgainst < 1
          ? "De dossiers wijzen de andere kant op dan verwacht; in gebruik wordt de factor op 1 gezet (telt dan niet mee)."
          : `Geleerd uit ${n} afgeronde dossiers, gekrompen naar de standaardfactor.`,
    };
  };

  const observations = (Object.keys(OBSERVATION_LR) as ObservationKind[]).map((k) => one("observation", k, OBSERVATION_LR[k].label, OBSERVATION_LR[k]));
  const tests = (Object.keys(TEST_LR) as ExperimentType[]).map((t) => one("test", t, TEST_LABELS[t], { lr: TEST_LR[t] }));
  return [...observations, ...tests];
}

// Factor overrides for assumptionProbability (lib/domain/evidence.ts): only learned observation kinds.
export type LrOverride = { lr: number; lrAgainst: number };
export type LrOverrides = Partial<Record<ObservationKind, LrOverride>>;

export function overridesFrom(weights: LearnedWeight[]): LrOverrides {
  const out: LrOverrides = {};
  for (const w of weights) {
    if (w.dimension !== "observation" || w.status !== "learned" || w.appliedAgainst == null) continue;
    const kind = w.kind as ObservationKind;
    out[kind] = { lr: w.appliedFor ?? OBSERVATION_LR[kind].lr, lrAgainst: w.appliedAgainst };
  }
  return out;
}

// Which weights a calculation used, stored in reports so a probability can always be reproduced.
export type WeightsInUse = {
  mode: "default" | "learned";
  resolvedDossiers: number;
  learned: { kind: string; label: string; defaultLr: number; lr: number; lrAgainst: number; n: number }[];
};

export const DEFAULT_WEIGHTS: WeightsInUse = { mode: "default", resolvedDossiers: 0, learned: [] };

export function weightsInUse(useLearned: boolean, weights: LearnedWeight[], resolvedDossiers: number): { inUse: WeightsInUse; overrides: LrOverrides } {
  if (!useLearned) return { inUse: { ...DEFAULT_WEIGHTS, resolvedDossiers }, overrides: {} };
  const overrides = overridesFrom(weights);
  const learned = weights
    .filter((w) => w.dimension === "observation" && overrides[w.kind as ObservationKind])
    .map((w) => ({ kind: w.kind, label: w.label, defaultLr: w.defaultLr, lr: overrides[w.kind as ObservationKind]!.lr, lrAgainst: overrides[w.kind as ObservationKind]!.lrAgainst, n: w.n }));
  return { inUse: { mode: "learned", resolvedDossiers, learned }, overrides };
}

export function describeWeights(w: WeightsInUse | null | undefined): string {
  if (!w || w.mode === "default") return "Gebruikte factoren: de vaste standaardfactoren van ProofLab (niet geijkt op eigen uitkomsten).";
  if (w.learned.length === 0)
    return `Geleerde factoren staan aan, maar nog geen enkele soort bewijs heeft ${LEARN_MIN_DOSSIERS} afgeronde dossiers; daarom zijn overal de standaardfactoren gebruikt.`;
  const list = w.learned.map((l) => `${l.label} ${fmt(l.lr)} (standaard ${fmt(l.defaultLr)}, ${l.n} dossiers)`).join("; ");
  return `Gebruikte factoren: geleerd uit ${w.resolvedDossiers} afgeronde dossiers van deze werkruimte voor ${list}. Alle andere soorten bewijs: standaardfactor.`;
}

const fmt = (x: number) => x.toLocaleString("nl-NL", { maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// 2. Survey versus behaviour on the same assumption
// ---------------------------------------------------------------------------

export type AgreementRow = { surveyVerdict: "pass" | "fail" | "mixed"; behaviourVerdict: "pass" | "fail" | "mixed"; assumptions: number };

export type Agreement = {
  pairs: number; // assumptions with a clear survey and a clear behaviour verdict
  agree: number;
  surveyTooPositive: number; // survey passed, behaviour failed
  surveyTooNegative: number; // survey failed, behaviour passed
  mixed: number; // assumptions where one side had conflicting verdicts
  rate: number | null; // agree / pairs
};

export function surveyAgreement(rows: AgreementRow[]): Agreement {
  let pairs = 0;
  let agree = 0;
  let tooPos = 0;
  let tooNeg = 0;
  let mixed = 0;
  for (const r of rows) {
    if (r.surveyVerdict === "mixed" || r.behaviourVerdict === "mixed") {
      mixed += r.assumptions;
      continue;
    }
    pairs += r.assumptions;
    if (r.surveyVerdict === r.behaviourVerdict) agree += r.assumptions;
    else if (r.surveyVerdict === "pass") tooPos += r.assumptions;
    else tooNeg += r.assumptions;
  }
  return { pairs, agree, surveyTooPositive: tooPos, surveyTooNegative: tooNeg, mixed, rate: pairs ? agree / pairs : null };
}

// ---------------------------------------------------------------------------
// 3. Coach tip effectiveness (descriptive)
// ---------------------------------------------------------------------------

export type CoachNoteStatRow = {
  ideaId: string;
  rule: string;
  status: "open" | "done" | "dismissed" | string;
  daysToResolve: number | null;
  helpful: boolean | null;
  decisionBrier: number | null; // mean Brier of the human decision forecasts, when the dossier is resolved
};

export type BrierGroup = { dossiers: number; brier: number } | null;

export type RuleStats = {
  rule: string;
  posted: number;
  open: number;
  done: number;
  dismissed: number;
  medianDays: number | null;
  helpfulYes: number;
  helpfulNo: number;
  followed: BrierGroup; // resolved dossiers where the tip was followed (done) and never dismissed
  ignored: BrierGroup; // resolved dossiers where the tip was dismissed
};

export function median(xs: number[]): number | null {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const meanGroup = (values: number[]): BrierGroup => (values.length ? { dossiers: values.length, brier: values.reduce((s, x) => s + x, 0) / values.length } : null);

// Per rule code: counts, median days to resolve, helpful votes and the Brier score of the decision forecast
// in resolved dossiers where the tip was followed versus dismissed (one value per dossier).
export function coachRuleStats(rows: CoachNoteStatRow[]): RuleStats[] {
  const byRule = new Map<string, CoachNoteStatRow[]>();
  for (const r of rows) byRule.set(r.rule, [...(byRule.get(r.rule) ?? []), r]);
  const out: RuleStats[] = [];
  for (const [rule, list] of byRule) {
    const perDossier = new Map<string, { done: boolean; dismissed: boolean; brier: number | null }>();
    for (const r of list) {
      const d = perDossier.get(r.ideaId) ?? { done: false, dismissed: false, brier: r.decisionBrier };
      if (r.status === "done") d.done = true;
      if (r.status === "dismissed") d.dismissed = true;
      perDossier.set(r.ideaId, d);
    }
    const dossiers = [...perDossier.values()].filter((d) => d.brier != null && Number.isFinite(d.brier));
    out.push({
      rule,
      posted: list.length,
      open: list.filter((r) => r.status === "open").length,
      done: list.filter((r) => r.status === "done").length,
      dismissed: list.filter((r) => r.status === "dismissed").length,
      medianDays: median(list.filter((r) => r.status !== "open" && r.daysToResolve != null).map((r) => r.daysToResolve!)),
      helpfulYes: list.filter((r) => r.helpful === true).length,
      helpfulNo: list.filter((r) => r.helpful === false).length,
      followed: meanGroup(dossiers.filter((d) => d.done && !d.dismissed).map((d) => d.brier!)),
      ignored: meanGroup(dossiers.filter((d) => d.dismissed).map((d) => d.brier!)),
    });
  }
  return out.sort((a, b) => b.posted - a.posted || a.rule.localeCompare(b.rule));
}

// ---------------------------------------------------------------------------
// 4. Starting calibration: base rate as anchor before there are own resolved dossiers
// ---------------------------------------------------------------------------

// A forecast more than this far from the base rate, without an ended behaviour test, is flagged.
export const OVERCONFIDENT_GAP = 0.25;

export function baseRatePoint(b: { low: number; high: number } | null | undefined): number | null {
  if (!b || !Number.isFinite(b.low) || !Number.isFinite(b.high)) return null;
  return (b.low + b.high) / 2;
}

export type Overconfidence = { gap: number; direction: "higher" | "lower"; flagged: boolean; base: number };

// Distance between a forecast and the midpoint of the base rate. Flagged when it exceeds OVERCONFIDENT_GAP
// while no behaviour test (landing or pricing) has ended: then there is little evidence to justify it.
export function overconfidence(probability: number, baseRate: { low: number; high: number } | null | undefined, behaviourTestEnded: boolean): Overconfidence | null {
  const base = baseRatePoint(baseRate);
  if (base == null || !Number.isFinite(probability)) return null;
  const gap = Math.abs(probability - base);
  return { gap, direction: probability >= base ? "higher" : "lower", flagged: !behaviourTestEnded && gap > OVERCONFIDENT_GAP + 1e-9, base };
}

// Suggested blended estimate (linear pool). Weights are starting assumptions, documented in the method:
// without an ended behaviour test the base rate weighs more (shrinkage towards the outside view).
export const BLEND_WEIGHTS = {
  withoutBehaviour: { people: 0.5, ai: 0.2, baseRate: 0.3 },
  withBehaviour: { people: 0.6, ai: 0.2, baseRate: 0.2 },
} as const;

export type BlendPart = { key: "people" | "ai" | "baseRate"; label: string; value: number; weight: number };
export type Blend = { estimate: number; parts: BlendPart[] };

export function blendedEstimate(i: { people: number[]; ai: number | null; baseRate: { low: number; high: number } | null; behaviourTestEnded: boolean }): Blend | null {
  const people = i.people.filter((p) => Number.isFinite(p));
  if (people.length === 0) return null; // never a suggestion without a human forecast
  const w = i.behaviourTestEnded ? BLEND_WEIGHTS.withBehaviour : BLEND_WEIGHTS.withoutBehaviour;
  const base = baseRatePoint(i.baseRate);
  const raw: Omit<BlendPart, "weight">[] = [{ key: "people", label: people.length === 1 ? "Voorspelling (mens)" : `Gemiddelde van ${people.length} mensen`, value: people.reduce((s, p) => s + p, 0) / people.length }];
  if (i.ai != null && Number.isFinite(i.ai)) raw.push({ key: "ai", label: "AI-voorspelling", value: i.ai });
  if (base != null) raw.push({ key: "baseRate", label: "Basispercentage (midden)", value: base });
  const sum = raw.reduce((s, p) => s + w[p.key], 0);
  const parts = raw.map((p) => ({ ...p, weight: w[p.key] / sum }));
  return { estimate: parts.reduce((s, p) => s + p.value * p.weight, 0), parts };
}
