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

// Status van een aanname uit de goedgekeurde leerkaarten. Tot en met methode 2026-11-b tellen alle tests mee;
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

// Golf B tegenover golf A: de hoofdtest in de beslisregel (decision_rules.primary_experiment_id) moet een test zijn
// die bij een gekozen aanname van die regel als hoofdtest is aangewezen. Anders zou de regel het besluit kunnen laten
// afhangen van een verkennende test.

// De tests die als hoofdtest in de beslisregel kunnen staan: per gekozen aanname haar hoofdtest (zonder dubbelen).
export function rulePrimaryOptions(chosenAssumptionIds: string[], assumptions: PrimaryRef[]): { experimentId: string; assumptionId: string }[] {
  const out: { experimentId: string; assumptionId: string }[] = [];
  for (const id of chosenAssumptionIds) {
    const experimentId = primaryTestFor(id, assumptions);
    if (experimentId && !out.some((o) => o.experimentId === experimentId)) out.push({ experimentId, assumptionId: id });
  }
  return out;
}

// Controle bij het opslaan van de beslisregel (null = in orde). Zonder hoofdtest in de regel is er niets te controleren.
export function rulePrimaryProblem(primaryExperimentId: string | null, chosenAssumptionIds: string[], assumptions: PrimaryRef[]): string | null {
  if (!primaryExperimentId) return null;
  if (rulePrimaryOptions(chosenAssumptionIds, assumptions).some((o) => o.experimentId === primaryExperimentId)) return null;
  if (assumptions.some((a) => a.primary_experiment_id === primaryExperimentId)) {
    return "Deze test is de hoofdtest van een aanname die niet in de beslisregel staat. Kies die aanname ook, of kies een andere hoofdtest.";
  }
  return "Kies als hoofdtest een test die bij een gekozen aanname als hoofdtest is aangewezen. Een verkennende test kan het besluit niet beslissen.";
}

// Kans op toeval bij een geslaagde kansregel: 1 − P(echte waarde > drempel). Null voor andere regels of uitkomsten.
export function chanceOfLuck(o: { rule: string; label: string; probability: number | null }): number | null {
  if (o.rule !== "probability" || o.probability == null) return null;
  if (o.label !== "geslaagd" && o.label !== "sterk bewezen") return null;
  return Math.max(0, Math.min(1, 1 - o.probability));
}
