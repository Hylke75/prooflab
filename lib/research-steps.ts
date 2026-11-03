// Fase B2, punten 2 en 3: de volgorde van een onderzoeksrun en het harde kostenplafond.
//
// Volgorde: de beslissende vraag gaat altijd eerst (zoeken, citaten controleren, tegenbewijs). Bij de snelle check
// is dat de kern; daarna volgen de andere vragen zolang het budget het toelaat. Diep onderzoek doet elke vraag met
// tegenbewijs en sluit af met de reality-check.
//
// Kostenplafond: elke stap heeft een bovengrens (stepEstimateUsd), uit dezelfde prijstabel en dezelfde
// schattingsregels als de budgetbewaking per modelaanroep (lib/ai/providers/config.ts, lib/ai/generate.ts,
// roundEstimate in lib/ai/providers/anthropic.ts), met ruimte voor wat een aanbieder meer doet dan gevraagd
// (Gemini kent geen maximum aantal zoekopdrachten). Een stap start alleen als "al uitgegeven + bovengrens ≤
// plafond"; binnen de stap mag hij niet meer reserveren dan zijn bovengrens. Zo komt de run nooit boven het plafond.
//
// Puur: geen database, geen omgeving (de modellen komen als parameter binnen), zodat dit met unittests vastligt.

import { DEFAULT_RESEARCH_MODELS, DEFAULT_MODELS, estimateCostUsd, type ProviderId } from "@/lib/ai/providers/config";
import { roundEstimate } from "@/lib/ai/providers/anthropic";

export type RunMode = "quick" | "deep";
export type StepKind = "search" | "extract" | "counter" | "reality_check" | "uncertainty";

export type PlannedStep = { kind: StepKind; questionId: string | null; label: string; core: boolean };

type Q = { id: string; position: number; is_decisive?: boolean };

const qLabel = (q: Q, decisive: boolean) => (decisive ? `beslissende vraag (vraag ${q.position})` : `vraag ${q.position}`);

// De stappen van een run in uitvoeringsvolgorde. `questions` staat al in onderzoeksvolgorde (beslissende vraag
// eerst, zie decisiveFirst). De eerste vraag is de kern: die wordt altijd gepland en gaat voor.
export function planSteps(questions: Q[], mode: RunMode): PlannedStep[] {
  const steps: PlannedStep[] = [];
  const [first, ...rest] = questions;
  if (!first) return steps;
  const decisive = first.is_decisive === true;
  const label = qLabel(first, decisive);
  steps.push({ kind: "search", questionId: first.id, label: `Bronnen zoeken: ${label}`, core: true });
  steps.push({ kind: "extract", questionId: first.id, label: `Citaten controleren: ${label}`, core: true });
  steps.push({ kind: "counter", questionId: first.id, label: `Tegenbewijs zoeken: ${label}`, core: true });
  const others = rest;
  if (mode === "deep") {
    for (const q of others) {
      steps.push({ kind: "search", questionId: q.id, label: `Bronnen zoeken: ${qLabel(q, false)}`, core: false });
      steps.push({ kind: "extract", questionId: q.id, label: `Citaten controleren: ${qLabel(q, false)}`, core: false });
      steps.push({ kind: "counter", questionId: q.id, label: `Tegenbewijs zoeken: ${qLabel(q, false)}`, core: false });
    }
    steps.push({ kind: "reality_check", questionId: null, label: "Tegenbewijs en zwakke plekken zoeken", core: false });
  } else {
    // Snelle check: eerst elke andere vraag zoeken en uitlezen, daarna pas hun tegenbewijs.
    for (const q of others) {
      steps.push({ kind: "search", questionId: q.id, label: `Bronnen zoeken: ${qLabel(q, false)}`, core: false });
      steps.push({ kind: "extract", questionId: q.id, label: `Citaten controleren: ${qLabel(q, false)}`, core: false });
    }
    for (const q of others) steps.push({ kind: "counter", questionId: q.id, label: `Tegenbewijs zoeken: ${qLabel(q, false)}`, core: false });
  }
  // Punt 6: tot slot weegt de run wat de bevindingen betekenen voor de grootste onzekerheid. Goedkoop, en het budget
  // ervoor wordt vooraf vastgehouden (reserveUsd), dus hij hoort bij de kern.
  steps.push({ kind: "uncertainty", questionId: null, label: "Wat dit betekent voor je grootste onzekerheid", core: true });
  return steps;
}

// ---------------------------------------------------------------------------
// Bovengrens per stap
// ---------------------------------------------------------------------------

export type ModelMap = Partial<Record<ProviderId, string>>;

// Dezelfde aannames als lib/ai/generate.ts en de zoeklus van Claude.
const PROMPT_TOKENS = 2500; // idee, vraag en instructies
const SEARCH_CONTENT_TOKENS = 10_000; // wat een zoekopdracht aan de invoer toevoegt (ChatGPT, Gemini)
const JSON_SCHEMA_TOKENS = 2000;
const MAX_TOKENS_JSON = 16_000; // parse() in lib/ai/research.ts
const MAX_TOKENS_SEARCH = { anthropic: 8000, other: 16_000 };
const CLAUDE_FETCHES = 3;
// Claude's zoeklus kan na de eerste ronde nog een ronde doen; de eerste ronde is de duurste reservering.
const CLAUDE_LOOP_FACTOR = 1.5;
// Gemini bepaalt zelf hoeveel zoekopdrachten het doet; reken met het dubbele.
const GEMINI_OVERSHOOT = 2;
// Uitlezen: maximaal 40 fragmenten van gemiddeld 1500 tekens.
const EXTRACT_INPUT_TOKENS = Math.ceil((40 * 1500) / 3) + PROMPT_TOKENS;
const SUPPORT_INPUT_TOKENS = 1500;
// Ruimte voor de steuncontroles na het uitlezen (ze lopen na elkaar; elke controle reserveert apart).
const SUPPORT_CHECKS_RESERVED = 2;

export const searchesFor = (kind: "search" | "counter", mode: RunMode) => (kind === "search" ? (mode === "quick" ? 3 : 6) : mode === "quick" ? 2 : 4);

const researchModel = (p: ProviderId, models: ModelMap) => models[p] ?? DEFAULT_RESEARCH_MODELS[p];

// Bovengrens van één zoekopdracht van één aanbieder.
export function searchEstimateUsd(p: ProviderId, searches: number, models: ModelMap = {}): number {
  const model = researchModel(p, models);
  if (p === "anthropic") return roundEstimate(model, PROMPT_TOKENS, searches, CLAUDE_FETCHES, MAX_TOKENS_SEARCH.anthropic) * CLAUDE_LOOP_FACTOR;
  const n = p === "gemini" ? searches * GEMINI_OVERSHOOT : searches;
  return estimateCostUsd(p, model, { inputTokens: PROMPT_TOKENS + n * SEARCH_CONTENT_TOKENS, outputTokens: MAX_TOKENS_SEARCH.other, searches: n });
}

// Bovengrens van uitlezen plus de steuncontroles, op de gekozen aanbieder.
export function extractEstimateUsd(p: ProviderId, models: ModelMap = {}): number {
  const model = researchModel(p, models);
  const extract = estimateCostUsd(p, model, { inputTokens: EXTRACT_INPUT_TOKENS + JSON_SCHEMA_TOKENS, outputTokens: MAX_TOKENS_JSON, searches: 0 });
  const support = estimateCostUsd(p, model, { inputTokens: SUPPORT_INPUT_TOKENS + JSON_SCHEMA_TOKENS, outputTokens: MAX_TOKENS_JSON, searches: 0 });
  return extract + SUPPORT_CHECKS_RESERVED * support;
}

// Bovengrens van één stap. `providers`: de aanbieders die zoeken (gekozen aanbieder eerst); uitlezen en de
// slotstappen draaien op de eerste.
export function stepEstimateUsd(kind: string, providers: ProviderId[], mode: RunMode, models: ModelMap = {}): number {
  const primary = providers[0];
  if (!primary) return 0;
  switch (kind) {
    case "search":
      return providers.reduce((s, p) => s + searchEstimateUsd(p, searchesFor("search", mode), models), 0);
    case "counter":
      return providers.reduce((s, p) => s + searchEstimateUsd(p, searchesFor("counter", mode), models), 0) + extractEstimateUsd(primary, models);
    case "extract":
      return extractEstimateUsd(primary, models);
    case "reality_check":
      // Het zware model (challengeDossier): ongeveer 60 bevindingen als invoer.
      return estimateCostUsd(primary, DEFAULT_MODELS[primary], { inputTokens: 8000 + JSON_SCHEMA_TOKENS, outputTokens: MAX_TOKENS_JSON, searches: 0 });
    case "uncertainty":
      // Het onderzoeksmodel: hooguit 40 bevindingen, een kort antwoord.
      return estimateCostUsd(primary, researchModel(primary, models), { inputTokens: 6000 + JSON_SCHEMA_TOKENS, outputTokens: 2000, searches: 0 });
    default:
      return 0;
  }
}

// Het plafond van een run: de snelle check hooguit $1,50, diep onderzoek het serverplafond (RESEARCH_BUDGET_USD).
export function runBudgetUsd(mode: RunMode, serverCapUsd: number): number {
  return mode === "quick" ? Math.min(1.5, serverCapUsd) : serverCapUsd;
}

// Wat een stap moet overlaten voor stappen die altijd moeten kunnen draaien (de slotstap "grootste onzekerheid").
export function reserveUsd(kind: string, pendingKinds: string[], providers: ProviderId[], mode: RunMode, models: ModelMap = {}): number {
  if (kind === "uncertainty" || !pendingKinds.includes("uncertainty")) return 0;
  return stepEstimateUsd("uncertainty", providers, mode, models);
}

// Een stap past als wat al is uitgegeven plus zijn bovengrens binnen het plafond blijft.
export function fitsBudget(spentUsd: number, estimateUsd: number, capUsd: number): boolean {
  return spentUsd + estimateUsd <= capUsd + 1e-9;
}

// Bovengrens van de kern (de beslissende vraag met tegenbewijs).
export function coreEstimateUsd(providers: ProviderId[], mode: RunMode, models: ModelMap = {}): number {
  return ["search", "extract", "counter"].reduce((s, k) => s + stepEstimateUsd(k, providers, mode, models), 0);
}

// Welke aanbieders zoeken in deze run. Diep onderzoek: alle verbonden aanbieders. Snelle check: zoveel aanbieders
// (gekozen aanbieder eerst) als er passen terwijl de kern binnen het plafond blijft; minstens één.
export function providersForRun(providers: ProviderId[], mode: RunMode, capUsd: number, models: ModelMap = {}): ProviderId[] {
  if (mode === "deep" || providers.length <= 1) return providers;
  for (let n = providers.length; n > 1; n--) {
    const pick = providers.slice(0, n);
    if (fitsBudget(0, coreEstimateUsd(pick, mode, models), capUsd)) return pick;
  }
  return providers.slice(0, 1);
}

export type RunEstimate = { lowUsd: number; highUsd: number; capUsd: number; coreUsd: number; totalUsd: number; providers: ProviderId[] };

// De schatting vóór de start: "geschat: $laag–$hoog van max $plafond". Laag: de kern (die gaat altijd eerst);
// hoog: alle geplande stappen, nooit boven het plafond.
export function estimateRun(steps: Pick<PlannedStep, "kind" | "core">[], providers: ProviderId[], mode: RunMode, capUsd: number, models: ModelMap = {}): RunEstimate {
  const used = providersForRun(providers, mode, capUsd, models);
  const cost = (s: Pick<PlannedStep, "kind">) => stepEstimateUsd(s.kind, used, mode, models);
  const coreUsd = steps.filter((s) => s.core).reduce((t, s) => t + cost(s), 0);
  const totalUsd = steps.reduce((t, s) => t + cost(s), 0);
  return { lowUsd: Math.min(coreUsd, capUsd), highUsd: Math.min(totalUsd, capUsd), capUsd, coreUsd, totalUsd, providers: used };
}

const usd = (n: number) => `$${n.toFixed(2).replace(".", ",")}`;

export function estimateText(e: RunEstimate): string {
  const range = Math.abs(e.highUsd - e.lowUsd) < 0.005 ? usd(e.highUsd) : `${usd(e.lowUsd)}–${usd(e.highUsd)}`;
  return `geschat: ${range} van max ${usd(e.capUsd)}`;
}

// Waarom een stap niet start (voor de detailregel van de stap).
export function notStartedText(estimateUsd: number, spentUsd: number, capUsd: number): string {
  return `Budget van deze run reikt niet voor deze stap: hij kost naar schatting tot ${usd(estimateUsd)} en er resteert ${usd(Math.max(0, capUsd - spentUsd))} van max ${usd(capUsd)}. Niet gestart.`;
}
