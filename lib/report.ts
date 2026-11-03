import "server-only";
import type { Dossier } from "@/lib/dossier";
import { CLAIM_STATUS, COMPETITOR_KINDS, DECISIONS, EVIDENCE_TYPES, EXPERIMENT_TYPES, SOURCE_TYPES, type ClaimStatus, type CompetitorKind, type DecisionAction, type EvidenceType, type ExperimentType, type SourceType } from "@/lib/domain/labels";
import type { Finding } from "@/lib/domain/reality-check";
import { ACHIEVED_LABELS, FORECAST_MOMENTS, FORECASTER_LABELS, JUSTIFIED_LABELS, MOMENT_LABELS, ON_TRACK_LABELS, aggregate, aiAsOneVote, brier, type Achieved, type ForecasterKind, type Justified, type OnTrack } from "@/lib/domain/forecast";
import { ensembleMean } from "@/lib/ai/providers/select";
import { effortSummary } from "@/lib/domain/effort";
import { deviationLabel, type RuleEvaluation } from "@/lib/domain/decision-rule";
import { PROVIDER_LABELS, providerOfModel } from "@/lib/ai/providers/config";

// "AI · Gemini" for an AI forecast whose provider is known; null otherwise.
function aiName(kind: string, model: string | null): string | null {
  const p = kind === "ai" ? providerOfModel(model) : null;
  return p ? `AI · ${PROVIDER_LABELS[p].name}` : null;
}

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
    assumptions: d.assumptions.map((a) => {
      const p = d.probabilities.find((x) => x.id === a.id);
      return {
        statement: a.statement,
        importance: a.importance,
        evidence: Math.round(a.evidence * 100),
        status: a.status,
        premortem: a.origin === "premortem",
        probability: p ? { point: p.probability, low: p.band.low, high: p.band.high, prior: p.prior } : null,
        // Methode 2026-11-b: plafond en samengevoegde signalen.
        capReason: p?.capReason ?? null,
        merged: p?.merged ?? [],
      };
    }),
    // Default or learned evidence factors (lib/domain/calibration.ts), so every probability can be reproduced.
    weights: d.weights,
    // Methodeversie, beslisregels en gebruikte plafonds: elke kans en elk oordeel is daarmee te reproduceren.
    methodology: {
      version: d.method.version,
      label: d.method.label,
      rules: d.method.rules,
      caps: d.method.caps,
      capsCustom: d.method.capsCustom,
    },
    simulation: d.simulation
      ? { label: d.simulation.label, draws: d.simulation.draws, somCount: d.simulation.somCount, somRevenue: d.simulation.somRevenue, threshold: d.simulation.threshold, pAboveThreshold: d.simulation.pAboveThreshold, thresholdIsBreakEven: d.simulation.thresholdIsBreakEven, mainDriver: d.simulation.drivers[0]?.key ?? null }
      : null,
    signals: d.signals.map((s) => ({ kind: s.kind, label: s.label, mentions: s.mentions })),
    prediction: {
      outcome: d.prediction.outcome,
      baseRate: d.prediction.baseRate,
      // Blind rule: before the outcome is known a report (also a shared one) only says how many forecasts
      // exist per moment; probabilities and reasons appear once the outcome is recorded.
      revealed: d.prediction.result != null || d.prediction.stopReview != null,
      moments: FORECAST_MOMENTS.map((m) => {
        const rows = d.prediction.forecasts.filter((f) => f.moment === m);
        if (d.prediction.result == null && d.prediction.stopReview == null) {
          return { moment: MOMENT_LABELS[m].label, count: rows.length, people: null, ai: null, forecasts: [] as { who: string; probability: number; rationale: string; brier: number | null }[] };
        }
        const people = rows.filter((f) => f.forecaster_kind !== "ai").map((f) => Number(f.probability));
        const ai = ensembleMean(rows.filter((f) => f.forecaster_kind === "ai").map((f) => Number(f.probability)));
        return {
          moment: MOMENT_LABELS[m].label,
          count: rows.length,
          people: aggregate(people),
          ai,
          // Golf B, punt 15: de AI telt als één stem, het gemiddelde van de modellen (ook in de Brier-score).
          forecasts: aiAsOneVote(rows.map((f) => ({ ...f, kind: f.forecaster_kind as ForecasterKind, probability: Number(f.probability) }))).map((v) => ({
            who: v.kind === "ai" ? (v.models > 1 ? `AI (gemiddelde van ${v.models} modellen)` : (aiName("ai", v.rows[0].model) ?? "AI")) : FORECASTER_LABELS[v.kind],
            probability: v.probability,
            rationale: v.kind === "ai" ? v.rows.map((r) => r.rationale).join(" / ") : v.rows[0].rationale,
            // Bij een gestopt dossier wordt een voorspelling niet gescoord als slagingskans.
            brier: d.prediction.result && d.prediction.question === "success" ? brier(v.probability, d.prediction.result.achieved as Achieved) : null,
          })),
        };
      }).filter((m) => m.count > 0),
      checkins: d.prediction.checkins.map((c) => ({ at: c.created_at, onTrack: ON_TRACK_LABELS[c.on_track as OnTrack], value: c.current_value, note: c.note })),
      result: d.prediction.result
        ? {
            achieved: ACHIEVED_LABELS[d.prediction.result.achieved as Achieved],
            value: d.prediction.result.actual_value,
            evidence: d.prediction.result.evidence,
            at: d.prediction.result.resolved_at,
            // Golf B, punt 2: de inzet bij de uitkomst.
            effort: d.prediction.result.started == null ? null : effortSummary({
              started: d.prediction.result.started ?? null,
              hours: d.prediction.result.effort_hours == null ? null : Number(d.prediction.result.effort_hours),
              budgetPctOfPlan: d.prediction.result.budget_pct_of_plan == null ? null : Number(d.prediction.result.budget_pct_of_plan),
            }),
            insufficient: d.prediction.result.execution_insufficient === true,
          }
        : null,
      // Na een stop of pauze: "Was stoppen achteraf terecht?" (null bij de succesvraag en in oudere rapporten).
      stop:
        d.prediction.question === "stop_review"
          ? {
              review: d.prediction.stopReview
                ? { justified: JUSTIFIED_LABELS[d.prediction.stopReview.justified as Justified], evidence: d.prediction.stopReview.evidence, at: d.prediction.stopReview.reviewed_at }
                : null,
            }
          : null,
    },
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
        rule: e.metrics?.verdict.rule ?? null,
        label: e.metrics?.verdict.label ?? null,
        probability: e.metrics?.verdict.probability ?? null,
        successCount: e.metrics?.verdict.successCount ?? null,
        requiredN: e.hypotheses?.required_n ?? null,
        byChannel: e.metrics?.byChannel ?? [],
        byVariant: e.metrics?.byVariant ?? [],
        warnings: e.metrics?.warnings ?? [],
        endedEarly: e.ended_early,
        // Surveys are self-reported: what people say about themselves, never observed behaviour.
        selfReported: e.type === "survey",
        bySource: e.metrics?.survey
          ? { invitation: { n: e.metrics.survey.invitation.n, successes: e.metrics.survey.invitation.successes }, openLink: { n: e.metrics.survey.openLink.n, successes: e.metrics.survey.openLink.successes } }
          : null,
      })),
    learningCards: d.learningCards.filter((c) => c.status === "approved").map((c) => ({ believed: c.we_believed, observed: c.we_observed, learned: c.we_learned, therefore: c.therefore, verdict: c.verdict, reliability: c.data_reliability })),
    realityCheck: check ? { at: check.created_at, advice: DECISIONS[check.advice as DecisionAction].label, reason: check.advice_reason, findings: checkFindings, aiUsed: check.ai_used } : null,
    decision: lastDecision
      ? {
          action: DECISIONS[lastDecision.action as DecisionAction].label,
          rationale: lastDecision.rationale,
          nextStep: lastDecision.next_step,
          at: lastDecision.decided_at,
          confirmedAt: lastDecision.client_confirmed_at,
          comment: lastDecision.client_comment,
          // Golf B, punt 6: de toets aan de beslisregel en, bij afwijken, de motivering.
          rule: ruleSummary(lastDecision),
          // Golf B, punt 18: bevestigd na de samenvatting "Wat ging tegen".
          reviewedAgainst: lastDecision.reviewed_against_summary != null,
          // Golf B, punt 20: de verlengde testfase (aantal weken), als dit besluit er een is of erop volgde.
          extendWeeks: d.decisions.find((x) => x.action === "extend")?.extend_weeks ?? null,
        }
      : null,
    sources: [...sources.values()].sort((a, b) => a.n - b.n),
    method: {
      aiCalls: d.research.ai.length,
      aiCostUsd: Number(aiCost.toFixed(2)),
      models: [...new Set(d.research.ai.map((r) => `${r.model} (prompt ${r.prompt_version})`))],
    },
  };
}

// De toets aan de beslisregel bij een besluit, leesbaar voor het rapport (null zonder regel of bij een tussenbesluit).
function ruleSummary(d: { action: string; rule_met?: boolean | null; rule_evaluation?: unknown; rule_deviation_reason?: string | null }) {
  if (d.rule_met == null) return null;
  const ev = d.rule_evaluation as RuleEvaluation | null;
  const lines = [
    ...(ev?.conditions ?? []).map((c) => `${c.statement}: ${c.probability != null ? `${Math.round(c.probability * 100)}%` : "onbekend"} (minstens ${Math.round(c.minProbability * 100)}%) · ${c.met ? "gehaald" : "niet gehaald"}`),
    ...(ev?.primary ? [`Hoofdtest ${ev.primary.title}: ${ev.primary.met ? "geslaagd" : "niet geslaagd"}`] : []),
  ];
  return {
    met: d.rule_met,
    lines,
    deviation: d.rule_deviation_reason ? { label: deviationLabel(d.action, d.rule_met), reason: d.rule_deviation_reason } : null,
  };
}
