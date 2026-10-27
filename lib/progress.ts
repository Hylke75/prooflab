import "server-only";
import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { assumptionEvidence, type ObservationDims } from "@/lib/domain/evidence";
import type { ClaimStatus } from "@/lib/domain/labels";
import type { IdeaProgress } from "@/lib/domain/coach";

export type AssumptionWithEvidence = {
  id: string;
  statement: string;
  category: string;
  importance: number;
  status: string;
  origin: string;
  evidence: number;
  supporting: number;
  contradicting: number;
};

// Computes the evidence axis of every assumption from linked claims and observations.
export const loadAssumptions = cache(async (ideaId: string): Promise<AssumptionWithEvidence[]> => {
  const supabase = await supabaseServer();
  const [{ data: assumptions }, { data: links }, { data: obsLinks }] = await Promise.all([
    supabase.from("assumptions").select("*").eq("idea_id", ideaId).order("created_at"),
    supabase.from("assumption_claims").select("assumption_id, relation, claims(status)").eq("idea_id", ideaId),
    supabase
      .from("assumption_observations")
      .select("assumption_id, relation, observations(is_fact, is_behaviour, is_real_context, is_costly, is_synthetic)")
      .eq("idea_id", ideaId),
  ]);
  return (assumptions ?? []).map((a) => {
    const claims = (links ?? [])
      .filter((l) => l.assumption_id === a.id && l.claims)
      .map((l) => ({ status: l.claims!.status as ClaimStatus, relation: l.relation as "supports" | "contradicts" }));
    const observations = (obsLinks ?? [])
      .filter((l) => l.assumption_id === a.id && l.observations)
      .map((l) => {
        const o = l.observations!;
        const dims: ObservationDims = {
          isFact: o.is_fact,
          isBehaviour: o.is_behaviour,
          isRealContext: o.is_real_context,
          isCostly: o.is_costly,
          isSynthetic: o.is_synthetic,
        };
        return { ...dims, relation: l.relation as "supports" | "contradicts" };
      });
    const e = assumptionEvidence(claims, observations);
    return {
      id: a.id,
      statement: a.statement,
      category: a.category,
      importance: a.importance,
      status: a.status,
      origin: a.origin,
      evidence: e.score,
      supporting: e.supporting,
      contradicting: e.contradicting,
    };
  });
});

// Risk priority: most important first, then least evidence.
export function rankAssumptions(list: AssumptionWithEvidence[]): AssumptionWithEvidence[] {
  return [...list].sort((a, b) => b.importance * (1 - b.evidence) - a.importance * (1 - a.evidence));
}

export const loadProgress = cache(async (ideaId: string): Promise<IdeaProgress> => {
  const supabase = await supabaseServer();
  const count = { count: "exact" as const, head: true };
  const [questions, claims, verified, weak, competitors, alternatives, experiments, cards, decisions, behaviour, sizing] = await Promise.all([
    supabase.from("research_questions").select("id", count).eq("idea_id", ideaId),
    supabase.from("claims").select("id", count).eq("idea_id", ideaId),
    supabase.from("claims").select("id", count).eq("idea_id", ideaId).eq("status", "verified"),
    supabase.from("claims").select("id", count).eq("idea_id", ideaId).eq("status", "insufficient"),
    supabase.from("competitors").select("id", count).eq("idea_id", ideaId),
    supabase.from("competitors").select("id", count).eq("idea_id", ideaId).in("kind", ["alternative", "status_quo"]),
    supabase.from("experiments").select("state").eq("idea_id", ideaId),
    supabase.from("learning_cards").select("status").eq("idea_id", ideaId),
    supabase.from("decisions").select("id", count).eq("idea_id", ideaId),
    supabase.from("observations").select("id", count).eq("idea_id", ideaId).eq("is_behaviour", true).eq("is_synthetic", false),
    supabase.from("sizing_factors").select("key, claims(status)").eq("idea_id", ideaId).eq("key", "base_count"),
  ]);
  const assumptions = rankAssumptions(await loadAssumptions(ideaId));
  const states = (experiments.data ?? []).map((e) => e.state);
  return {
    ideaId,
    questions: questions.count ?? 0,
    claims: claims.count ?? 0,
    verifiedClaims: verified.count ?? 0,
    weakClaims: weak.count ?? 0,
    competitors: competitors.count ?? 0,
    hasAlternatives: (alternatives.count ?? 0) > 0,
    sizingEstablished: (sizing.data ?? []).some((f) => f.claims && ["verified", "estimate"].includes(f.claims.status)),
    assumptions: assumptions.length,
    topAssumption: assumptions[0] ? { statement: assumptions[0].statement, evidence: assumptions[0].evidence } : null,
    experimentsDraft: states.filter((s) => ["draft", "ready_for_review", "approved"].includes(s)).length,
    experimentsLive: states.filter((s) => s === "live" || s === "paused").length,
    experimentsEnded: states.filter((s) => ["ended", "analyzed", "decided"].includes(s)).length,
    learningCardsDraft: (cards.data ?? []).filter((c) => c.status === "draft").length,
    learningCardsApproved: (cards.data ?? []).filter((c) => c.status === "approved").length,
    decisions: decisions.count ?? 0,
    behaviourObservations: behaviour.count ?? 0,
  };
});
