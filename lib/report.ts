import "server-only";
import type { Dossier } from "@/lib/dossier";
import { CLAIM_STATUS, COMPETITOR_KINDS, DECISIONS, EVIDENCE_TYPES, EXPERIMENT_TYPES, SOURCE_TYPES, type ClaimStatus, type CompetitorKind, type DecisionAction, type EvidenceType, type ExperimentType, type SourceType } from "@/lib/domain/labels";
import type { Finding } from "@/lib/domain/reality-check";

// A report is an immutable snapshot: re-rendering version N later shows exactly what was
// known at the time, even if the dossier has changed since.
export type ReportSnapshot = ReturnType<typeof buildSnapshot>;

export function buildSnapshot(d: Dossier, meta: { orgName: string; createdBy: string }) {
  const sources = new Map<string, { n: number; title: string; url: string | null; publisher: string | null; published_on: string | null; retrieved_at: string; type: string; primary: boolean }>();
  const footnote = (s: { id: string; title: string; url: string | null; publisher: string | null; published_on: string | null; retrieved_at: string; source_type: string; is_primary: boolean } | null) => {
    if (!s) return null;
    if (!sources.has(s.id)) {
      sources.set(s.id, { n: sources.size + 1, title: s.title, url: s.url, publisher: s.publisher, published_on: s.published_on, retrieved_at: s.retrieved_at, type: SOURCE_TYPES[s.source_type as SourceType] ?? s.source_type, primary: s.is_primary });
    }
    return sources.get(s.id)!.n;
  };

  const claims = d.claims.map((c) => ({
    statement: c.statement,
    section: c.section,
    status: CLAIM_STATUS[c.status as ClaimStatus].label,
    statusKey: c.status,
    type: EVIDENCE_TYPES[c.evidence_type as EvidenceType],
    doesNotProve: c.does_not_prove,
    limitations: c.limitations,
    notes: (c.claim_sources ?? []).filter((s) => s.quote_check === "exact").map((s) => footnote(s.sources)).filter((n): n is number => n !== null),
    contradicted: (c.claim_sources ?? []).some((s) => s.stance === "contradicts" && s.quote_check === "exact"),
  }));

  const check = d.realityCheck;
  const checkFindings = ((check?.findings as { findings?: (Finding & { source?: string })[] } | null)?.findings ?? []).map((f) => ({ title: f.title, detail: f.detail, severity: f.severity, source: f.source ?? "regels" }));
  const lastDecision = d.decisions[d.decisions.length - 1] ?? null;
  const aiCost = d.research.ai.reduce((s, r) => s + Number(r.cost_usd), 0);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    preparedBy: meta.orgName,
    createdBy: meta.createdBy,
    client: d.clientName,
    label: d.label.label,
    labelMissing: d.label.missing,
    idea: {
      title: d.idea.title,
      decisionQuestion: d.idea.decision_question,
      description: d.idea.description,
      audience: [d.idea.target_audience, d.idea.audience_detail].filter(Boolean).join(" — "),
      region: [d.idea.region, d.idea.region_detail].filter(Boolean).join(" — "),
      budget: d.idea.budget_eur,
      keyUncertainty: d.idea.key_uncertainty,
      isDemo: d.idea.is_demo,
    },
    questions: d.questions.map((q) => ({ position: q.position, question: q.question, status: q.status, doneCriterion: q.done_criterion })),
    claims,
    counts: {
      claims: claims.length,
      verified: claims.filter((c) => c.statusKey === "verified").length,
      insufficient: claims.filter((c) => c.statusKey === "insufficient").length,
    },
    competitors: d.competitors.map((c) => ({ name: c.name, kind: COMPETITOR_KINDS[c.kind as CompetitorKind].label, positioning: c.positioning, price: c.visible_price ? `${c.visible_price} (peildatum ${c.price_checked_on ?? "onbekend"})` : "Niet publiek", differentiation: c.differentiation_opportunity })),
    sizing: d.sizing.map((s) => ({
      label: s.label,
      somRevenue: s.result.somRevenue,
      somCount: s.result.somCount,
      samCount: s.result.samCount,
      tamCount: s.result.tamCount,
      formula: s.result.formula,
      provenance: s.result.provenance,
      status: s.result.label,
      factors: s.factors,
    })),
    unit: d.unit,
    assumptions: d.assumptions.map((a) => ({ statement: a.statement, importance: a.importance, evidence: Math.round(a.evidence * 100), status: a.status })),
    experiments: d.experiments
      .filter((e) => !["draft", "ready_for_review"].includes(e.state))
      .map((e) => ({
        title: e.title,
        type: EXPERIMENT_TYPES[e.type as ExperimentType].label,
        state: e.state,
        hypothesis: e.hypotheses?.we_believe ?? "",
        metric: e.hypotheses ? `${e.hypotheses.metric_numerator} / ${e.hypotheses.metric_denominator}` : "",
        threshold: e.hypotheses ? `≥ ${e.hypotheses.success_threshold_pct}% succes${e.hypotheses.fail_threshold_pct != null ? `, < ${e.hypotheses.fail_threshold_pct}% faal` : ""}, n ≥ ${e.hypotheses.min_sample}` : "",
        lockedAt: e.hypotheses?.locked_at ?? null,
        n: e.metrics?.n ?? 0,
        successes: e.metrics?.successes ?? 0,
        interval: e.metrics?.verdict.interval ?? null,
        verdict: e.metrics?.verdict.kind ?? null,
        verdictReason: e.metrics?.verdict.reason ?? "",
        byChannel: e.metrics?.byChannel ?? [],
        byVariant: e.metrics?.byVariant ?? [],
        warnings: e.metrics?.warnings ?? [],
        endedEarly: e.ended_early,
      })),
    learningCards: d.learningCards.filter((c) => c.status === "approved").map((c) => ({ believed: c.we_believed, observed: c.we_observed, learned: c.we_learned, therefore: c.therefore, verdict: c.verdict, reliability: c.data_reliability })),
    realityCheck: check ? { at: check.created_at, advice: DECISIONS[check.advice as DecisionAction].label, reason: check.advice_reason, findings: checkFindings, aiUsed: check.ai_used } : null,
    decision: lastDecision
      ? { action: DECISIONS[lastDecision.action as DecisionAction].label, rationale: lastDecision.rationale, nextStep: lastDecision.next_step, at: lastDecision.decided_at, confirmedAt: lastDecision.client_confirmed_at, comment: lastDecision.client_comment }
      : null,
    sources: [...sources.values()].sort((a, b) => a.n - b.n),
    method: {
      aiCalls: d.research.ai.length,
      aiCostUsd: Number(aiCost.toFixed(2)),
      models: [...new Set(d.research.ai.map((r) => `${r.model} (prompt ${r.prompt_version})`))],
    },
  };
}
