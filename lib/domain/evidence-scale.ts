// Fase 1, punt 2: één bewijsschaal voor het hele product. Vijf treden, van "we hebben nog niets echts gezien" tot
// "klanten kopen opnieuw". De schaal is een grovere indeling van de bewijsniveaus van de kansberekening (EVIDENCE_LEVELS,
// KIND_LEVEL in lib/domain/evidence.ts): dezelfde soort waarneming staat dus overal op dezelfde trede. De bewijsladder
// van het dossier (lib/domain/dossier-label.ts) is hiervan afgeleid, zodat een demo-aanvraag overal een kleine
// handeling is (gedrag) en nooit een prijskeuze.
// Puur, zonder database. Rekent niets aan de kans: de plafonds blijven per bewijsniveau (DEFAULT_CAPS).

import { EVIDENCE_LEVELS, KIND_LEVEL, LEVEL_SHORT, type EvidenceLevel } from "./evidence";

export type ScaleStep = "exploration" | "opinion" | "behaviour" | "payment" | "repeat";

export const EVIDENCE_SCALE: { step: ScaleStep; label: string; explain: string; levels: EvidenceLevel[] }[] = [
  { step: "exploration", label: "Verkenning", explain: "Nog geen echte waarneming van klanten: alleen bureauonderzoek of niets.", levels: [] },
  { step: "opinion", label: "Mening", explain: "Wat mensen zeggen: meningen, uitgesproken intentie en enquêtes.", levels: ["opinion"] },
  {
    step: "behaviour",
    label: "Gedrag",
    explain: "Wat mensen doen: een probleem in eigen gedrag, een kleine handeling (aanmelding, demo-aanvraag) of een keuze bij een prijs.",
    levels: ["problem", "small_action", "quote"],
  },
  { step: "payment", label: "Betaling", explain: "Er is echt geld ingezet: een aanbetaling.", levels: ["deposit"] },
  { step: "repeat", label: "Herhaling", explain: "Klanten betalen opnieuw: een herhaalaankoop.", levels: ["repeat"] },
];

// De trede van een bewijsniveau; zonder niveau (geen echte waarneming) de verkenning.
export function scaleOf(level: EvidenceLevel | null | undefined): ScaleStep {
  if (!level) return "exploration";
  return EVIDENCE_SCALE.find((s) => s.levels.includes(level))?.step ?? "exploration";
}

export function scaleIndex(step: ScaleStep): number {
  return EVIDENCE_SCALE.findIndex((s) => s.step === step);
}

export function scaleLabel(step: ScaleStep): string {
  return EVIDENCE_SCALE[scaleIndex(step)].label;
}

// De trede van een soort waarneming (via KIND_LEVEL).
export function scaleOfKind(kind: string): ScaleStep {
  return kind in KIND_LEVEL ? scaleOf(KIND_LEVEL[kind as keyof typeof KIND_LEVEL]) : "exploration";
}

// Soorten waarneming die op de bewijsladder van het dossier staan: alleen ondersteunend klantbewijs per persoon. Tegenbewijs
// (bezwaar, probleem niet herkend, tegenvoorbeeld), "overig" en enquête-uitkomsten (zelfrapportage van een groep, geen
// waarneming per persoon) staan er niet op.
const LADDER_EXCLUDED = new Set(["objection", "problem_absent", "counter_example", "other", "survey_answer"]);

// Label per bewijsniveau op de bewijsladder (het sterkste klantbewijs van het dossier).
const LADDER_LABEL: Record<EvidenceLevel, string> = {
  opinion: "Uitgesproken belangstelling",
  problem: "Probleem in eigen gedrag",
  small_action: "Kleine handeling (aanmelding, demo-aanvraag)",
  quote: "Offerte of keuze bij prijs",
  deposit: "Aanbetaling",
  repeat: "Herhaalde aankoop",
};

// De sporten van de bewijsladder: één per bewijsniveau, met de soorten waarneming uit KIND_LEVEL en de trede op de schaal.
export function ladderRungs(): { level: EvidenceLevel; step: ScaleStep; kinds: string[]; label: string; short: string }[] {
  return EVIDENCE_LEVELS.map(({ level }) => ({
    level,
    step: scaleOf(level),
    kinds: (Object.keys(KIND_LEVEL) as (keyof typeof KIND_LEVEL)[]).filter((k) => KIND_LEVEL[k] === level && !LADDER_EXCLUDED.has(k)),
    label: LADDER_LABEL[level],
    short: LEVEL_SHORT[level],
  }));
}
