import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { loadAssumptions, rankAssumptions } from "@/lib/progress";
import { experimentMetrics } from "@/lib/experiment-metrics";
import { computeSizing, computeUnitEconomics, SCENARIO_LABELS, type ScenarioKind, type SizingModel } from "@/lib/domain/sizing";
import { dossierLabel } from "@/lib/domain/dossier-label";
import type { DossierFacts } from "@/lib/domain/reality-check";
import type { ClaimStatus } from "@/lib/domain/labels";
import type { Idea } from "@/lib/data";

// Collects everything about one idea in a single pass. Used by the Reality Check and as the
// immutable snapshot behind every report version.
export async function loadDossier(idea: Idea) {
  const supabase = await supabaseServer();
  const id = idea.id;
  const [questions, claims, competitors, segments, scenarios, ue, experiments, interviews, observations, cards, checks, decisions, members, client, runs, ai] =
    await Promise.all([
      supabase.from("research_questions").select("*").eq("idea_id", id).order("position"),
      supabase
        .from("claims")
        .select("*, claim_sources(quote, stance, quote_check, sources(id, title, url, publisher, published_on, retrieved_at, source_type, domain, is_primary))")
        .eq("idea_id", id)
        .order("created_at"),
      supabase.from("competitors").select("*").eq("idea_id", id).order("kind"),
      supabase.from("segments").select("*").eq("idea_id", id),
      supabase.from("sizing_scenarios").select("*, sizing_factors(*, claims(status, statement))").eq("idea_id", id),
      supabase.from("unit_economics").select("*").eq("idea_id", id).maybeSingle(),
      supabase.from("experiments").select("*, hypotheses(*, assumptions(statement, category))").eq("idea_id", id).order("created_at"),
      supabase.from("interviews").select("id, experiment_id, dmu_role, is_acquaintance, consent_recorded, record_type, recruited_via").eq("idea_id", id),
      supabase.from("observations").select("*").eq("idea_id", id),
      supabase.from("learning_cards").select("*").eq("idea_id", id).order("created_at"),
      supabase.from("reality_checks").select("*").eq("idea_id", id).order("created_at", { ascending: false }).limit(1),
      supabase.from("decisions").select("*").eq("idea_id", id).order("decided_at"),
      supabase.from("idea_members").select("email, role, user_id").eq("idea_id", id),
      idea.client_id ? supabase.from("clients").select("name").eq("id", idea.client_id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("research_runs").select("mode, status, cost_usd, created_at").eq("idea_id", id),
      supabase.from("ai_runs").select("purpose, model, prompt_version, cost_usd, outcome, created_at").eq("idea_id", id),
    ]);

  const assumptions = rankAssumptions(await loadAssumptions(id));
  const expList = experiments.data ?? [];
  const metrics = await Promise.all(expList.map((e) => (e.hypotheses ? experimentMetrics(e, e.hypotheses) : null)));

  const sizing = (scenarios.data ?? [])
    .map((s) => {
      const factors = (s.sizing_factors ?? []).sort((a, b) => a.position - b.position);
      const result = computeSizing(
        s.model as SizingModel,
        factors.map((f) => ({ key: f.key, value: Number(f.value), claimStatus: (f.claims?.status as ClaimStatus) ?? null })),
      );
      return {
        kind: s.kind as ScenarioKind,
        label: SCENARIO_LABELS[s.kind as ScenarioKind].label,
        model: s.model,
        factors: factors.map((f) => ({ label: f.label, value: Number(f.value), unit: f.unit, source: f.claims?.statement ?? null, status: f.claims?.status ?? null })),
        result,
      };
    })
    .sort((a, b) => ["conservative", "realistic", "optimistic"].indexOf(a.kind) - ["conservative", "realistic", "optimistic"].indexOf(b.kind));

  const unit = ue.data
    ? computeUnitEconomics({
        pricePerCustomerYear: ue.data.price_per_customer_year,
        grossMarginPct: ue.data.gross_margin_pct,
        cacEur: ue.data.cac_eur,
        annualChurnPct: ue.data.annual_churn_pct,
        fixedCostsYear: ue.data.fixed_costs_year,
        upfrontInvestment: ue.data.upfront_investment,
      })
    : null;

  const approvedCards = (cards.data ?? []).filter((c) => c.status === "approved");
  const label = dossierLabel({
    claims: (claims.data ?? []).map((c) => ({ status: c.status, domain: c.claim_sources?.[0]?.sources?.domain ?? null, sourceType: c.claim_sources?.[0]?.sources?.source_type ?? null })),
    competitorKinds: (competitors.data ?? []).map((c) => c.kind),
    sizingComputed: sizing.some((s) => s.result.tamCount > 0),
    behaviourCards: approvedCards
      .map((c) => {
        const e = expList.find((x) => x.id === c.experiment_id);
        if (!e || e.type === "interview") return null;
        return { verdict: c.verdict, channels: ((e.channels as { channel: string }[]) ?? []).map((x) => x.channel), endedOn: e.ended_at };
      })
      .filter((x): x is { verdict: string; channels: string[]; endedOn: string | null } => !!x),
  });

  return {
    idea,
    clientName: client.data?.name ?? null,
    questions: questions.data ?? [],
    claims: claims.data ?? [],
    competitors: competitors.data ?? [],
    segments: segments.data ?? [],
    sizing,
    unitEconomics: ue.data,
    unit,
    assumptions,
    experiments: expList.map((e, i) => ({ ...e, metrics: metrics[i] })),
    interviews: interviews.data ?? [],
    observations: observations.data ?? [],
    learningCards: cards.data ?? [],
    realityCheck: checks.data?.[0] ?? null,
    decisions: decisions.data ?? [],
    members: members.data ?? [],
    research: { runs: runs.data ?? [], ai: ai.data ?? [] },
    label,
  };
}

export type Dossier = Awaited<ReturnType<typeof loadDossier>>;

export function factsFrom(d: Dossier): DossierFacts {
  const lastApproved = d.learningCards.filter((c) => c.status === "approved").map((c) => c.approved_at ?? c.created_at).sort().pop();
  const realistic = d.sizing.find((s) => s.kind === "realistic") ?? d.sizing[0];
  return {
    ideaAgeDays: Math.floor((Date.now() - new Date(d.idea.created_at).getTime()) / 86_400_000),
    clientDeciderInvited: d.members.some((m) => m.role === "client_decider"),
    claims: d.claims.map((c) => ({
      status: c.status as ClaimStatus,
      section: c.section,
      sourceTypes: (c.claim_sources ?? []).filter((s) => s.quote_check === "exact").map((s) => s.sources?.source_type ?? "other"),
    })),
    competitors: d.competitors.map((c) => ({ kind: c.kind })),
    sizing: realistic
      ? {
          established: realistic.result.established,
          assumedFactors: realistic.result.provenance.assumed,
          totalFactors: realistic.result.provenance.total,
          revenueFactorSourced: realistic.factors.some((f) => /omzet|besteding/i.test(f.label) && (f.status === "verified" || f.status === "estimate")),
        }
      : null,
    assumptions: d.assumptions.map((a) => ({ statement: a.statement, importance: a.importance, category: a.category, status: a.status, evidence: a.evidence, contradicting: a.contradicting })),
    experiments: d.experiments.map((e) => ({
      type: e.type as "landing" | "interview" | "pricing",
      state: e.state,
      assumptionCategory: e.hypotheses?.assumptions?.category ?? "desirability",
      verdict: e.metrics ? e.metrics.verdict.kind : null,
      n: e.metrics?.n ?? 0,
      minSample: e.hypotheses?.min_sample ?? 0,
      endedEarly: e.ended_early,
      channels: ((e.channels as { channel: string }[]) ?? []).map((c) => c.channel),
    })),
    interviews: d.interviews.map((i) => ({ dmuRole: i.dmu_role, isAcquaintance: i.is_acquaintance, consent: i.consent_recorded })),
    observations: d.observations.map((o) => ({ kind: o.kind, isBehaviour: o.is_behaviour, isSynthetic: o.is_synthetic, isCostly: o.is_costly })),
    learningCards: d.learningCards.map((c) => ({ status: c.status as "draft" | "approved", verdict: c.verdict as "pass" | "fail" | "inconclusive" })),
    decisionsAfterLastLearning: lastApproved ? d.decisions.filter((x) => x.decided_at > lastApproved).length : d.decisions.length,
    isB2B: /zakelijk|b2b|organisatie|bedrijf|publieke/i.test(d.idea.target_audience) || d.idea.project_type === "internal_innovation",
  };
}

export function dossierSummaryForAi(d: Dossier): string {
  return [
    `Beslisvraag: ${d.idea.decision_question}`,
    "Bevindingen:",
    ...d.claims.slice(0, 40).map((c) => `- [${c.status}] ${c.statement}`),
    "Aannames (belangrijkheid, bewijs 0-1, status):",
    ...d.assumptions.map((a) => `- (${a.importance}, ${a.evidence.toFixed(2)}, ${a.status}) ${a.statement}`),
    "Experimenten:",
    ...d.experiments.map((e) => `- ${e.title} [${e.state}] ${e.metrics ? `${e.metrics.successes}/${e.metrics.n}, oordeel: ${e.metrics.verdict.kind}` : ""}`),
    "Learning Cards:",
    ...d.learningCards.map((c) => `- [${c.status}, ${c.verdict}] ${c.we_learned}`),
  ].join("\n");
}
