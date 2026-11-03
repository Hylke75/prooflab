// Hoofdtest per aanname (golf A, punt 11). Wie veel kleine tests doet, vindt er vroeg of laat één die toevallig
// slaagt. Daarom wijst de consultant per aanname vooraf één hoofdtest aan; de andere tests van die aanname heten
// "verkennend". Vanaf methode 2026-11-c beslist alleen de hoofdtest over de status van de aanname, en de
// beslisregel voor het besluit (golf B) gebruikt alleen hoofdtests als doorslag. Pure functies, zonder database.

import { assumptionStatusFromVerdicts, type CardVerdict } from "@/lib/domain/evidence";

export type TestRole = "primary" | "exploratory";
export const TEST_ROLES: Record<TestRole, { label: string; explain: string }> = {
  primary: { label: "Hoofdtest", explain: "Vooraf aangewezen als de test die over deze aanname beslist." },
  exploratory: { label: "Verkennend", explain: "Geeft richting, maar beslist niet over de aanname of het besluit." },
};

// Een aanname met haar aangewezen hoofdtest (assumptions.primary_experiment_id).
export type PrimaryRef = { id: string; primary_experiment_id?: string | null };

// De hoofdtest (experiment-id) van een aanname, of null als er geen is aangewezen. Voor golf B: de beslisregel
// voor het besluit gebruikt alleen deze tests als doorslag.
export function primaryTestFor(assumptionId: string, assumptions: PrimaryRef[]): string | null {
  return assumptions.find((a) => a.id === assumptionId)?.primary_experiment_id ?? null;
}

export function testRole(experimentId: string, assumptionId: string | null | undefined, assumptions: PrimaryRef[]): TestRole {
  return assumptionId != null && primaryTestFor(assumptionId, assumptions) === experimentId ? "primary" : "exploratory";
}

// Een hoofdtest wijs je vooraf aan: zolang de test nog een concept is of ter review ligt. Daarna ligt de keuze vast,
// net als de drempels (anders kies je achteraf de test die toevallig slaagde).
export const OPEN_STATES = ["draft", "ready_for_review"] as const;
export function canDesignatePrimary(test: { state: string }, currentPrimary: { state: string } | null): { ok: boolean; reason: string | null } {
  if (!(OPEN_STATES as readonly string[]).includes(test.state)) {
    return { ok: false, reason: "Een hoofdtest wijs je aan vóór de goedkeuring. Deze test is al goedgekeurd of gestart en blijft verkennend." };
  }
  if (currentPrimary && !(OPEN_STATES as readonly string[]).includes(currentPrimary.state)) {
    return { ok: false, reason: "Deze aanname heeft al een goedgekeurde of gestarte hoofdtest. Die keuze ligt vast." };
  }
  return { ok: true, reason: null };
}

// Status van een aanname uit de goedgekeurde Learning Cards. Tot en met methode 2026-11-b tellen alle tests mee;
// vanaf 2026-11-c (primaryDecides) alleen de hoofdtest. Zonder goedgekeurde hoofdtest blijft de aanname "wordt
// getest": verkennende tests geven richting, maar beslissen niet.
export function assumptionStatusFromCards(
  cards: { verdict: CardVerdict; experimentId: string }[],
  primaryId: string | null,
  primaryDecides: boolean,
): "supported" | "refuted" | "inconclusive" | "untested" | "testing" {
  if (!primaryDecides) return assumptionStatusFromVerdicts(cards.map((c) => c.verdict));
  const primary = cards.filter((c) => primaryId != null && c.experimentId === primaryId);
  if (primary.length) return assumptionStatusFromVerdicts(primary.map((c) => c.verdict));
  return cards.length ? "testing" : "untested";
}

// Kans op toeval bij een geslaagde kansregel: 1 − P(echte waarde > drempel). Null voor andere regels of uitkomsten.
export function chanceOfLuck(o: { rule: string; label: string; probability: number | null }): number | null {
  if (o.rule !== "probability" || o.probability == null) return null;
  if (o.label !== "geslaagd" && o.label !== "sterk bewezen") return null;
  return Math.max(0, Math.min(1, 1 - o.probability));
}
