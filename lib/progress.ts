import "server-only";
import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { assumptionEvidence, type AssumptionProbability, type ObservationDims } from "@/lib/domain/evidence";
import { METHODS, type MethodVersion } from "@/lib/domain/method";
import { ideaMethodVersion, loadIdeaCaps, loadSourceRefs } from "@/lib/method-data";
import type { AssumptionCategory, ClaimStatus } from "@/lib/domain/labels";
import { rankByInformationValue, type VoiResult } from "@/lib/domain/recommend";
import type { IdeaProgress } from "@/lib/domain/coach";
import { getUser } from "@/lib/data";
import { FORECAST_MOMENTS, type ForecastMoment, type ForecastState } from "@/lib/domain/forecast";
import { todayInNL } from "@/lib/domain/sprint";
import { loadIdeaWeights } from "@/lib/learning-data";

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
  // Estimated probability that the assumption holds (research 3.5), from the stored starting value (default 50%).
  probability: AssumptionProbability;
};

type ObsLink = {
  assumption_id: string;
  observation_id?: string;
  relation: string;
  observations: {
    is_fact: boolean;
    is_behaviour: boolean;
    is_real_context: boolean;
    is_costly: boolean;
    is_synthetic: boolean;
    kind: string;
    origin: string;
    review_status?: string | null;
  } | null;
};

// Observations come through observations_for_idea, so a client scores with the same evidence as the
// consultant (raw observations are consultant-only; the function leaves out the literal quote). Older
// databases without that function fall back to the direct embed.
async function loadObservationLinks(ideaId: string): Promise<ObsLink[]> {
  const supabase = await supabaseServer();
  const [links, obs] = await Promise.all([
    supabase.from("assumption_observations").select("assumption_id, relation, observation_id").eq("idea_id", ideaId),
    supabase.rpc("observations_for_idea", { p_idea: ideaId }),
  ]);
  if (!links.error && !obs.error) {
    const byId = new Map((obs.data ?? []).map((o) => [o.id, o]));
    return (links.data ?? []).map((l) => {
      const o = byId.get(l.observation_id);
      return {
        assumption_id: l.assumption_id,
        observation_id: l.observation_id,
        relation: l.relation,
        observations: o
          ? { is_fact: o.is_fact, is_behaviour: o.is_behaviour, is_real_context: o.is_real_context, is_costly: o.is_costly, is_synthetic: o.is_synthetic, kind: o.kind, origin: o.origin, review_status: o.review_status ?? null }
          : null,
      };
    });
  }
  const full = await supabase
    .from("assumption_observations")
    .select("assumption_id, observation_id, relation, observations(is_fact, is_behaviour, is_real_context, is_costly, is_synthetic, kind, origin, review_status)")
    .eq("idea_id", ideaId);
  if (!full.error) return full.data ?? [];
  const plain = await supabase
    .from("assumption_observations")
    .select("assumption_id, observation_id, relation, observations(is_fact, is_behaviour, is_real_context, is_costly, is_synthetic, kind, origin)")
    .eq("idea_id", ideaId);
  return plain.data ?? [];
}

// Everything the probabilities of one idea are computed from, loaded once: assumptions, linked claims and
// observations, evidence factors (default or learned), the source of every signal and the caps (method 2026-11-b).
export const loadAssumptionInputs = cache(async (ideaId: string) => {
  const supabase = await supabaseServer();
  const [{ data: assumptions }, { data: links }, obsLinks, weights, refs, caps, method] = await Promise.all([
    supabase.from("assumptions").select("*").eq("idea_id", ideaId).order("created_at"),
    supabase.from("assumption_claims").select("assumption_id, claim_id, relation, claims(status)").eq("idea_id", ideaId),
    loadObservationLinks(ideaId),
    // Default factors unless the organisation switched learned weights on (lib/domain/calibration.ts).
    loadIdeaWeights(ideaId),
    loadSourceRefs(ideaId),
    loadIdeaCaps(ideaId),
    ideaMethodVersion(ideaId),
  ]);
  return { assumptions: assumptions ?? [], links: links ?? [], obsLinks: obsLinks ?? [], weights, refs, caps, method };
});
export type AssumptionInputs = Awaited<ReturnType<typeof loadAssumptionInputs>>;

// Computes the evidence axis and the probability of every assumption with the calculation module of a method
// version (lib/domain/method): the dossier's own version, or another one for the comparison before a switch.
export function computeAssumptions(inputs: AssumptionInputs, version: MethodVersion): AssumptionWithEvidence[] {
  const method = METHODS[version];
  const { links, obsLinks, weights, refs, caps } = inputs;
  return inputs.assumptions.map((a) => {
    const claims = links
      .filter((l) => l.assumption_id === a.id && l.claims)
      .map((l) => {
        const ref = refs.get(`claim:${l.claim_id}`);
        return { status: l.claims!.status as ClaimStatus, relation: l.relation as "supports" | "contradicts", sourceKey: ref?.key ?? null, sourceLabel: ref?.label ?? null };
      });
    const observations = obsLinks
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
    const probability = method.probability(
      claims,
      obsLinks
        .filter((l) => l.assumption_id === a.id && l.observations)
        .map((l) => {
          const ref = l.observation_id ? refs.get(`observation:${l.observation_id}`) : undefined;
          return {
            kind: l.observations!.kind,
            relation: l.relation as "supports" | "contradicts",
            isSynthetic: l.observations!.is_synthetic,
            origin: l.observations!.origin,
            reviewStatus: l.observations!.review_status ?? null,
            sourceKey: ref?.key ?? null,
            sourceLabel: ref?.label ?? null,
          };
        }),
      a.prior == null ? 0.5 : Number(a.prior),
      weights.overrides,
      caps.caps,
    );
    return {
      probability,
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
}

// Computes the evidence axis and the probability of every assumption from linked claims and observations,
// with the method version of the dossier.
export const loadAssumptions = cache(async (ideaId: string): Promise<AssumptionWithEvidence[]> => {
  const inputs = await loadAssumptionInputs(ideaId);
  return computeAssumptions(inputs, inputs.method);
});

// Risk priority: most important first, then least evidence.
export function rankAssumptions(list: AssumptionWithEvidence[]): AssumptionWithEvidence[] {
  return [...list].sort((a, b) => b.importance * (1 - b.evidence) - a.importance * (1 - a.evidence));
}

export type AssumptionWithVoi = AssumptionWithEvidence & { voi: VoiResult };

// Research 3.9: assumptions in order of information value (what to test next and why).
export const loadInformationValue = cache(async (ideaId: string): Promise<AssumptionWithVoi[]> => {
  const supabase = await supabaseServer();
  const [list, { count: interviewObs }] = await Promise.all([
    loadAssumptions(ideaId),
    supabase.from("observations").select("id", { count: "exact", head: true }).eq("idea_id", ideaId).not("interview_id", "is", null),
  ]);
  return orderByInformationValue(list, (interviewObs ?? 0) > 0);
});

export function orderByInformationValue(list: AssumptionWithEvidence[], hasDiscoveryEvidence: boolean): AssumptionWithVoi[] {
  const ranked = rankByInformationValue(
    list.map((a) => ({
      id: a.id,
      statement: a.statement,
      importance: a.importance,
      probability: a.probability.probability,
      category: a.category as AssumptionCategory,
      evidence: a.evidence,
      hasDiscoveryEvidence,
    })),
  );
  return ranked.map((voi) => ({ ...list.find((a) => a.id === voi.id)!, voi }));
}

// Reports: the sharing columns arrive with the integrity migration; fall back when they are missing.
async function loadReportMeta(ideaId: string): Promise<{ created_at: string; shared_at: string | null }[]> {
  const supabase = await supabaseServer();
  const withShare = await supabase.from("reports").select("created_at, shared_at").eq("idea_id", ideaId).order("version", { ascending: false });
  if (!withShare.error) return withShare.data ?? [];
  const plain = await supabase.from("reports").select("created_at").eq("idea_id", ideaId).order("version", { ascending: false });
  return (plain.data ?? []).map((r) => ({ created_at: r.created_at, shared_at: null }));
}

// The prediction loop of one idea for the current user. Undefined when the prediction schema is missing
// (older databases), so the rest of the app keeps working without it.
export const loadForecastState = cache(async (ideaId: string): Promise<ForecastState | undefined> => {
  const supabase = await supabaseServer();
  const user = await getUser();
  const [idea, own, checkins, outcome] = await Promise.all([
    supabase.from("ideas").select("outcome_statement, outcome_due, outcome_clock_start, reference_class").eq("id", ideaId).maybeSingle(),
    user
      ? supabase.from("forecasts").select("moment").eq("idea_id", ideaId).eq("forecaster_id", user.id)
      : Promise.resolve({ data: [] as { moment: string }[], error: null }),
    supabase.from("outcome_checkins").select("id", { count: "exact", head: true }).eq("idea_id", ideaId),
    supabase.from("idea_outcomes").select("idea_id").eq("idea_id", ideaId).maybeSingle(),
  ]);
  if (idea.error || own.error || checkins.error || outcome.error || !idea.data) return undefined;
  return {
    outcomeDefined: !!idea.data.outcome_statement,
    baseRateChosen: !!idea.data.reference_class,
    outcomeDue: idea.data.outcome_due,
    clockStart: idea.data.outcome_clock_start,
    ownMoments: (own.data ?? []).map((f) => f.moment).filter((m): m is ForecastMoment => (FORECAST_MOMENTS as readonly string[]).includes(m)),
    checkins: checkins.count ?? 0,
    resolved: !!outcome.data,
    today: todayInNL(),
  };
});

const maxIso = (list: (string | null | undefined)[]) => list.filter((x): x is string => !!x).sort().pop() ?? null;

export const loadProgress = cache(async (ideaId: string): Promise<IdeaProgress> => {
  const supabase = await supabaseServer();
  const count = { count: "exact" as const, head: true };
  const forecastState = loadForecastState(ideaId);
  const [questions, claims, verified, weak, competitors, alternatives, segments, experiments, cards, checks, decisions, behaviour, sizing, reports] = await Promise.all([
    supabase.from("research_questions").select("id", count).eq("idea_id", ideaId),
    supabase.from("claims").select("id", count).eq("idea_id", ideaId),
    supabase.from("claims").select("id", count).eq("idea_id", ideaId).eq("status", "verified"),
    supabase.from("claims").select("id", count).eq("idea_id", ideaId).eq("status", "insufficient"),
    supabase.from("competitors").select("id", count).eq("idea_id", ideaId),
    supabase.from("competitors").select("id", count).eq("idea_id", ideaId).in("kind", ["alternative", "status_quo"]),
    supabase.from("segments").select("id", count).eq("idea_id", ideaId),
    supabase.from("experiments").select("id, title, state, started_at, ends_at, created_at").eq("idea_id", ideaId).order("created_at"),
    supabase.from("learning_cards").select("experiment_id, status, approved_at").eq("idea_id", ideaId),
    supabase.from("reality_checks").select("created_at").eq("idea_id", ideaId).order("created_at", { ascending: false }).limit(1),
    supabase.from("decisions").select("decided_at, client_confirmed_at").eq("idea_id", ideaId).order("decided_at", { ascending: false }),
    supabase.from("observations").select("id", count).eq("idea_id", ideaId).eq("is_behaviour", true).eq("is_synthetic", false),
    supabase.from("sizing_factors").select("key, claims(status)").eq("idea_id", ideaId).eq("key", "base_count"),
    loadReportMeta(ideaId),
  ]);
  const forecast = await forecastState;
  const assumptions = rankAssumptions(await loadAssumptions(ideaId));
  const cardList = cards.data ?? [];
  const approvedCards = cardList.filter((c) => c.status === "approved");
  const expList = (experiments.data ?? []).map((e) => ({
    id: e.id,
    title: e.title,
    state: e.state,
    startedAt: e.started_at,
    endsAt: e.ends_at,
    hasApprovedCard: approvedCards.some((c) => c.experiment_id === e.id),
  }));
  const states = expList.map((e) => e.state);
  const decisionList = decisions.data ?? [];
  const top = assumptions.find((a) => a.status !== "supported" && a.status !== "refuted") ?? assumptions[0];
  return {
    ideaId,
    questions: questions.count ?? 0,
    claims: claims.count ?? 0,
    verifiedClaims: verified.count ?? 0,
    weakClaims: weak.count ?? 0,
    competitors: competitors.count ?? 0,
    hasAlternatives: (alternatives.count ?? 0) > 0,
    segments: segments.count ?? 0,
    sizingEstablished: (sizing.data ?? []).some((f) => f.claims && ["verified", "estimate"].includes(f.claims.status)),
    assumptions: assumptions.length,
    assumptionsWithoutEvidence: assumptions.filter((a) => a.evidence === 0).length,
    untestedCritical: assumptions.filter((a) => a.importance >= 4 && a.status === "untested").length,
    topAssumption: top ? { id: top.id, statement: top.statement, evidence: top.evidence } : null,
    experiments: expList,
    experimentsDraft: states.filter((s) => ["draft", "ready_for_review", "approved"].includes(s)).length,
    experimentsLive: states.filter((s) => s === "live" || s === "paused").length,
    experimentsEnded: states.filter((s) => ["ended", "analyzed", "decided"].includes(s)).length,
    learningCardsDraft: cardList.filter((c) => c.status === "draft").length,
    learningCardsApproved: approvedCards.length,
    latestCardApprovedAt: maxIso(approvedCards.map((c) => c.approved_at)),
    latestRealityCheckAt: checks.data?.[0]?.created_at ?? null,
    decisions: decisionList.length,
    latestDecisionAt: decisionList[0]?.decided_at ?? null,
    latestDecisionConfirmed: !!decisionList[0]?.client_confirmed_at,
    reports: reports.length,
    latestReportAt: reports[0]?.created_at ?? null,
    latestReportShared: !!reports[0]?.shared_at,
    behaviourObservations: behaviour.count ?? 0,
    forecast,
  };
});
