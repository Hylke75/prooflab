// Evidence strength along the four dimensions of the method: fact vs opinion, what people do vs
// say, real-world vs lab setting, and how much the participant invested. Synthetic = 0.

import type { ClaimStatus, ObservationKind } from "./labels";
import type { LrOverrides } from "./calibration";

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
// The LRs are starting assumptions, to be calibrated on our own resolved dossiers (research 3.4). An
// organisation can switch on learned factors (lib/domain/calibration.ts): they are passed in as overrides
// per observation kind, with a separate factor for contradicting evidence; without overrides the result is
// exactly the default calculation, so it stays reproducible.
// ---------------------------------------------------------------------------

export type LrEntry = { lr: number; label: string; against?: boolean; why: string; lrAgainst?: number; learned?: boolean };

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

// sourceKey/sourceLabel: de bron van het signaal (evidenceSourceKey); alleen gebruikt door methode 2026-11-b.
export type ProbabilityClaim = { status: ClaimStatus; relation: "supports" | "contradicts"; sourceKey?: string | null; sourceLabel?: string | null };
export type ProbabilityObservation = {
  kind: string;
  relation: "supports" | "contradicts";
  isSynthetic: boolean;
  origin?: string | null; // 'ai' observations need a review
  reviewStatus?: string | null; // 'accepted' | 'rejected' | null
  sourceKey?: string | null;
  sourceLabel?: string | null;
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
  // Alleen methode 2026-11-b: samengevoegde signalen per bron en het plafond per bewijsniveau.
  merged?: MergedSource[];
  cap?: CapInfo | null;
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
  overrides: LrOverrides = {},
): AssumptionProbability {
  const groups = new Map<string, Omit<Contribution, "logOdds">>();
  const ignored = { synthetic: 0, rejected: 0, neutral: 0 };
  let counted = 0;
  const add = (key: string, label: string, entry: LrEntry, supports: boolean, weight: number) => {
    const factor = supports ? entry.lr : (entry.lrAgainst ?? entry.lr);
    if (factor === 1) {
      ignored.neutral++;
      return;
    }
    const direction = supports ? "supports" : "contradicts";
    const k = `${key}:${direction}:${weight}`;
    const g = groups.get(k) ?? { key: k, label, direction, count: 0, lr: supports ? factor : 1 / factor, weight };
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
    const base = OBSERVATION_LR[o.kind as ObservationKind] ?? OBSERVATION_LR.other;
    const learned = overrides[o.kind as ObservationKind];
    const entry: LrEntry = learned ? { ...base, lr: learned.lr, lrAgainst: learned.lrAgainst, learned: true } : base;
    const supports = entry.against ? false : o.relation === "supports";
    const label = `${entry.label}${learned ? " (geleerde factor)" : ""}${weight < 1 ? " (AI-codering, nog niet beoordeeld)" : ""}`;
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

// ===========================================================================
// Methode 2026-11-b (6b): één factor per bron per aanname en een plafond per bewijsniveau.
// ===========================================================================

// Wat is "dezelfde bron"? Signalen met dezelfde sleutel tellen samen als één signaal:
// - bronfragmenten, bevindingen (claims) en klantsignalen: de bron (source_id) van de bevinding;
// - outreach (bronnen van het type outreach): de campagne, ook als die in meerdere importen binnenkwam;
// - enquête- en testwaarnemingen: het experiment (experiment_id); open enquêteantwoorden die als bron zijn
//   opgenomen horen bij hun enquête;
// - interviewcodering: het interview (interview_id).
// Zonder herkenbare bron is elk signaal zijn eigen bron.
export type EvidenceSourceRef = {
  itemType: "claim" | "observation";
  itemId: string;
  sourceId?: string | null;
  sourceType?: string | null;
  sourceTitle?: string | null;
  campaign?: string | null; // outreach: de campagnenaam (of een onleesbare sleutel voor wie alleen meekijkt)
  surveyExperimentId?: string | null; // bron met open enquêteantwoorden: de enquête waar ze uit komen
  experimentId?: string | null;
  experimentTitle?: string | null;
  interviewId?: string | null;
  interviewLabel?: string | null;
};

const OUTREACH_TITLE = /^Expandi-antwoorden – (.+) – [^–]+$/;

export function campaignFromTitle(title: string | null | undefined): string | null {
  const m = title ? OUTREACH_TITLE.exec(title.trim()) : null;
  return m ? m[1].trim() : null;
}

export function evidenceSourceKey(r: EvidenceSourceRef): { key: string; label: string } {
  if (r.itemType === "observation") {
    if (r.interviewId) return { key: `interview:${r.interviewId}`, label: r.interviewLabel ? `Interview ${r.interviewLabel}` : "Interview" };
    if (r.experimentId) return { key: `experiment:${r.experimentId}`, label: r.experimentTitle || "Experiment" };
    return { key: `observation:${r.itemId}`, label: "Losse observatie" };
  }
  if (r.surveyExperimentId) return { key: `experiment:${r.surveyExperimentId}`, label: r.experimentTitle || "Enquête" };
  if (r.sourceType === "outreach") {
    const campaign = r.campaign ?? campaignFromTitle(r.sourceTitle);
    if (campaign) return { key: `campaign:${campaign}`, label: campaign.startsWith("md5:") ? "Outreach-campagne" : `Outreach-campagne ${campaign}` };
  }
  if (r.sourceId) return { key: `source:${r.sourceId}`, label: r.sourceTitle || "Bron" };
  return { key: `claim:${r.itemId}`, label: "Bevinding zonder bron" };
}

// Bewijsniveaus met hun standaardplafond (instelbaar per werkruimte). Het plafond begrenst hoe hoog bewijs
// de kans kan duwen; herhaalaankoop heeft geen plafond (wel de algemene grens van 99%).
export type EvidenceLevel = "opinion" | "problem" | "small_action" | "quote" | "deposit" | "repeat";
export type EvidenceCaps = Record<Exclude<EvidenceLevel, "repeat">, number>;

export const EVIDENCE_LEVELS: { level: EvidenceLevel; label: string; missing: string }[] = [
  { level: "opinion", label: "Meningen, enquêtes en bureauonderzoek", missing: "nog geen probleem in eigen gedrag of huidige uitgaven" },
  { level: "problem", label: "Probleem in eigen gedrag of huidige uitgaven", missing: "nog geen kleine handeling (aanmelding of demo-aanvraag)" },
  { level: "small_action", label: "Kleine handeling (aanmelding, demo-aanvraag)", missing: "nog geen offerte of gekozen prijsaanbod" },
  { level: "quote", label: "Offerte of prijsaanbod gekozen", missing: "nog geen aanbetaling" },
  { level: "deposit", label: "Aanbetaling", missing: "nog geen herhaalaankoop" },
  { level: "repeat", label: "Herhaalaankoop", missing: "" },
];

export const DEFAULT_CAPS: EvidenceCaps = { opinion: 0.4, problem: 0.5, small_action: 0.6, quote: 0.75, deposit: 0.9 };

// Koppeling van elke soort waarneming aan een bewijsniveau. Tegenbewijs (bezwaar, probleem niet herkend,
// tegenvoorbeeld) en "overig" tillen nooit een niveau op; ze staan bij het laagste niveau. Bevindingen uit
// bronnen (claims) zijn bureauonderzoek.
export const KIND_LEVEL: Record<ObservationKind, EvidenceLevel> = {
  opinion: "opinion",
  survey_answer: "opinion",
  other: "opinion",
  objection: "opinion",
  problem_absent: "opinion",
  counter_example: "opinion",
  problem_confirmed: "problem",
  current_behaviour: "problem",
  current_spend: "problem",
  waitlist_signup: "small_action",
  demo_request: "small_action",
  quote_request: "quote",
  deposit: "deposit",
  repeat_purchase: "repeat",
};
export const CLAIM_LEVEL: EvidenceLevel = "opinion";

const LEVEL_RANK: Record<EvidenceLevel, number> = { opinion: 0, problem: 1, small_action: 2, quote: 3, deposit: 4, repeat: 5 };

export function normaliseCaps(raw: Partial<Record<keyof EvidenceCaps, unknown>> | null | undefined): EvidenceCaps {
  const out = { ...DEFAULT_CAPS };
  for (const k of Object.keys(DEFAULT_CAPS) as (keyof EvidenceCaps)[]) {
    const v = Number(raw?.[k]);
    if (raw?.[k] != null && Number.isFinite(v) && v >= 0.05 && v <= 0.99) out[k] = v;
  }
  return out;
}

export type MergedSource = { key: string; label: string; signals: number; kept: string };

export type CapInfo = {
  level: EvidenceLevel; // hoogste aanwezige niveau
  levelLabel: string;
  max: number | null; // plafond van dat niveau (null = geen plafond)
  active: boolean; // de kans is begrensd
  uncapped: number; // de kans zonder plafond
  reason: string; // "begrensd op 75%: nog geen aanbetaling"
};

// Begrenzing: de kans komt niet boven het plafond van het hoogste aanwezige bewijsniveau, ook niet door een
// hoge beginwaarde. Zonder ondersteunend bewijs geldt het laagste niveau (40%): wie nog niets heeft gezien
// van wat klanten doen, kan niet zekerder zijn dan dat. Zo blijft meer ondersteunend bewijs de kans nooit
// verlagen.
export function applyCap(p: number, max: number | null): number {
  return max == null ? p : Math.min(p, max);
}

export function capReason(level: EvidenceLevel, max: number | null): string {
  const meta = EVIDENCE_LEVELS.find((l) => l.level === level)!;
  return max == null ? "" : `begrensd op ${Math.round(max * 100)}%: ${meta.missing}`;
}

type Item = { kindKey: string; label: string; entry: LrEntry; supports: boolean; weight: number; sourceKey: string; sourceLabel: string; level: EvidenceLevel };

export function assumptionProbabilityV2(
  claims: ProbabilityClaim[],
  observations: ProbabilityObservation[],
  prior = 0.5,
  overrides: LrOverrides = {},
  caps: EvidenceCaps = DEFAULT_CAPS,
): AssumptionProbability {
  const ignored = { synthetic: 0, rejected: 0, neutral: 0 };
  const items: Item[] = [];
  let unique = 0;
  const own = () => `eigen:${unique++}`;
  for (const c of claims) {
    items.push({
      kindKey: `claim:${c.status}`,
      label: CLAIM_LR[c.status].label,
      entry: CLAIM_LR[c.status],
      supports: c.relation === "supports",
      weight: 1,
      sourceKey: c.sourceKey || own(),
      sourceLabel: c.sourceLabel || "Bron",
      level: CLAIM_LEVEL,
    });
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
    const kind = (o.kind in OBSERVATION_LR ? o.kind : "other") as ObservationKind;
    const base = OBSERVATION_LR[kind];
    const learned = overrides[kind];
    const entry: LrEntry = learned ? { ...base, lr: learned.lr, lrAgainst: learned.lrAgainst, learned: true } : base;
    items.push({
      kindKey: `obs:${kind}`,
      label: `${entry.label}${learned ? " (geleerde factor)" : ""}${weight < 1 ? " (AI-codering, nog niet beoordeeld)" : ""}`,
      entry,
      supports: entry.against ? false : o.relation === "supports",
      weight,
      sourceKey: o.sourceKey || own(),
      sourceLabel: o.sourceLabel || "Observatie",
      level: KIND_LEVEL[kind],
    });
  }

  const factorOf = (i: Item) => (i.supports ? i.entry.lr : (i.entry.lrAgainst ?? i.entry.lr));
  const counting = items.filter((i) => {
    if (factorOf(i) !== 1) return true;
    ignored.neutral++;
    return false;
  });

  // Ondersteunend bewijs: per bron alleen het sterkste signaal (grootste ln(factor) × gewicht).
  // Tegenbewijs telt volledig per signaal en wordt niet samengevoegd.
  const bySource = new Map<string, Item[]>();
  for (const i of counting.filter((x) => x.supports)) bySource.set(i.sourceKey, [...(bySource.get(i.sourceKey) ?? []), i]);
  const pull = (i: Item) => Math.log(factorOf(i)) * i.weight;
  const merged: MergedSource[] = [];
  const kept: Item[] = [];
  for (const [key, list] of bySource) {
    const best = [...list].sort((a, b) => pull(b) - pull(a) || a.kindKey.localeCompare(b.kindKey))[0];
    kept.push(best);
    if (list.length > 1) merged.push({ key, label: best.sourceLabel, signals: list.length, kept: best.label });
  }
  kept.push(...counting.filter((x) => !x.supports));

  // Daarna zoals methode 2026-11-a: per soort en richting afnemend meetellen; elke factor vermenigvuldigt
  // de kansverhouding (odds): logit(p) = logit(beginwaarde) + Σ ln(factor) × log₂(1 + n) × gewicht.
  const groups = new Map<string, Omit<Contribution, "logOdds">>();
  for (const i of kept) {
    const direction = i.supports ? "supports" : "contradicts";
    const k = `${i.kindKey}:${direction}:${i.weight}`;
    const g = groups.get(k) ?? { key: k, label: i.label, direction, count: 0, lr: i.supports ? factorOf(i) : 1 / factorOf(i), weight: i.weight };
    g.count++;
    groups.set(k, g);
  }
  const contributions: Contribution[] = [...groups.values()]
    .map((g) => ({ ...g, logOdds: Math.log(g.lr) * diminishing(g.count) * g.weight }))
    .sort((a, b) => Math.abs(b.logOdds) - Math.abs(a.logOdds) || a.key.localeCompare(b.key));
  const shift = contributions.reduce((x, c) => x + c.logOdds, 0);
  const p0 = clampP(prior);

  // Plafond: het hoogste niveau onder het ondersteunende bewijs dat volledig meetelt (AI-codering die nog
  // niemand beoordeelde tilt het niveau niet op).
  const level = kept
    .filter((i) => i.supports && i.weight === 1)
    .reduce<EvidenceLevel>((best, i) => (LEVEL_RANK[i.level] > LEVEL_RANK[best] ? i.level : best), "opinion");
  const max = level === "repeat" ? null : caps[level];
  const uncapped = probabilityFromShift(p0, shift);
  const probability = applyCap(uncapped, max);
  const band = bandFromShift(p0, shift);
  const active = probability < uncapped;
  return {
    prior: p0,
    probability,
    band: { low: applyCap(band.low, max), high: applyCap(band.high, max) },
    shift,
    contributions,
    top: contributions.slice(0, 3),
    counted: counting.length,
    ignored,
    merged: merged.sort((a, b) => b.signals - a.signals || a.label.localeCompare(b.label)),
    cap: { level, levelLabel: EVIDENCE_LEVELS.find((l) => l.level === level)!.label, max, active, uncapped, reason: active ? capReason(level, max) : "" },
  };
}

export function explainMerged(m: MergedSource): string {
  return `${m.signals} signalen uit ${m.label} samengevoegd: alleen het sterkste telt (${m.kept}).`;
}
