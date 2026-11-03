import "server-only";
import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { loadAssumptions } from "@/lib/progress";
import { evaluateRule, type DecisionRule, type RuleAssumption, type RuleEvaluation, type RuleExperiment } from "@/lib/domain/decision-rule";

// De beslisregel van een dossier (golf B, punt 6). null = nog geen regel; undefined = de database kent de tabel nog niet.
export const loadDecisionRule = cache(async (ideaId: string): Promise<DecisionRule | null | undefined> => {
  const supabase = await supabaseServer();
  const [rule, conditions] = await Promise.all([
    supabase.from("decision_rules").select("*").eq("idea_id", ideaId).maybeSingle(),
    supabase.from("decision_rule_assumptions").select("assumption_id, min_probability").eq("idea_id", ideaId),
  ]);
  if (rule.error || conditions.error) return undefined;
  if (!rule.data) return null;
  return {
    primaryExperimentId: rule.data.primary_experiment_id,
    note: rule.data.note,
    lockedAt: rule.data.locked_at,
    recordedLate: rule.data.recorded_late,
    conditions: (conditions.data ?? []).map((c) => ({ assumptionId: c.assumption_id, minProbability: Number(c.min_probability) })),
  };
});

// De invoer voor de toets: de kans per aanname zoals ProofLab die nu berekent, en per test het oordeel van de laatste
// goedgekeurde Learning Card (zonder goedgekeurde kaart: nog geen oordeel).
export const loadRuleInputs = cache(async (ideaId: string): Promise<{ assumptions: RuleAssumption[]; experiments: RuleExperiment[] }> => {
  const supabase = await supabaseServer();
  const [assumptions, experiments, cards] = await Promise.all([
    loadAssumptions(ideaId),
    supabase.from("experiments").select("id, title, state").eq("idea_id", ideaId).order("created_at"),
    supabase.from("learning_cards").select("experiment_id, verdict, version, created_at").eq("idea_id", ideaId).eq("status", "approved"),
  ]);
  const latest = new Map<string, { verdict: string; version: number; created_at: string }>();
  for (const c of cards.data ?? []) {
    const prev = latest.get(c.experiment_id);
    if (!prev || c.version > prev.version || (c.version === prev.version && c.created_at > prev.created_at)) latest.set(c.experiment_id, c);
  }
  return {
    assumptions: assumptions.map((a) => ({ id: a.id, statement: a.statement, probability: a.probability.probability })),
    experiments: (experiments.data ?? []).map((e) => ({ id: e.id, title: e.title, verdict: (latest.get(e.id)?.verdict as RuleExperiment["verdict"]) ?? null })),
  };
});

// De regel met de toets van nu, of null als het dossier (nog) geen regel heeft.
export async function loadRuleCheck(ideaId: string): Promise<{ rule: DecisionRule; evaluation: RuleEvaluation } | null> {
  const rule = await loadDecisionRule(ideaId);
  if (!rule) return null;
  const inputs = await loadRuleInputs(ideaId);
  return { rule, evaluation: evaluateRule(rule, inputs.assumptions, inputs.experiments) };
}
