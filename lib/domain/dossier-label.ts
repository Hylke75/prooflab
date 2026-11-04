// Report labels follow checkable rules per dossier, never an LLM score or a % "chance of success".

import { countPerPerson, dedupeByPerson, type PersonRef } from "./per-person";
import type { EvidenceLevel } from "./evidence";
import { ladderRungs, type ScaleStep } from "./evidence-scale";

export type DossierLabel = "Verkenning" | "Onderbouwd marktbeeld" | "Eerste gedragsbewijs" | "Herhaald marktgedragsbewijs";

export type LabelInput = {
  claims: { status: string; domain: string | null; sourceType: string | null }[];
  competitorKinds: string[];
  sizingComputed: boolean;
  behaviourCards: { verdict: string; channels: string[]; endedOn: string | null }[]; // approved learning cards of behaviour experiments
};

export function dossierLabel(i: LabelInput): { label: DossierLabel; missing: string[] } {
  const good = i.claims.filter((c) => c.status === "verified" || c.status === "estimate");
  const domains = new Set(good.map((c) => c.domain).filter(Boolean));
  const strong = good.some((c) => c.sourceType === "official_statistic" || c.sourceType === "primary_document");
  const marketMissing: string[] = [];
  if (good.length < 3) marketMissing.push("minstens 3 onderbouwde bevindingen");
  if (domains.size < 2) marketMissing.push("bronnen van minstens 2 onafhankelijke uitgevers");
  if (!strong) marketMissing.push("een officiële statistiek of primaire bron");
  if (i.competitorKinds.length < 3) marketMissing.push("minstens 3 aanbieders of alternatieven");
  if (!i.competitorKinds.some((k) => k === "alternative" || k === "status_quo")) marketMissing.push("het huidige alternatief of 'niets doen'");
  if (!i.sizingComputed) marketMissing.push("een berekende marktomvang (of expliciet 'niet vastgesteld')");
  if (marketMissing.length) return { label: "Verkenning", missing: marketMissing };

  const passes = i.behaviourCards.filter((c) => c.verdict === "pass");
  // A failed or inconclusive behaviour test is learning, not behavioural evidence for the idea.
  if (passes.length === 0) {
    return {
      label: "Onderbouwd marktbeeld",
      missing: [i.behaviourCards.length ? "een geslaagd gedragsexperiment (de afgeronde tests haalden de drempel niet)" : "een afgerond gedragsexperiment met goedgekeurde Learning Card"],
    };
  }
  const distinct = new Set(passes.map((c) => `${c.endedOn?.slice(0, 7)}|${[...c.channels].sort().join(",")}`));
  if (passes.length >= 2 && distinct.size >= 2) return { label: "Herhaald marktgedragsbewijs", missing: [] };
  return { label: "Eerste gedragsbewijs", missing: ["een tweede geslaagd gedragsexperiment in een andere periode of via een ander kanaal"] };
}

// ---------------------------------------------------------------------------
// Sterkste klantbewijs van het dossier (Bewijs & besluit en het rapport). Telt per persoon (fase B0, punt 1):
// één interview levert per bewijsniveau en richting maximaal één waarneming (lib/domain/per-person.ts).
// ---------------------------------------------------------------------------

// Fase 1, punt 2: afgeleid van de bewijsschaal (lib/domain/evidence-scale.ts), dus met dezelfde indeling als de
// kansberekening (KIND_LEVEL): een demo-aanvraag is overal een kleine handeling.
export const EVIDENCE_LADDER: { kinds: string[]; label: string; level: EvidenceLevel; step: ScaleStep }[] = ladderRungs().map(({ kinds, label, level, step }) => ({ kinds, label, level, step }));

export type LadderObservation = PersonRef & { isSynthetic: boolean };

export type EvidenceLadder = {
  rungs: { label: string; count: number; level?: EvidenceLevel; step?: ScaleStep }[];
  highest: { label: string; count: number; level?: EvidenceLevel; step?: ScaleStep } | null;
  paymentShown: boolean; // aanbetaling of herhaalaankoop gezien
  counted: number; // niet-synthetische waarnemingen, per persoon
  quotes: number; // niet-synthetische waarnemingen zoals vastgelegd (losse citaten)
  people: number; // verschillende geïnterviewden
};

export function evidenceLadder(observations: LadderObservation[]): EvidenceLadder {
  const real = observations.filter((o) => !o.isSynthetic);
  const counted = dedupeByPerson(real, (o) => o);
  const rungs = EVIDENCE_LADDER.map((r) => ({ label: r.label, count: counted.filter((o) => r.kinds.includes(o.kind)).length, level: r.level, step: r.step }));
  const totals = countPerPerson(real, (o) => o);
  return {
    rungs,
    highest: [...rungs].reverse().find((r) => r.count > 0) ?? null,
    paymentShown: rungs.slice(4).some((r) => r.count > 0),
    counted: totals.counted,
    quotes: totals.quotes,
    people: totals.people,
  };
}

// Eén zin voor het rapport: "Klantbewijs: 4 waarnemingen (per persoon), uit 9 vastgelegde uitspraken; 3 geïnterviewden.
// Sterkste: probleem in eigen gedrag (2× per persoon)." Leeg voor rapporten van vóór deze telling.
export function ladderSummary(l: EvidenceLadder | undefined): string {
  if (!l) return "";
  if (l.counted === 0) return "Klantbewijs: nog geen waarnemingen.";
  const quotes = l.quotes > l.counted ? `, uit ${l.quotes} vastgelegde uitspraken` : "";
  const people = l.people ? `; ${l.people} ${l.people === 1 ? "geïnterviewde" : "geïnterviewden"}` : "";
  const strongest = l.highest ? ` Sterkste: ${l.highest.label.toLowerCase()} (${l.highest.count}× per persoon).` : "";
  return `Klantbewijs: ${l.counted} ${l.counted === 1 ? "waarneming" : "waarnemingen"} (per persoon)${quotes}${people}.${strongest}`;
}
