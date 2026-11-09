// Evidence strength along the four dimensions of the method: fact vs opinion, what people do vs
// say, real-world vs lab setting, and how much the participant invested. Synthetic = 0.

import type { ClaimStatus, ObservationKind } from "./labels";
import type { LrOverrides } from "./calibration";
import { relevanceWeight } from "./claim-scope";
import { manualKindOf } from "./manual-kind";

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
  // Gebruikerstest A5: in methode 2026-11-a t/m 2026-11-d weegt een weerlegde bevinding zoals een tegenstrijdige: 0.
  refuted: 0,
  outdated: 0.2,
};

// Gebruikerstest A5, methode 2026-11-e: een weerlegde bevinding waarop een aanname leunt, weegt als tegenbewijs. Bewust
// conservatief met het gewicht van een onderbouwde schatting (0,6 op de bewijsas, factor 1,2 op de kansverhouding) en
// niet dat van een geverifieerde bevinding: "weerlegd" kan op één secundaire tegensprekende bron rusten.
export const REFUTED_WEIGHT = 0.6;

// Waarom een gekoppelde bevinding (nog) niet meetelt in de bewijsas en de kans (gebruikerstest A2).
export type DeskSkipReason = "insufficient" | "contested" | "refuted_old_method" | "refuted_counter";
export const DESK_SKIP_REASON: Record<DeskSkipReason, string> = {
  insufficient: "geen controleerbaar citaat (onvoldoende bewijs)",
  contested: "bronnen spreken elkaar tegen",
  refuted_old_method: "de bevinding is weerlegd; als tegenbewijs telt dat pas vanaf methode 2026-11-e",
  refuted_counter: "de bevinding sprak de aanname tegen, maar is zelf weerlegd; dat is geen steun voor de aanname",
};

export type DeskLink = { status: ClaimStatus; relation: "supports" | "contradicts" };
// counts: telt mee als steun of tegenbewijs voor de aanname; anders met de reden waarom niet.
export type DeskVerdict = { counts: true; direction: "supports" | "contradicts"; weight: number } | { counts: false; reason: DeskSkipReason };

// Wat één gekoppelde bevinding met de aanname doet. Let op de twee richtingen: claim_sources.stance (bron ↔ bevinding)
// bepaalt de status van de bevinding; assumption_claims.relation (bevinding ↔ aanname) bepaalt of de bevinding de aanname
// steunt of tegenspreekt. Een weerlegde bevinding die de aanname zou steunen, spreekt de aanname dus tegen (vanaf
// methode 2026-11-e); een weerlegde tegenbevinding is geen steun.
export function deskVerdict(c: DeskLink, opts: { refutedCounts?: boolean } = {}): DeskVerdict {
  if (c.status === "refuted") {
    if (!opts.refutedCounts) return { counts: false, reason: "refuted_old_method" };
    if (c.relation === "contradicts") return { counts: false, reason: "refuted_counter" };
    return { counts: true, direction: "contradicts", weight: REFUTED_WEIGHT };
  }
  const w = CLAIM_WEIGHT[c.status];
  if (w === 0) return { counts: false, reason: c.status === "contested" ? "contested" : "insufficient" };
  return { counts: true, direction: c.relation, weight: w };
}

// Telling per aanname: meetellende bevindingen per richting en de gekoppelde bevindingen die niet meetellen, met reden.
export function deskTally<T extends DeskLink>(
  claims: T[],
  opts: { refutedCounts?: boolean } = {},
): { supporting: T[]; contradicting: T[]; notCounted: (T & { reason: DeskSkipReason; reasonText: string })[] } {
  const supporting: T[] = [];
  const contradicting: T[] = [];
  const notCounted: (T & { reason: DeskSkipReason; reasonText: string })[] = [];
  for (const c of claims) {
    const v = deskVerdict(c, opts);
    if (!v.counts) notCounted.push({ ...c, reason: v.reason, reasonText: DESK_SKIP_REASON[v.reason] });
    else if (v.direction === "supports") supporting.push(c);
    else contradicting.push(c);
  }
  return { supporting, contradicting, notCounted };
}

// Korte zin voor scherm en melding: "1 gekoppeld, telt nog niet mee: bronnen spreken elkaar tegen".
export function notCountedLine(reasons: string[]): string | null {
  if (reasons.length === 0) return null;
  const unique = [...new Set(reasons)];
  return `${reasons.length} gekoppeld, ${reasons.length === 1 ? "telt" : "tellen"} nog niet mee: ${unique.join("; ")}`;
}

// Evidence axis of the assumption map, 0 (no evidence) .. 1 (strong evidence). Desk research can
// lift an assumption to at most ~0.45; only real-world behaviour gets it further.
// refutedCounts (methode 2026-11-e): een weerlegde bevinding telt als tegenbewijs (deskVerdict).
export function assumptionEvidence(
  claims: { status: ClaimStatus; relation: "supports" | "contradicts" }[],
  observations: (ObservationDims & { relation: "supports" | "contradicts" })[],
  opts: { refutedCounts?: boolean } = {},
): { score: number; supporting: number; contradicting: number } {
  let desk = 0;
  let field = 0;
  let supporting = 0;
  let contradicting = 0;
  for (const c of claims) {
    const v = deskVerdict(c, opts);
    if (!v.counts) continue;
    desk += v.weight;
    if (v.direction === "supports") supporting++;
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
  refuted: { lr: 1, label: "Weerlegde bevinding", why: "Telt in methode 2026-11-a t/m 2026-11-d niet mee; vanaf 2026-11-e als tegenbewijs." },
  outdated: { lr: 1, label: "Verouderde bevinding", why: "Telt niet mee tot opnieuw gecontroleerd." },
};

// Methode 2026-11-e: een weerlegde bevinding waarop de aanname leunt, telt als tegenbewijs met de factor van een
// onderbouwde schatting (conservatief; zie REFUTED_WEIGHT).
export const REFUTED_LR: LrEntry = { lr: 1.2, label: "Weerlegde bevinding (tegenbewijs)", why: "Gecontroleerde bronnen spreken de bevinding tegen; conservatief gewogen als één secundaire bron." };

// Weight in log-odds of an AI-coded observation that no consultant has reviewed yet.
export const AI_UNREVIEWED_WEIGHT = 0.5;
export const PROBABILITY_FLOOR = 0.01;
export const PROBABILITY_CEIL = 0.99;
// Sensitivity for the band: every ln(LR) scaled by 0,5 and 1,5 (LRs ±50% in log space).
export const SENSITIVITY = 0.5;

// sourceKey/sourceLabel: de bron van het signaal (evidenceSourceKey); gebruikt vanaf methode 2026-11-b.
// recruitmentGroup: de wervingsgroep van het signaal (lib/domain/recruitment.ts); alleen gebruikt door methode 2026-11-c.
// relevance: 'direct' of 'indirect' (golf C, claims.relevance; lib/domain/claim-scope.ts); alleen gebruikt door
// methode 2026-11-c, waar een indirecte bevinding met halve sterkte telt.
// id (fase 1, punt 2): alleen voor het bewijsregister (welke bevinding of waarneming het is); rekent niet mee.
export type ProbabilityClaim = {
  id?: string | null;
  status: ClaimStatus;
  relation: "supports" | "contradicts";
  sourceKey?: string | null;
  sourceLabel?: string | null;
  recruitmentGroup?: string | null;
  relevance?: string | null;
};
export type ProbabilityObservation = {
  id?: string | null;
  kind: string;
  relation: "supports" | "contradicts";
  isSynthetic: boolean;
  origin?: string | null; // 'ai' observations need a review
  reviewStatus?: string | null; // 'accepted' | 'rejected' | null
  sourceKey?: string | null;
  sourceLabel?: string | null;
  recruitmentGroup?: string | null;
};

export type Contribution = {
  key: string;
  label: string;
  direction: "supports" | "contradicts";
  count: number;
  lr: number; // per item, in the direction of the effect (< 1 lowers the probability)
  weight: number; // 1, or 0,5 for unreviewed AI coding
  logOdds: number; // total contribution of this group
  // Methode 2026-11-c: het effectieve aantal na de afnemende factor binnen dezelfde wervingsgroep (anders log₂(1 + n)).
  effective?: number;
};

// Methode 2026-11-c: een wervingsgroep waaruit meer dan één bron ondersteunend bewijs leverde.
export type RecruitmentRepeat = { group: string; sources: number };

export type AssumptionProbability = {
  prior: number;
  probability: number;
  band: { low: number; high: number };
  shift: number; // total log-odds shift, independent of the prior
  contributions: Contribution[]; // sorted by absolute effect
  top: Contribution[]; // the three largest
  counted: number;
  // unreviewed: alleen methode 2026-11-c, AI-codering die nog wacht op beoordeling (telt niet mee).
  ignored: { synthetic: number; rejected: number; neutral: number; unreviewed?: number };
  // Alleen methode 2026-11-b: samengevoegde signalen per bron en het plafond per bewijsniveau.
  merged?: MergedSource[];
  cap?: CapInfo | null;
  // Alleen methode 2026-11-c: herhaling binnen dezelfde wervingsgroep.
  recruitment?: RecruitmentRepeat[];
  // Alleen methode 2026-11-c: aantal meetellende bevindingen dat als indirect bewijs met halve sterkte telt.
  indirect?: number;
  // Fase 1, punt 2: het bewijsregister. Per gekoppeld item (bevinding of waarneming, in invoervolgorde) of het meetelt
  // in deze kans en waarom niet. Alleen uitleg: de getallen hierboven veranderen er niet door.
  items: RegisterItem[];
};

// ---------------------------------------------------------------------------
// Bewijsregister (fase 1, punt 2): één bron van waarheid voor "telt mee" en "telt niet mee, want …", gemaakt door
// dezelfde rekenmodule die de kans berekent. Zo kan een scherm nooit iets anders zeggen dan de berekening doet.
// ---------------------------------------------------------------------------

export type RegisterReason =
  | "synthetic" // oefengesprek of synthetische data
  | "ai_unreviewed" // AI-codering nog niet beoordeeld (vanaf 2026-11-c telt die niet)
  | "ai_rejected" // AI-codering afgekeurd
  | "claim_insufficient"
  | "claim_contested"
  | "claim_outdated"
  | "claim_refuted_old_method"
  | "claim_refuted_counter"
  | "neutral" // factor 1: verandert de kans niet (soort "overig", of een geleerde factor van 1)
  | "merged" // samengevoegd met een sterker signaal uit dezelfde bron
  | "excluded_test"; // uit een test die onbeslist is of onder de minimale steekproef bleef

// Opmerking bij een item dat wel meetelt.
export type RegisterNote = "capped" | "ai_half" | "indirect";

export type RegisterItem = {
  itemType: "claim" | "observation";
  id: string | null;
  kind: string; // status van de bevinding of soort waarneming
  label: string; // "Demo aangevraagd", "Geverifieerde bevinding"
  // De richting waarin het item werkt (of zou werken): bezwaren en tegenvoorbeelden zijn altijd tegenbewijs; een weerlegde
  // bevinding waarop de aanname leunt telt vanaf 2026-11-e als tegenbewijs.
  direction: "supports" | "contradicts";
  level: EvidenceLevel;
  sourceLabel: string | null;
  sourceKey: string | null; // evidenceSourceKey (interview:…, experiment:…); null zonder herkenbare bron
  fate: "counted" | "not_counted";
  code: RegisterReason | null; // reden bij not_counted
  notes: RegisterNote[]; // opmerkingen bij counted
  reason: string | null; // gewone taal: waarom niet, of de opmerking bij een meetellend item
};

const pctWhole = (x: number) => `${Math.round(x * 100)}%`;

export const REGISTER_REASON: Record<Exclude<RegisterReason, "merged" | "excluded_test" | "neutral">, string> = {
  synthetic: "oefengesprek of synthetische data: telt nooit als bewijs",
  ai_unreviewed: "AI-codering nog niet beoordeeld: telt pas mee na akkoord van een consultant",
  ai_rejected: "AI-codering afgekeurd door een consultant",
  claim_insufficient: DESK_SKIP_REASON.insufficient,
  claim_contested: DESK_SKIP_REASON.contested,
  claim_outdated: "verouderde bevinding: telt pas weer mee na een nieuwe controle",
  claim_refuted_old_method: DESK_SKIP_REASON.refuted_old_method,
  claim_refuted_counter: DESK_SKIP_REASON.refuted_counter,
};

export function capNote(max: number, level: EvidenceLevel): string {
  const meta = EVIDENCE_LEVELS.find((l) => l.level === level)!;
  return `telt mee, maar het plafond van ${pctWhole(max)} is bereikt (${meta.missing})`;
}

const NOTE_TEXT: Record<Exclude<RegisterNote, "capped">, string> = {
  ai_half: "telt half mee: AI-codering nog niet beoordeeld",
  indirect: "telt half mee: indirect bewijs (andere populatie, regio of peildatum)",
};

function claimSkip(status: ClaimStatus, relation: "supports" | "contradicts", refutedCounts: boolean): RegisterReason {
  if (status === "insufficient") return "claim_insufficient";
  if (status === "contested") return "claim_contested";
  if (status === "outdated") return "claim_outdated";
  if (status === "refuted") return refutedCounts && relation === "contradicts" ? "claim_refuted_counter" : "claim_refuted_old_method";
  return "neutral";
}

function registerEntry(
  base: Pick<RegisterItem, "itemType" | "id" | "kind" | "label" | "direction" | "level" | "sourceLabel"> & { sourceKey?: string | null },
  fate: RegisterItem["fate"],
  code: RegisterReason | null = null,
  reason: string | null = null,
): RegisterItem {
  return { ...base, sourceKey: base.sourceKey ?? null, fate, code, notes: [], reason: reason ?? (code && code in REGISTER_REASON ? REGISTER_REASON[code as keyof typeof REGISTER_REASON] : null) };
}

const NEUTRAL_TEXT = "verandert de kans niet (factor 1)";

function noteOn(item: RegisterItem, note: RegisterNote, text: string) {
  if (item.notes.includes(note)) return;
  item.notes.push(note);
  item.reason = item.reason ? `${item.reason}; ${text}` : text;
}

// Telling voor scherm en rapport: "3 voor (2 tellen mee) · 1 tegen".
export type RegisterTally = { supports: number; supportsCounted: number; contradicts: number; contradictsCounted: number; notCounted: number };

export function registerTally(items: RegisterItem[]): RegisterTally {
  const t: RegisterTally = { supports: 0, supportsCounted: 0, contradicts: 0, contradictsCounted: 0, notCounted: 0 };
  for (const i of items) {
    const counted = i.fate === "counted";
    if (i.direction === "supports") {
      t.supports++;
      if (counted) t.supportsCounted++;
    } else {
      t.contradicts++;
      if (counted) t.contradictsCounted++;
    }
    if (!counted) t.notCounted++;
  }
  return t;
}

export function registerLine(t: RegisterTally): string {
  const part = (n: number, counted: number, word: string) => (n === counted ? `${n} ${word}` : `${n} ${word} (${counted} ${counted === 1 ? "telt" : "tellen"} mee)`);
  return `${part(t.supports, t.supportsCounted, "voor")} · ${part(t.contradicts, t.contradictsCounted, "tegen")}`;
}

// Een item dat vóór de berekening is weggelaten omdat het uit een niet-meetellende test komt (lib/domain/test-counts.ts).
export function excludedRegisterItem(
  item: { itemType: "claim"; id: string | null; status: ClaimStatus; relation: "supports" | "contradicts"; sourceLabel?: string | null } | { itemType: "observation"; id: string | null; kind: string; relation: "supports" | "contradicts"; sourceLabel?: string | null },
  test: { title: string; reason: "under_sample" | "inconclusive"; text: string },
): RegisterItem {
  const why = test.reason === "inconclusive" ? "onbeslist" : test.text.replace(/^telt niet mee: /, "");
  const reason = `komt uit de test "${test.title}", die niet meetelt: ${why}`;
  if (item.itemType === "claim") {
    return registerEntry({ itemType: "claim", id: item.id, kind: item.status, label: CLAIM_LR[item.status].label, direction: item.relation, level: CLAIM_LEVEL, sourceLabel: item.sourceLabel ?? null }, "not_counted", "excluded_test", reason);
  }
  const kind = (item.kind in OBSERVATION_LR ? item.kind : "other") as ObservationKind;
  const entry = OBSERVATION_LR[kind];
  return registerEntry(
    { itemType: "observation", id: item.id, kind, label: entry.label, direction: entry.against ? "contradicts" : item.relation, level: KIND_LEVEL[kind], sourceLabel: item.sourceLabel ?? null },
    "not_counted",
    "excluded_test",
    reason,
  );
}

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
  const items: RegisterItem[] = [];
  let counted = 0;
  const add = (key: string, label: string, entry: LrEntry, supports: boolean, weight: number) => {
    const factor = supports ? entry.lr : (entry.lrAgainst ?? entry.lr);
    if (factor === 1) {
      ignored.neutral++;
      return false;
    }
    const direction = supports ? "supports" : "contradicts";
    const k = `${key}:${direction}:${weight}`;
    const g = groups.get(k) ?? { key: k, label, direction, count: 0, lr: supports ? factor : 1 / factor, weight };
    g.count++;
    groups.set(k, g);
    counted++;
    return true;
  };
  for (const c of claims) {
    const counts = add(`claim:${c.status}`, CLAIM_LR[c.status].label, CLAIM_LR[c.status], c.relation === "supports", 1);
    const base = { itemType: "claim" as const, id: c.id ?? null, kind: c.status, label: CLAIM_LR[c.status].label, direction: c.relation, level: CLAIM_LEVEL, sourceLabel: c.sourceLabel ?? null, sourceKey: c.sourceKey ?? null };
    items.push(counts ? registerEntry(base, "counted") : registerEntry(base, "not_counted", claimSkip(c.status, c.relation, false)));
  }
  for (const o of observations) {
    const kind = (o.kind in OBSERVATION_LR ? o.kind : "other") as ObservationKind;
    const base = OBSERVATION_LR[o.kind as ObservationKind] ?? OBSERVATION_LR.other;
    const reg = { itemType: "observation" as const, id: o.id ?? null, kind, label: base.label, direction: base.against ? ("contradicts" as const) : o.relation, level: KIND_LEVEL[kind], sourceLabel: o.sourceLabel ?? null, sourceKey: o.sourceKey ?? null };
    if (o.isSynthetic) {
      ignored.synthetic++;
      items.push(registerEntry(reg, "not_counted", "synthetic"));
      continue;
    }
    let weight = 1;
    if (o.origin === "ai") {
      if (o.reviewStatus === "rejected") {
        ignored.rejected++;
        items.push(registerEntry(reg, "not_counted", "ai_rejected"));
        continue;
      }
      if (o.reviewStatus !== "accepted") weight = AI_UNREVIEWED_WEIGHT;
    }
    const learned = overrides[o.kind as ObservationKind];
    const entry: LrEntry = learned ? { ...base, lr: learned.lr, lrAgainst: learned.lrAgainst, learned: true } : base;
    const supports = entry.against ? false : o.relation === "supports";
    const label = `${entry.label}${learned ? " (geleerde factor)" : ""}${weight < 1 ? " (AI-codering, nog niet beoordeeld)" : ""}`;
    const counts = add(`obs:${o.kind}`, label, entry, supports, weight);
    const item = counts ? registerEntry(reg, "counted") : registerEntry(reg, "not_counted", "neutral", NEUTRAL_TEXT);
    if (counts && weight < 1) noteOn(item, "ai_half", NOTE_TEXT.ai_half);
    items.push(item);
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
    items,
  };
}

export function fmtLr(x: number): string {
  return x.toLocaleString("nl-NL", { maximumFractionDigits: 2 });
}

// One line per contribution, for the screen and the report.
export function explainContribution(c: Contribution): string {
  const factor = c.lr >= 1 ? `× ${fmtLr(c.lr)}` : `÷ ${fmtLr(1 / c.lr)}`;
  const n = c.count === 1 ? "1 keer" : `${c.count} keer (afnemend meegeteld)`;
  const damped = c.effective != null && c.effective < diminishing(c.count) - 1e-9 ? ", minder door herhaling binnen dezelfde wervingsgroep" : "";
  return `${c.label}: ${n}, kansverhouding ${factor} per stuk${c.weight < 1 ? ", half gewicht" : ""}${damped}.`;
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

// Titel van een bron met outreach-antwoorden: "<voorvoegsel> – <campagne> – <datum>". Bronnen van vóór
// november 2026 hebben nog het oude voorvoegsel met de naam van de tool; die worden ook herkend (en door de
// migratie 20261119090000_outreach_neutraal.sql hernoemd).
export const OUTREACH_TITLE_PREFIX = "Outreach-antwoorden";
const OUTREACH_TITLE = /^(?:Outreach|Expandi)-antwoorden – (.+) – [^–]+$/;

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

// Korte naam per niveau, voor naast een uitkomst: "Geslaagd · niveau: mening" (golf A, punt 14).
export const LEVEL_SHORT: Record<EvidenceLevel, string> = {
  opinion: "mening",
  problem: "probleem in eigen gedrag",
  small_action: "kleine handeling",
  quote: "prijskeuze",
  deposit: "aanbetaling",
  repeat: "herhaalaankoop",
};

// Het bewijsniveau van een testuitkomst: het niveau van wat de test meet (dezelfde indeling als de plafonds).
// Enquête = zelfrapportage (mening); landingpagina = kleine handeling; prijstest = keuze bij een prijs;
// interviews meten het probleem in eigen gedrag, of met de aantalregel een aanbetaling.
// Experimentencatalogus: een handmatig sjabloon meet wat de catalogusmethode vastlegt (config.observation_kind, hooguit
// een kleine handeling); zonder geldige soort de mening.
export function testEvidenceLevel(type: string, opts: { decisionRule?: string | null; successMetric?: string | null; config?: unknown } = {}): EvidenceLevel {
  if (type === "manual") {
    const kind = manualKindOf(opts.config);
    return kind ? KIND_LEVEL[kind] : "opinion";
  }
  if (type === "survey") return KIND_LEVEL.survey_answer;
  // Fase 2 · punt 4: de succesmaat van een testpagina bepaalt het niveau (zelfde soort als de systeemwaarneming).
  if (type === "landing" || type === "pricing") {
    if (opts.successMetric === "payment") return KIND_LEVEL.deposit;
    if (opts.successMetric === "commitment") return KIND_LEVEL.quote_request;
    if (opts.successMetric === "booking") return KIND_LEVEL.demo_request;
  }
  if (type === "landing") return KIND_LEVEL.waitlist_signup;
  if (type === "pricing") return KIND_LEVEL.quote_request;
  if (type === "interview") return opts.decisionRule === "absolute" ? KIND_LEVEL.deposit : KIND_LEVEL.problem_confirmed;
  return "opinion";
}

export function asEvidenceLevel(v: unknown): EvidenceLevel | null {
  return typeof v === "string" && v in LEVEL_SHORT ? (v as EvidenceLevel) : null;
}

// "Geslaagd · niveau: mening". Zonder niveau alleen de uitkomst.
export function outcomeWithLevel(outcome: string, level: EvidenceLevel | null | undefined): string {
  const o = outcome ? outcome.charAt(0).toUpperCase() + outcome.slice(1) : outcome;
  return level ? `${o} · niveau: ${LEVEL_SHORT[level]}` : o;
}

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

// direction: vanaf methode 2026-11-d wordt ook tegenbewijs per bron samengevoegd; zonder richting is het steunend bewijs.
export type MergedSource = { key: string; label: string; signals: number; kept: string; direction?: "supports" | "contradicts" };

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

type Item = {
  kindKey: string;
  label: string;
  entry: LrEntry;
  supports: boolean;
  weight: number;
  sourceKey: string;
  sourceLabel: string;
  level: EvidenceLevel;
  recruitment: string | null;
  damp: number; // afnemende factor binnen dezelfde wervingsgroep (methode 2026-11-c); anders 1
  reg: RegisterItem; // de regel in het bewijsregister (fase 1, punt 2); rekent niet mee
};

// Wat methode 2026-11-c toevoegt aan de rekenwijze van 2026-11-b. Zonder opties rekent de kern exact als 2026-11-b.
// contraPerSource (methode 2026-11-d): ook tegenbewijs telt per bron één keer (alleen het sterkste tegensignaal).
// refutedCounts (methode 2026-11-e): een weerlegde bevinding telt als tegenbewijs (deskVerdict, REFUTED_LR).
type CoreOptions = { recruitmentDamping?: boolean; aiNeedsReview?: boolean; relevanceWeighting?: boolean; contraPerSource?: boolean; refutedCounts?: boolean };

export function assumptionProbabilityV2(
  claims: ProbabilityClaim[],
  observations: ProbabilityObservation[],
  prior = 0.5,
  overrides: LrOverrides = {},
  caps: EvidenceCaps = DEFAULT_CAPS,
): AssumptionProbability {
  return probabilityCore(claims, observations, prior, overrides, caps, {});
}

function probabilityCore(
  claims: ProbabilityClaim[],
  observations: ProbabilityObservation[],
  prior: number,
  overrides: LrOverrides,
  caps: EvidenceCaps,
  opts: CoreOptions,
): AssumptionProbability {
  const ignored: AssumptionProbability["ignored"] = opts.aiNeedsReview ? { synthetic: 0, rejected: 0, neutral: 0, unreviewed: 0 } : { synthetic: 0, rejected: 0, neutral: 0 };
  const items: Item[] = [];
  const register: RegisterItem[] = [];
  let unique = 0;
  const own = () => `eigen:${unique++}`;
  for (const c of claims) {
    // Methode 2026-11-c: een indirecte bevinding (andere populatie, regio of te oude peildatum) telt half
    // (gewicht 0,5 in log-odds, zoals niet beoordeelde AI-codering in 2026-11-a en 2026-11-b).
    const weight = opts.relevanceWeighting ? relevanceWeight(c.relevance) : 1;
    // Methode 2026-11-e: een weerlegde bevinding waarop de aanname leunt, telt tegen; een weerlegde tegenbevinding niet
    // (factor 1, dus neutraal). In oudere methodes is een weerlegde bevinding neutraal (CLAIM_LR.refuted).
    const refuted = opts.refutedCounts && c.status === "refuted";
    const entry = refuted && c.relation === "supports" ? REFUTED_LR : CLAIM_LR[c.status];
    const reg = registerEntry(
      { itemType: "claim", id: c.id ?? null, kind: c.status, label: entry.label, direction: refuted ? "contradicts" : c.relation, level: CLAIM_LEVEL, sourceLabel: c.sourceLabel ?? null, sourceKey: c.sourceKey ?? null },
      "counted",
    );
    register.push(reg);
    if (weight < 1) noteOn(reg, "indirect", NOTE_TEXT.indirect);
    items.push({
      reg,
      kindKey: `claim:${c.status}`,
      label: `${entry.label}${weight < 1 ? " (indirect bewijs)" : ""}`,
      entry,
      supports: refuted ? false : c.relation === "supports",
      weight,
      sourceKey: c.sourceKey || own(),
      sourceLabel: c.sourceLabel || "Bron",
      level: CLAIM_LEVEL,
      recruitment: c.recruitmentGroup ?? null,
      damp: 1,
    });
  }
  for (const o of observations) {
    const kind = (o.kind in OBSERVATION_LR ? o.kind : "other") as ObservationKind;
    const base = OBSERVATION_LR[kind];
    const reg = registerEntry(
      { itemType: "observation", id: o.id ?? null, kind, label: base.label, direction: base.against ? "contradicts" : o.relation, level: KIND_LEVEL[kind], sourceLabel: o.sourceLabel ?? null, sourceKey: o.sourceKey ?? null },
      "counted",
    );
    register.push(reg);
    const skip = (code: RegisterReason) => Object.assign(reg, registerEntry(reg, "not_counted", code));
    if (o.isSynthetic) {
      ignored.synthetic++;
      skip("synthetic");
      continue;
    }
    let weight = 1;
    if (o.origin === "ai") {
      if (o.reviewStatus === "rejected") {
        ignored.rejected++;
        skip("ai_rejected");
        continue;
      }
      if (o.reviewStatus !== "accepted") {
        // Methode 2026-11-c: onbeoordeelde AI-codering telt niet mee, pas na beoordeling door een consultant.
        if (opts.aiNeedsReview) {
          ignored.unreviewed = (ignored.unreviewed ?? 0) + 1;
          skip("ai_unreviewed");
          continue;
        }
        weight = AI_UNREVIEWED_WEIGHT;
        noteOn(reg, "ai_half", NOTE_TEXT.ai_half);
      }
    }
    const learned = overrides[kind];
    const entry: LrEntry = learned ? { ...base, lr: learned.lr, lrAgainst: learned.lrAgainst, learned: true } : base;
    items.push({
      reg,
      kindKey: `obs:${kind}`,
      label: `${entry.label}${learned ? " (geleerde factor)" : ""}${weight < 1 ? " (AI-codering, nog niet beoordeeld)" : ""}`,
      entry,
      supports: entry.against ? false : o.relation === "supports",
      weight,
      sourceKey: o.sourceKey || own(),
      sourceLabel: o.sourceLabel || "Observatie",
      level: KIND_LEVEL[kind],
      recruitment: o.recruitmentGroup ?? null,
      damp: 1,
    });
  }

  const factorOf = (i: Item) => (i.supports ? i.entry.lr : (i.entry.lrAgainst ?? i.entry.lr));
  const counting = items.filter((i) => {
    if (factorOf(i) !== 1) return true;
    ignored.neutral++;
    const code = i.reg.itemType === "claim" ? claimSkip(i.reg.kind as ClaimStatus, i.reg.direction, !!opts.refutedCounts) : "neutral";
    Object.assign(i.reg, registerEntry(i.reg, "not_counted", code, code === "neutral" ? NEUTRAL_TEXT : null));
    return false;
  });
  const indirect = opts.relevanceWeighting ? counting.filter((i) => i.kindKey.startsWith("claim:") && i.weight < 1).length : 0;

  // Ondersteunend bewijs: per bron alleen het sterkste signaal (grootste ln(factor) × gewicht).
  // Tegenbewijs telt in 2026-11-a t/m 2026-11-c volledig per signaal; vanaf 2026-11-d (contraPerSource) ook per bron
  // alleen het sterkste tegensignaal, zodat vijf bezwaren van één geïnterviewde één keer tellen.
  const pull = (i: Item) => Math.log(factorOf(i)) * i.weight;
  const merged: MergedSource[] = [];
  const perSource = (list: Item[], direction: "supports" | "contradicts"): Item[] => {
    const bySource = new Map<string, Item[]>();
    for (const i of list) bySource.set(i.sourceKey, [...(bySource.get(i.sourceKey) ?? []), i]);
    const best: Item[] = [];
    for (const [key, group] of bySource) {
      const top = [...group].sort((a, b) => pull(b) - pull(a) || a.kindKey.localeCompare(b.kindKey))[0];
      best.push(top);
      for (const other of group) {
        if (other === top) continue;
        Object.assign(other.reg, registerEntry(other.reg, "not_counted", "merged", `samengevoegd met een sterker signaal uit dezelfde bron (${top.sourceLabel}): alleen "${top.reg.label}" telt`));
      }
      if (group.length > 1) {
        merged.push(
          direction === "supports"
            ? { key, label: top.sourceLabel, signals: group.length, kept: top.label }
            : { key: `${key}:tegen`, label: top.sourceLabel, signals: group.length, kept: top.label, direction },
        );
      }
    }
    return best;
  };
  const kept: Item[] = perSource(counting.filter((x) => x.supports), "supports");

  // Methode 2026-11-c: herhaling binnen dezelfde wervingsgroep over verschillende bronnen heen telt afnemend mee,
  // met dezelfde functie als `diminishing`. Per groep (het sterkste signaal eerst) krijgt het k-de signaal (k = 0, 1,
  // …) de factor log₂(2 + k) − log₂(1 + k): 1; 0,58; 0,42; 0,32; … Samen tellen n signalen uit één groep zo als
  // log₂(1 + n) signalen. Alleen ondersteunend bewijs; signalen zonder werving (bureauonderzoek) vallen erbuiten.
  const recruitment: RecruitmentRepeat[] = [];
  if (opts.recruitmentDamping) {
    const byGroup = new Map<string, Item[]>();
    for (const i of kept) if (i.recruitment) byGroup.set(i.recruitment, [...(byGroup.get(i.recruitment) ?? []), i]);
    for (const [group, list] of byGroup) {
      const ordered = [...list].sort((a, b) => pull(b) - pull(a) || a.kindKey.localeCompare(b.kindKey) || a.sourceKey.localeCompare(b.sourceKey));
      ordered.forEach((i, k) => {
        i.damp = diminishing(k + 1) - diminishing(k);
      });
      if (list.length > 1) recruitment.push({ group, sources: list.length });
    }
  }
  // Tegenbewijs: de afnemende factor binnen dezelfde wervingsgroep geldt bewust niet (alleen ondersteunend bewijs);
  // de afnemende factor per soort hieronder geldt wel, over de bronnen heen.
  const against = counting.filter((x) => !x.supports);
  kept.push(...(opts.contraPerSource ? perSource(against, "contradicts") : against));

  // Daarna zoals methode 2026-11-a: per soort en richting afnemend meetellen; elke factor vermenigvuldigt
  // de kansverhouding (odds): logit(p) = logit(beginwaarde) + Σ ln(factor) × log₂(1 + n) × gewicht.
  // Met een wervingsfactor d per signaal (2026-11-c) wordt log₂(1 + n) een gewogen som: Σ d(k) × (log₂(2 + k) −
  // log₂(1 + k)), met de grootste d eerst; zonder demping is dat precies log₂(1 + n).
  const groups = new Map<string, Omit<Contribution, "logOdds"> & { damps: number[] }>();
  for (const i of kept) {
    const direction = i.supports ? "supports" : "contradicts";
    const k = `${i.kindKey}:${direction}:${i.weight}`;
    const g = groups.get(k) ?? { key: k, label: i.label, direction, count: 0, lr: i.supports ? factorOf(i) : 1 / factorOf(i), weight: i.weight, damps: [] };
    g.count++;
    g.damps.push(i.damp);
    groups.set(k, g);
  }
  const contributions: Contribution[] = [...groups.values()]
    .map(({ damps, ...g }) => {
      if (damps.every((x) => x === 1)) return { ...g, logOdds: Math.log(g.lr) * diminishing(g.count) * g.weight };
      const effective = [...damps].sort((a, b) => b - a).reduce((s, d, k) => s + d * (diminishing(k + 1) - diminishing(k)), 0);
      return { ...g, effective, logOdds: Math.log(g.lr) * effective * g.weight };
    })
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
  // Plafond bereikt: het ondersteunende bewijs telt mee, maar de kans komt niet hoger dan het plafond.
  if (active && max != null) for (const i of kept) if (i.supports) noteOn(i.reg, "capped", capNote(max, level));
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
    ...(opts.recruitmentDamping ? { recruitment: recruitment.sort((a, b) => b.sources - a.sources || a.group.localeCompare(b.group)) } : {}),
    ...(opts.relevanceWeighting ? { indirect } : {}),
    cap: { level, levelLabel: EVIDENCE_LEVELS.find((l) => l.level === level)!.label, max, active, uncapped, reason: active ? capReason(level, max) : "" },
    items: register,
  };
}

// ===========================================================================
// Methode 2026-11-c (golf A): bouwt voort op 2026-11-b.
// - Herhaling binnen dezelfde wervingsgroep over verschillende bronnen heen telt afnemend mee (punt 4).
// - Onbeoordeelde AI-codering telt niet mee; pas na akkoord van een consultant volledig (punt 17).
// - Een indirecte bevinding (golf C, punt 7: claims.relevance = 'indirect') telt met halve sterkte (relevanceWeight).
// ===========================================================================

export function assumptionProbabilityV3(
  claims: ProbabilityClaim[],
  observations: ProbabilityObservation[],
  prior = 0.5,
  overrides: LrOverrides = {},
  caps: EvidenceCaps = DEFAULT_CAPS,
): AssumptionProbability {
  return probabilityCore(claims, observations, prior, overrides, caps, { recruitmentDamping: true, aiNeedsReview: true, relevanceWeighting: true });
}

// ===========================================================================
// Methode 2026-11-d: bouwt voort op 2026-11-c.
// - Tegenbewijs telt per bron één keer, net als ondersteunend bewijs: per bron (bijvoorbeeld één interview, via
//   evidenceSourceKey) alleen het sterkste tegensignaal. Over verschillende bronnen heen telt tegenbewijs van
//   dezelfde soort afnemend mee (log₂(1 + n)); de plafonds per bewijsniveau blijven zoals in 2026-11-c.
// ===========================================================================

export function assumptionProbabilityV4(
  claims: ProbabilityClaim[],
  observations: ProbabilityObservation[],
  prior = 0.5,
  overrides: LrOverrides = {},
  caps: EvidenceCaps = DEFAULT_CAPS,
): AssumptionProbability {
  return probabilityCore(claims, observations, prior, overrides, caps, { recruitmentDamping: true, aiNeedsReview: true, relevanceWeighting: true, contraPerSource: true });
}

export function explainMerged(m: MergedSource): string {
  if (m.direction === "contradicts") return `${m.signals} tegensignalen uit ${m.label} samengevoegd: alleen het sterkste tegenbewijs telt (${m.kept}).`;
  return `${m.signals} signalen uit ${m.label} samengevoegd: alleen het sterkste telt (${m.kept}).`;
}

// Korte vorm voor tabellen (methodepagina en rapport).
export function mergedShort(m: Pick<MergedSource, "signals" | "label" | "direction">): string {
  return `${m.signals} ${m.direction === "contradicts" ? "tegensignalen" : "signalen"} uit ${m.label} samengevoegd`;
}

// ===========================================================================
// Methode 2026-11-e (gebruikerstest A5): bouwt voort op 2026-11-d.
// - Een weerlegde bevinding (alleen gecontroleerde tegensprekende bronnen) waarop een aanname leunt, telt als
//   tegenbewijs met de factor van een onderbouwde schatting (REFUTED_LR, conservatief). Een weerlegde tegenbevinding
//   is geen steun en telt niet mee.
// ===========================================================================

export function assumptionProbabilityV5(
  claims: ProbabilityClaim[],
  observations: ProbabilityObservation[],
  prior = 0.5,
  overrides: LrOverrides = {},
  caps: EvidenceCaps = DEFAULT_CAPS,
): AssumptionProbability {
  return probabilityCore(claims, observations, prior, overrides, caps, {
    recruitmentDamping: true,
    aiNeedsReview: true,
    relevanceWeighting: true,
    contraPerSource: true,
    refutedCounts: true,
  });
}
