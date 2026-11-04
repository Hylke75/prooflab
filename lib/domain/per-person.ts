// Waarnemingen tellen per persoon, niet per citaat (fase B0, punt 1).
//
// Een interview wordt gecodeerd in losse uitspraken; elke uitspraak is een rij in `observations` met hetzelfde
// interview_id. Zonder deze regel levert één enthousiaste geïnterviewde vijf "bewijzen" op. Daarom houdt
// `dedupeByPerson` per interview, per bewijsniveau (KIND_LEVEL, dezelfde indeling als de plafonds, de Learning
// Cards en het rapport) en per richting (steunend of tegensprekend) maximaal één waarneming over: de sterkste
// (strength), bij gelijke sterkte de eerste. Zo valt tegenbewijs van dezelfde persoon niet weg achter steun.
//
// Waarnemingen zonder interview (landingpagina, prijstest, enquête) zijn al per bezoeker of respondent geteld en
// blijven ongewijzigd, net als synthetische waarnemingen (die tellen elders nergens mee). Puur en deterministisch:
// de volgorde van de invoer blijft behouden.

import { KIND_DEFAULTS, KIND_LEVEL, OBSERVATION_LR, strength, type EvidenceLevel, type ObservationDims } from "./evidence";
import type { ObservationKind } from "./labels";

export type Direction = "supports" | "contradicts";

export type PersonRef = {
  interviewId?: string | null;
  kind: string;
  // De koppeling met een aanname (assumption_observations.relation). Zonder koppeling volgt de richting uit de soort.
  relation?: string | null;
  // Afwijkende dimensies van de waarneming; wat ontbreekt volgt uit de soort (KIND_DEFAULTS).
  dims?: Partial<ObservationDims> | null;
};

const asKind = (kind: string): ObservationKind => (kind in KIND_LEVEL ? (kind as ObservationKind) : "other");

// Het bewijsniveau van een waarneming: dezelfde indeling als de plafonds per bewijsniveau.
export function observationLevel(kind: string): EvidenceLevel {
  return KIND_LEVEL[asKind(kind)];
}

// Bezwaar, "probleem niet herkend" en tegenvoorbeeld zijn altijd tegenbewijs, wat de koppeling ook zegt
// (zoals in de kansberekening). Anders telt de koppeling; zonder koppeling is de waarneming steunend.
export function observationDirection(r: Pick<PersonRef, "kind" | "relation">): Direction {
  if (OBSERVATION_LR[asKind(r.kind)].against) return "contradicts";
  return r.relation === "contradicts" ? "contradicts" : "supports";
}

function strengthOf(r: PersonRef): number {
  const base = KIND_DEFAULTS[asKind(r.kind)];
  const d = r.dims ?? {};
  return strength({
    isFact: d.isFact ?? base.isFact,
    isBehaviour: d.isBehaviour ?? base.isBehaviour,
    isRealContext: d.isRealContext ?? base.isRealContext,
    isCostly: d.isCostly ?? base.isCostly,
    isSynthetic: false,
  });
}

// Per interview, per bewijsniveau en per richting maximaal één waarneming: de sterkste, bij gelijke sterkte de eerste.
export function dedupeByPerson<T>(items: T[], ref: (t: T) => PersonRef): T[] {
  const best = new Map<string, { index: number; strength: number }>();
  const grouped = new Set<number>();
  items.forEach((item, index) => {
    const r = ref(item);
    if (!r.interviewId || r.dims?.isSynthetic) return;
    grouped.add(index);
    const key = `${r.interviewId}|${observationLevel(r.kind)}|${observationDirection(r)}`;
    const s = strengthOf(r);
    const cur = best.get(key);
    if (!cur || s > cur.strength) best.set(key, { index, strength: s });
  });
  const kept = new Set([...best.values()].map((b) => b.index));
  return items.filter((_, i) => !grouped.has(i) || kept.has(i));
}

// Aantallen voor op het scherm en in het rapport: waarnemingen per persoon, het aantal losse citaten en het aantal
// verschillende geïnterviewden.
export function countPerPerson<T>(items: T[], ref: (t: T) => PersonRef): { counted: number; quotes: number; people: number } {
  const interviews = new Set(items.map((i) => ref(i).interviewId).filter((x): x is string => !!x));
  return { counted: dedupeByPerson(items, ref).length, quotes: items.length, people: interviews.size };
}

// "5 waarnemingen (per persoon)"; met de losse citaten erbij als die meer zijn.
export function perPersonLabel(c: { counted: number; quotes: number }): string {
  const base = `${c.counted} ${c.counted === 1 ? "waarneming" : "waarnemingen"} (per persoon)`;
  return c.quotes > c.counted ? `${base}, uit ${c.quotes} citaten` : base;
}
