// Experimentencatalogus: welke soort waarneming een handmatig sjabloon mag opleveren. Puur, zonder imports buiten de
// labels, zodat de bewijsberekening (evidence.ts) het kan gebruiken zonder de catalogus zelf te laden.
//
// Handmatig ingevoerde resultaten zijn niet door ProofLab zelf waargenomen. Ze tellen daarom hooguit als een kleine
// handeling op de bewijsladder (aanmelding, demo- of vervolgaanvraag): nooit als prijskeuze, betaling of herhaalaankoop.
// Een betaling of getekende toezegging telt alleen via de ingebouwde betaalstap of toezeggingsstap. De database dwingt
// dezelfde lijst af (experiments_manual_catalog, migratie 20261118100000_experiment_catalog).

import type { ObservationKind } from "./labels";

export const MANUAL_OBSERVATION_KINDS = [
  "opinion",
  "problem_confirmed",
  "current_behaviour",
  "current_spend",
  "waitlist_signup",
  "demo_request",
] as const satisfies readonly ObservationKind[];
export type ManualObservationKind = (typeof MANUAL_OBSERVATION_KINDS)[number];

export function isManualObservationKind(v: unknown): v is ManualObservationKind {
  return typeof v === "string" && (MANUAL_OBSERVATION_KINDS as readonly string[]).includes(v);
}

// De vastgelegde soort waarneming van een handmatige test (config.observation_kind), of null.
export function manualKindOf(config: unknown): ManualObservationKind | null {
  const k = config && typeof config === "object" ? (config as { observation_kind?: unknown }).observation_kind : null;
  return isManualObservationKind(k) ? k : null;
}

// De catalogusmethode van een handmatige test (config.catalog_method_id), of null.
export function catalogMethodIdOf(config: unknown): string | null {
  const id = config && typeof config === "object" ? (config as { catalog_method_id?: unknown }).catalog_method_id : null;
  return typeof id === "string" && /^[a-z0-9-]{2,60}$/.test(id) ? id : null;
}
