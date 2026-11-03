// "Wat ging tegen" (golf B, punt 18). Voordat de opdrachtgever een besluit bevestigt, ziet hij verplicht wat het
// besluit tegenspreekt: mislukte tests, tegenbewijs, begrensde aannames (plafond actief) en afwijkingen van de
// beslisregel. Pure functie; de database (confirm_decision) eist dat deze samenvatting is meegegeven en telt zelf na
// of alle mislukte tests en de afwijking erin staan.

export type AgainstInput = {
  // Per test het oordeel van de laatste goedgekeurde Learning Card (null = nog geen goedgekeurde kaart).
  tests: { id: string; title: string; verdict: "pass" | "fail" | "inconclusive" | null }[];
  // Bevindingen met een letterlijk gecontroleerde bron die de bewering tegenspreekt.
  contradictedClaims: { id: string; statement: string }[];
  // Observaties die altijd tegenbewijs zijn (bezwaar, probleem niet herkend, tegenvoorbeeld); synthetisch telt niet.
  counterObservations: { id: string; kind: string; summary: string; isSynthetic: boolean }[];
  // Aannames waarvan de kans door het plafond van het bewijsniveau wordt begrensd.
  assumptions: { id: string; statement: string; capActive: boolean; capReason: string | null }[];
  // Het besluit dat wordt bevestigd: wijkt het af van de beslisregel, dan staat de motivering erbij.
  deviation: { label: string; reason: string } | null;
};

export type AgainstSummary = {
  failed_tests: { id: string; title: string }[];
  counter_evidence: { id: string; kind: "claim" | "observation"; text: string }[];
  capped_assumptions: { id: string; statement: string; reason: string }[];
  rule_deviations: { label: string; reason: string }[];
};

export const COUNTER_KINDS = ["objection", "problem_absent", "counter_example"] as const;
const COUNTER_LABELS: Record<string, string> = { objection: "Bezwaar", problem_absent: "Probleem niet herkend", counter_example: "Tegenvoorbeeld" };

export function againstSummary(i: AgainstInput): AgainstSummary {
  return {
    failed_tests: i.tests.filter((t) => t.verdict === "fail").map((t) => ({ id: t.id, title: t.title })),
    counter_evidence: [
      ...i.contradictedClaims.map((c) => ({ id: c.id, kind: "claim" as const, text: c.statement })),
      ...i.counterObservations
        .filter((o) => !o.isSynthetic && (COUNTER_KINDS as readonly string[]).includes(o.kind))
        .map((o) => ({ id: o.id, kind: "observation" as const, text: `${COUNTER_LABELS[o.kind]}: ${o.summary}` })),
    ],
    capped_assumptions: i.assumptions.filter((a) => a.capActive).map((a) => ({ id: a.id, statement: a.statement, reason: a.capReason ?? "begrensd door het bewijsniveau" })),
    rule_deviations: i.deviation ? [i.deviation] : [],
  };
}

export function againstCount(s: AgainstSummary): number {
  return s.failed_tests.length + s.counter_evidence.length + s.capped_assumptions.length + s.rule_deviations.length;
}
