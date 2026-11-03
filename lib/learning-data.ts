import "server-only";
import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import {
  coachRuleStats,
  DEFAULT_WEIGHTS,
  learnWeights,
  surveyAgreement,
  weightsInUse,
  type Achieved,
  type Agreement,
  type AgreementRow,
  type EvidenceCountRow,
  type LearnedWeight,
  type LrOverrides,
  type RuleStats,
  type WeightsInUse,
} from "@/lib/domain/calibration";

const ACHIEVED = ["yes", "partial", "no"];
const DIRECTIONS = ["positive", "negative", ""];
const DIMENSIONS = ["observation", "test", "resolved"];

function countRows(data: { dimension: string; kind: string; achieved: string; direction: string; dossiers: number }[] | null): EvidenceCountRow[] {
  return (data ?? [])
    .filter((r) => DIMENSIONS.includes(r.dimension) && ACHIEVED.includes(r.achieved) && DIRECTIONS.includes(r.direction))
    .map((r) => ({ dimension: r.dimension as EvidenceCountRow["dimension"], kind: r.kind, achieved: r.achieved as Achieved, direction: r.direction as EvidenceCountRow["direction"], dossiers: Number(r.dossiers) }));
}

const resolvedOf = (rows: EvidenceCountRow[]) => rows.filter((r) => r.dimension === "resolved").reduce((s, r) => s + r.dossiers, 0);

// The evidence factors used for the probabilities of one idea. Default factors unless the organisation
// switched learned weights on; the same for consultant and client (the database decides, per idea). Falls
// back to the defaults when the learning schema is not in this database yet.
export const loadIdeaWeights = cache(async (ideaId: string): Promise<{ inUse: WeightsInUse; overrides: LrOverrides }> => {
  const supabase = await supabaseServer();
  const on = await supabase.rpc("idea_uses_learned_weights", { p_idea: ideaId });
  if (on.error || on.data !== true) return { inUse: DEFAULT_WEIGHTS, overrides: {} };
  const counts = await supabase.rpc("idea_learning_counts", { p_idea: ideaId });
  if (counts.error) return { inUse: DEFAULT_WEIGHTS, overrides: {} };
  const rows = countRows(counts.data);
  return weightsInUse(true, learnWeights(rows), resolvedOf(rows));
});

export type LearningView = {
  useLearned: boolean;
  changedAt: string | null;
  changedBy: string | null;
  resolvedDossiers: number;
  weights: LearnedWeight[];
  agreement: Agreement;
  coach: RuleStats[];
};

// Everything the learning section of the forecast quality page shows. Null without the learning schema.
export async function loadLearningView(orgId: string): Promise<LearningView | null> {
  const supabase = await supabaseServer();
  const [org, counts, agreement, coach] = await Promise.all([
    supabase.from("organizations").select("use_learned_weights, learned_weights_changed_at, learned_weights_changed_by").eq("id", orgId).maybeSingle(),
    supabase.rpc("learning_evidence_counts", { p_org: orgId }),
    supabase.rpc("survey_behaviour_agreement", { p_org: orgId }),
    supabase.rpc("coach_note_stats", { p_org: orgId }),
  ]);
  if (org.error || counts.error || agreement.error || coach.error || !org.data) return null;
  const rows = countRows(counts.data);
  let changedBy: string | null = null;
  if (org.data.learned_weights_changed_by) {
    const { data: p } = await supabase.from("profiles").select("full_name, email").eq("user_id", org.data.learned_weights_changed_by).maybeSingle();
    changedBy = p?.full_name?.trim() || p?.email || null;
  }
  const verdicts = ["pass", "fail", "mixed"];
  return {
    useLearned: org.data.use_learned_weights,
    changedAt: org.data.learned_weights_changed_at,
    changedBy,
    resolvedDossiers: resolvedOf(rows),
    weights: learnWeights(rows),
    agreement: surveyAgreement(
      (agreement.data ?? [])
        .filter((r) => verdicts.includes(r.survey_verdict) && verdicts.includes(r.behaviour_verdict))
        .map((r): AgreementRow => ({ surveyVerdict: r.survey_verdict as AgreementRow["surveyVerdict"], behaviourVerdict: r.behaviour_verdict as AgreementRow["behaviourVerdict"], assumptions: Number(r.assumptions) })),
    ),
    coach: coachRuleStats(
      (coach.data ?? []).map((r) => ({
        ideaId: r.idea_id,
        rule: r.rule,
        status: r.status,
        daysToResolve: r.days_to_resolve == null ? null : Number(r.days_to_resolve),
        helpful: r.helpful,
        decisionBrier: r.decision_brier == null ? null : Number(r.decision_brier),
      })),
    ),
  };
}
