import "server-only";
import { withoutProposals } from "@/lib/domain/competitor-proposals";
import { decisive } from "@/lib/domain/customer-research";
import { PROPOSAL_REFERENCE_PREFIX } from "@/lib/domain/reference-proposal";
import { supabaseServer } from "@/lib/supabase/server";
import { loadAssumptions, rankAssumptions } from "@/lib/progress";
import { experimentMetrics } from "@/lib/experiment-metrics";
import { breakEvenRevenue, computeSizing, computeUnitEconomics, factorConsistency, SCENARIO_LABELS, simulateSizing, type ScenarioKind, type SizingModel } from "@/lib/domain/sizing";
import { explainContribution } from "@/lib/domain/evidence";
import { dossierLabel, type LadderObservation } from "@/lib/domain/dossier-label";
import type { DossierFacts } from "@/lib/domain/reality-check";
import { ASSUMPTION_STATUS, CLAIM_STATUS, EXPERIMENT_STATES, type AssumptionStatus, type ClaimStatus, type ExperimentState } from "@/lib/domain/labels";
import { AI_CODE_LABELS } from "@/lib/domain/ai-text";
import type { Idea } from "@/lib/data";
import { loadIdeaWeights } from "@/lib/learning-data";
import { asMethodVersion, METHODS } from "@/lib/domain/method";
import { loadCalibration, loadIdeaCaps } from "@/lib/method-data";
import { countsAsEvidence, realInterviewIds, withPracticeFlag } from "@/lib/domain/practice";

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
      supabase.from("sizing_scenarios").select("*, sizing_factors(*, claims(status, statement, numeric_value))").eq("idea_id", id),
      supabase.from("unit_economics").select("*").eq("idea_id", id).maybeSingle(),
      supabase.from("experiments").select("*, hypotheses(*, assumptions(statement, category))").eq("idea_id", id).order("created_at"),
      supabase.from("interviews").select("id, experiment_id, dmu_role, is_acquaintance, consent_recorded, record_type, recruited_via, is_practice").eq("idea_id", id),
      // Clients get the same rows without literal interview quotes (enforced in the database).
      supabase.rpc("observations_for_idea", { p_idea: id }),
      supabase.from("learning_cards").select("*").eq("idea_id", id).order("created_at"),
      supabase.from("reality_checks").select("*").eq("idea_id", id).order("created_at", { ascending: false }).limit(1),
      supabase.from("decisions").select("*").eq("idea_id", id).order("decided_at"),
      supabase.from("idea_members").select("email, role, user_id").eq("idea_id", id),
      idea.client_id ? supabase.from("clients").select("name").eq("id", idea.client_id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("research_runs").select("mode, status, cost_usd, created_at").eq("idea_id", id),
      supabase.from("ai_runs").select("purpose, model, prompt_version, cost_usd, outcome, created_at").eq("idea_id", id),
    ]);

  const assumptions = rankAssumptions(await loadAssumptions(id));
  // B0: waarnemingen uit een oefengesprek of een nog niet aangegeven gesprek tellen als synthetisch (is_practice
  // houdt de reden zichtbaar), zodat ze nergens als bewijs meetellen: niet in de Reality Check, de coach of het rapport.
  const realIds = realInterviewIds(interviews.data ?? []);
  const observationList = (observations.data ?? []).map((o) => withPracticeFlag(o, realIds));
  // Which evidence factors those probabilities used (default or learned), for the report.
  const weights = (await loadIdeaWeights(id)).inUse;
  // The method version of this dossier, with its rules and (2026-11-b) the caps per evidence level.
  const version = asMethodVersion(idea.method_version);
  const caps = await loadIdeaCaps(id);
  // Genoeg opgeloste dossiers in de werkruimte om kansen exact te tonen? Anders in banden (golf A, punt 3).
  const calibration = await loadCalibration(id);
  const method = { version, label: METHODS[version].label, rules: METHODS[version].rules, caps: METHODS[version].usesCaps ? caps.caps : null, capsCustom: caps.custom };
  const expList = experiments.data ?? [];
  // Verkennend klantonderzoek (zonder drempel) krijgt geen oordeel: het beslist niets.
  const metrics = await Promise.all(expList.map((e) => {
    const h = decisive(e.hypotheses);
    return h ? experimentMetrics(e, h, version) : null;
  }));

  const sizing = (scenarios.data ?? [])
    .map((s) => {
      const factors = (s.sizing_factors ?? []).sort((a, b) => a.position - b.position);
      const result = computeSizing(
        s.model as SizingModel,
        factors.map((f) => ({
          key: f.key,
          value: Number(f.value),
          claimStatus: (f.claims?.status as ClaimStatus) ?? null,
          claimValue: f.claims?.numeric_value == null ? null : Number(f.claims.numeric_value),
        })),
      );
      return {
        kind: s.kind as ScenarioKind,
        label: SCENARIO_LABELS[s.kind as ScenarioKind].label,
        model: s.model,
        factors: factors.map((f) => ({ label: f.label, value: Number(f.value), unit: f.unit, source: f.claims?.statement ?? null, status: f.claims?.status ?? null, year: f.year, region: f.region })),
        result,
        // Golf C, punt 8: passen jaar en regio van de factoren bij elkaar?
        consistency: factorConsistency(factors.map((f) => ({ key: f.key, label: f.label, year: f.year, region: f.region }))),
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

  // Research 3.8: Monte Carlo summary per scenario that has at least one factor with a 90% range.
  const breakEven = ue.data ? breakEvenRevenue({ grossMarginPct: ue.data.gross_margin_pct, fixedCostsYear: ue.data.fixed_costs_year }) : null;
  const simulations = (scenarios.data ?? [])
    .map((s) => {
      const sim = simulateSizing(
        s.model as SizingModel,
        (s.sizing_factors ?? []).map((f) => ({
          key: f.key,
          value: Number(f.value),
          low: f.low_value == null ? null : Number(f.low_value),
          high: f.high_value == null ? null : Number(f.high_value),
        })),
        { threshold: breakEven, widen: factorConsistency((s.sizing_factors ?? []).map((f) => ({ key: f.key, year: f.year, region: f.region }))).widen },
      );
      return sim ? { kind: s.kind as ScenarioKind, label: SCENARIO_LABELS[s.kind as ScenarioKind].label, thresholdIsBreakEven: breakEven != null, ...sim } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  // Research 3.5: estimated probability per assumption, with band and largest contributions.
  const probabilities = assumptions.map((a) => ({
    id: a.id,
    statement: a.statement,
    importance: a.importance,
    origin: a.origin,
    prior: a.probability.prior,
    probability: a.probability.probability,
    band: a.probability.band,
    capReason: a.probability.cap?.active ? a.probability.cap.reason : null,
    merged: (a.probability.merged ?? []).map((m) => ({ label: m.label, signals: m.signals, ...(m.direction ? { direction: m.direction } : {}) })),
    // Methode 2026-11-c: wervingsgroepen waaruit meer dan één bron kwam.
    recruitment: a.probability.recruitment ?? [],
    top: a.probability.top.map((c) => ({ label: c.label, direction: c.direction, count: c.count, lr: c.lr, weight: c.weight, explanation: explainContribution(c) })),
  }));

  // Prediction loop and customer signals. Forecasts follow the blind rule: the snapshot holds the forecasts
  // the person making the report can see.
  const stopped = idea.outcome_question === "stop_review";
  const [forecastsRes, outcomeRes, checkinsRes, refRes, signalsRes, stopRes] = await Promise.all([
    supabase.from("forecasts").select("moment, forecaster_kind, probability, rationale, model, created_at").eq("idea_id", id).order("created_at"),
    // "*": de inzetkolommen (golf B) ontbreken in oudere databases.
    supabase.from("idea_outcomes").select("*").eq("idea_id", id).maybeSingle(),
    supabase.from("outcome_checkins").select("on_track, current_value, note, created_at").eq("idea_id", id).order("created_at"),
    idea.reference_class?.startsWith(PROPOSAL_REFERENCE_PREFIX)
      ? supabase
          .from("reference_proposals")
          .select("label, source_title, source_url, quote")
          .eq("id", idea.reference_class.slice(PROPOSAL_REFERENCE_PREFIX.length))
          .maybeSingle()
          .then((r) => ({ data: r.data ? { label: r.data.label, source_title: r.data.source_title, source_url: r.data.source_url, caveat: `Door AI voorgesteld; citaat letterlijk teruggevonden: "${r.data.quote}"` } : null }))
      : idea.reference_class && !idea.reference_class.startsWith("own:") && idea.reference_class !== "none"
      ? supabase.from("reference_classes").select("label, source_title, source_url, caveat").eq("id", idea.reference_class).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("customer_signals").select("kind, label, mentions").eq("idea_id", id).order("mentions", { ascending: false }).limit(12),
    stopped ? supabase.from("stop_reviews").select("justified, evidence, reviewed_at").eq("idea_id", id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const prediction = {
    outcome: {
      statement: idea.outcome_statement ?? null,
      metric: idea.outcome_metric ?? null,
      target: idea.outcome_target ?? null,
      due: idea.outcome_due ?? null,
    },
    baseRate: {
      low: idea.base_rate_low ?? null,
      high: idea.base_rate_high ?? null,
      note: idea.base_rate_note ?? null,
      reference: refRes.data ?? null,
      own: idea.reference_class?.startsWith("own:") ?? false,
    },
    forecasts: forecastsRes.data ?? [],
    result: outcomeRes.data ?? null,
    checkins: checkinsRes.data ?? [],
    // Golf B, punt 1: na een stop of pauze de stopvraag in plaats van de uitkomstvraag.
    question: stopped ? ("stop_review" as const) : ("success" as const),
    stopReview: stopRes.data ?? null,
  };
  const signals = signalsRes.data ?? [];

  const approvedCards = (cards.data ?? []).filter((c) => c.status === "approved");
  const label = dossierLabel({
    claims: (claims.data ?? []).map((c) => ({ status: c.status, domain: c.claim_sources?.[0]?.sources?.domain ?? null, sourceType: c.claim_sources?.[0]?.sources?.source_type ?? null })),
    competitorKinds: withoutProposals(competitors.data ?? []).map((c) => c.kind),
    sizingComputed: sizing.some((s) => s.result.tamCount > 0),
    behaviourCards: approvedCards
      .map((c) => {
        const e = expList.find((x) => x.id === c.experiment_id);
        // Interviews and surveys are what people say, not observed behaviour.
        if (!e || e.type === "interview" || e.type === "survey") return null;
        return { verdict: c.verdict, channels: ((e.channels as { channel: string }[]) ?? []).map((x) => x.channel), endedOn: e.ended_at };
      })
      .filter((x): x is { verdict: string; channels: string[]; endedOn: string | null } => !!x),
  });

  return {
    idea,
    clientName: client.data?.name ?? null,
    questions: questions.data ?? [],
    claims: claims.data ?? [],
    // Gebruikerstest D6: voorstellen (zonder bron) tellen nergens mee: niet in rapport, Reality Check of AI-samenvatting.
    competitors: withoutProposals(competitors.data ?? []),
    segments: segments.data ?? [],
    sizing,
    unitEconomics: ue.data,
    unit,
    assumptions,
    experiments: expList.map((e, i) => ({ ...e, metrics: metrics[i] })),
    interviews: interviews.data ?? [],
    observations: observationList,
    learningCards: cards.data ?? [],
    realityCheck: checks.data?.[0] ?? null,
    decisions: decisions.data ?? [],
    members: members.data ?? [],
    research: { runs: runs.data ?? [], ai: ai.data ?? [] },
    label,
    probabilities,
    weights,
    method,
    calibration,
    simulation: simulations.find((s) => s.kind === "realistic") ?? simulations[0] ?? null,
    simulations,
    prediction,
    signals,
  };
}

export type Dossier = Awaited<ReturnType<typeof loadDossier>>;

// Een waarneming zoals de bewijsladder (lib/domain/dossier-label.ts) haar per persoon telt.
export function ladderObservation(o: Dossier["observations"][number]): LadderObservation {
  return {
    interviewId: o.interview_id,
    kind: o.kind,
    isSynthetic: o.is_synthetic,
    dims: { isFact: o.is_fact, isBehaviour: o.is_behaviour, isRealContext: o.is_real_context, isCostly: o.is_costly },
  };
}

export function factsFrom(d: Dossier): DossierFacts {
  const lastApproved = d.learningCards.filter((c) => c.status === "approved").map((c) => c.approved_at ?? c.created_at).sort().pop();
  const realistic = d.sizing.find((s) => s.kind === "realistic") ?? d.sizing[0];
  return {
    ideaAgeDays: Math.floor((Date.now() - new Date(d.idea.created_at).getTime()) / 86_400_000),
    clientDeciderInvited: d.members.some((m) => m.role === "client_decider"),
    ideaRegion: d.idea.region,
    claims: d.claims.map((c) => ({
      status: c.status as ClaimStatus,
      section: c.section,
      region: c.region,
      // Gebruikerstest D13: alleen bevestigende gecontroleerde bronnen; een tegensprekende bron van een weerlegde
      // bevinding is geen onafhankelijke marktbron voor het idee.
      sourceTypes: (c.claim_sources ?? []).filter((s) => s.quote_check === "exact" && s.stance !== "contradicts").map((s) => s.sources?.source_type ?? "other"),
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
    assumptions: d.assumptions.map((a) => ({ statement: a.statement, importance: a.importance, category: a.category, status: a.status, evidence: a.evidence, contradicting: a.contradicting, origin: a.origin })),
    premortemDone: d.assumptions.some((a) => a.origin === "premortem"),
    experiments: d.experiments.map((e) => ({
      type: e.type as "landing" | "interview" | "pricing" | "survey",
      state: e.state,
      assumptionCategory: e.hypotheses?.assumptions?.category ?? "desirability",
      verdict: e.metrics ? e.metrics.verdict.kind : null,
      n: e.metrics?.n ?? 0,
      minSample: e.hypotheses?.min_sample ?? 0,
      endedEarly: e.ended_early,
      channels: ((e.channels as { channel: string }[]) ?? []).map((c) => c.channel),
    })),
    // B0: alleen echte gesprekken tellen mee; oefeningen en niet-aangegeven gesprekken niet.
    interviews: d.interviews.filter((i) => countsAsEvidence(i.is_practice)).map((i) => ({ dmuRole: i.dmu_role, isAcquaintance: i.is_acquaintance, consent: i.consent_recorded })),
    // Fase B0, punt 1: met interview en dimensies, zodat de Reality Check per persoon telt.
    observations: d.observations.map((o) => ({
      kind: o.kind,
      interviewId: o.interview_id,
      isFact: o.is_fact,
      isBehaviour: o.is_behaviour,
      isRealContext: o.is_real_context,
      isSynthetic: o.is_synthetic,
      isCostly: o.is_costly,
    })),
    learningCards: d.learningCards.map((c) => ({ status: c.status as "draft" | "approved", verdict: c.verdict as "pass" | "fail" | "inconclusive" })),
    decisionsAfterLastLearning: lastApproved ? d.decisions.filter((x) => x.decided_at > lastApproved).length : d.decisions.length,
    isB2B: /zakelijk|b2b|organisatie|bedrijf|publieke/i.test(d.idea.target_audience) || d.idea.project_type === "internal_innovation",
  };
}

export function dossierSummaryForAi(d: Dossier): string {
  // Gebruikerstest D10: overal Nederlandse labels en bewijs als percentage, nooit ruwe codes. De AI krijgt de opdracht
  // geen interne codes te noemen; de uitvoer gaat daarna nog door sanitizeAiText (lib/domain/ai-text.ts).
  const claimLabel = (s: string) => (s in CLAIM_STATUS ? CLAIM_STATUS[s as ClaimStatus].label : "onbekende status");
  const assumptionLabel = (s: string) => (s in ASSUMPTION_STATUS ? ASSUMPTION_STATUS[s as AssumptionStatus].label.toLowerCase() : "onbekende status");
  const stateLabel = (s: string) => (s in EXPERIMENT_STATES ? EXPERIMENT_STATES[s as ExperimentState].label.toLowerCase() : "onbekende status");
  const verdictLabel = (v: string) => AI_CODE_LABELS[v] ?? "onbeslist";
  return [
    `Beslisvraag: ${d.idea.decision_question}`,
    "Bevindingen:",
    ...d.claims.slice(0, 40).map((c) => `- [${claimLabel(c.status)}] ${c.statement}`),
    "Aannames (belang 1–5, bewijs in procenten, status):",
    ...d.assumptions.map((a) => `- (belang ${a.importance}, bewijs ${Math.round(a.evidence * 100)}%, ${assumptionLabel(a.status)}) ${a.statement}`),
    "Experimenten:",
    ...d.experiments.map(
      (e) =>
        `- ${e.title} (${stateLabel(e.state)})${e.type === "survey" ? " (enquête: zelfrapportage, geen waargenomen gedrag)" : ""}${e.metrics ? ` ${e.metrics.successes} van ${e.metrics.n}, oordeel: ${verdictLabel(e.metrics.verdict.kind)}` : ""}`,
    ),
    "Learning Cards:",
    ...d.learningCards.map((c) => `- (${c.status === "approved" ? "goedgekeurd" : "concept"}, ${verdictLabel(c.verdict)}) ${c.we_learned}`),
    "Schrijf in gewone Nederlandse taal en noem geen interne codes (zoals statuscodes in het Engels); gebruik de namen hierboven.",
  ].join("\n");
}
