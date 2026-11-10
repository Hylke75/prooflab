// Beslisregel van bewijs naar besluit (golf B, punt 6). Vooraf, uiterlijk vóór de eerste goedgekeurde test, legt het
// team vast wanneer het doorgaat: welke aannames boven welke kans moeten uitkomen en welke hoofdtest moet slagen. Bij
// het besluit toont ProofLab per voorwaarde of die is gehaald. Wie afwijkt, motiveert dat (audit en rapport).
// Pure functies; de database bewaakt de vergrendeling en de motivering (migratie golf_b).

export const FINAL_ACTIONS = ["continue", "stop", "pause"] as const;
export type FinalAction = (typeof FINAL_ACTIONS)[number];
export const isFinalAction = (a: string): a is FinalAction => (FINAL_ACTIONS as readonly string[]).includes(a);

// Kansen in de regel liggen tussen 5% en 95% (zelfde grenzen als de database).
export const RULE_MIN = 0.05;
export const RULE_MAX = 0.95;
// Minimale lengte van een motivering bij afwijken (zelfde als de database).
export const DEVIATION_MIN_CHARS = 15;

export type DecisionRule = {
  primaryExperimentId: string | null;
  note: string | null;
  lockedAt: string | null;
  recordedLate: boolean;
  conditions: { assumptionId: string; minProbability: number }[];
};

export type RuleAssumption = { id: string; statement: string; probability: number };
export type RuleExperiment = { id: string; title: string; verdict: "pass" | "fail" | "inconclusive" | null };

export type RuleEvaluation = {
  met: boolean;
  conditions: { assumptionId: string; statement: string; minProbability: number; probability: number | null; met: boolean }[];
  primary: { experimentId: string; title: string; verdict: RuleExperiment["verdict"]; met: boolean } | null;
};

// Toetst de regel aan de kansen en leerkaarten van nu. Een verdwenen aanname of hoofdtest telt als niet gehaald.
export function evaluateRule(rule: DecisionRule, assumptions: RuleAssumption[], experiments: RuleExperiment[]): RuleEvaluation {
  const conditions = rule.conditions.map((c) => {
    const a = assumptions.find((x) => x.id === c.assumptionId);
    const probability = a ? a.probability : null;
    return { assumptionId: c.assumptionId, statement: a?.statement ?? "Verwijderde aanname", minProbability: c.minProbability, probability, met: probability != null && probability >= c.minProbability };
  });
  const exp = rule.primaryExperimentId ? experiments.find((e) => e.id === rule.primaryExperimentId) : null;
  const primary = rule.primaryExperimentId
    ? { experimentId: rule.primaryExperimentId, title: exp?.title ?? "Verwijderde test", verdict: exp?.verdict ?? null, met: exp?.verdict === "pass" }
    : null;
  const met = conditions.every((c) => c.met) && (primary ? primary.met : true);
  return { met, conditions, primary };
}

// Afwijken: doorgaan terwijl de regel niet is gehaald, of stoppen/pauzeren terwijl hij wel is gehaald. Bijsturen,
// verder testen en de verlengde testfase zijn geen definitief besluit en wijken dus niet af.
export function deviates(action: string, met: boolean | null): boolean {
  if (met == null || !isFinalAction(action)) return false;
  return (!met && action === "continue") || (met && (action === "stop" || action === "pause"));
}

// Leesbare toelichting bij een afwijking, voor scherm en rapport.
export function deviationLabel(action: string, met: boolean): string {
  return !met && action === "continue" ? "Doorgaan terwijl de beslisregel niet is gehaald" : "Stoppen of pauzeren terwijl de beslisregel is gehaald";
}

// Problemen met een regel voordat hij wordt opgeslagen (null = in orde).
export function ruleProblem(rule: { conditions: { minProbability: number }[]; primaryExperimentId: string | null }): string | null {
  if (rule.conditions.length === 0 && !rule.primaryExperimentId) return "Kies minstens één aanname met een minimale kans, of een hoofdtest die moet slagen.";
  if (rule.conditions.some((c) => !(c.minProbability >= RULE_MIN && c.minProbability <= RULE_MAX)))
    return `Een minimale kans ligt tussen ${Math.round(RULE_MIN * 100)}% en ${Math.round(RULE_MAX * 100)}%.`;
  return null;
}

// Eén zin over de regel, bijv. "Doorgaan als 2 aannames hun minimale kans halen en de hoofdtest slaagt."
export function describeRule(rule: DecisionRule, primaryTitle?: string | null): string {
  const parts: string[] = [];
  if (rule.conditions.length) parts.push(`${rule.conditions.length === 1 ? "1 aanname haar" : `${rule.conditions.length} aannames hun`} minimale kans ${rule.conditions.length === 1 ? "haalt" : "halen"}`);
  if (rule.primaryExperimentId) parts.push(primaryTitle ? `de hoofdtest "${primaryTitle}" slaagt` : "de hoofdtest slaagt");
  return parts.length ? `Doorgaan als ${parts.join(" en ")}.` : "Nog geen voorwaarden.";
}
