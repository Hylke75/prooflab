import "server-only";
import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { assumptionEvidence, deskTally, type AssumptionProbability, type ObservationDims } from "@/lib/domain/evidence";
import { METHODS, type MethodVersion } from "@/lib/domain/method";
import { dedupeByPerson } from "@/lib/domain/per-person";
import { excludedTests, experimentFromSourceKey, isStarted, testOutcomesFrom, withoutExcludedTests, type TestExclusion } from "@/lib/domain/test-counts";
import { ideaMethodVersion, loadIdeaCaps, loadSourceRefs } from "@/lib/method-data";
import type { AssumptionCategory, ClaimStatus } from "@/lib/domain/labels";
import { rankByInformationValue, type VoiResult } from "@/lib/domain/recommend";
import { assumptionKind } from "@/lib/domain/assumption-kind";
import { pickDecisiveQuestion, relatesToDecisive, type QuestionRow } from "@/lib/domain/decisive-question";
import type { IdeaProgress } from "@/lib/domain/coach";
import { getUser } from "@/lib/data";
import { testsWithVerdict } from "@/lib/domain/dossier-status";
import { FORECAST_MOMENTS, type ForecastMoment, type ForecastState } from "@/lib/domain/forecast";
import { todayInNL } from "@/lib/domain/sprint";
import { loadIdeaWeights } from "@/lib/learning-data";
import { withPracticeFlag } from "@/lib/domain/practice";
import { loadRealInterviewIds, realObservationFilter } from "@/lib/practice-data";
import { decisionConfirmation, decisionSettled } from "@/lib/domain/decision-confirmation";
import { isExploratory } from "@/lib/domain/customer-research";
import { loadDecisionRule } from "@/lib/decision-rule-data";

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
  // Golf A, punt 5: onderbouwing van de startkans en of die vergrendeld is (er hangt bewijs aan de aanname).
  priorRationale: string | null;
  priorLocked: boolean;
  // Golf A, punt 11: de vooraf aangewezen hoofdtest (experiment-id) of null.
  primaryExperimentId: string | null;
  // Fase B0: vastgelegde soort (markt, prijs, gedrag, technisch) of null; zie lib/domain/assumption-kind.ts.
  kind?: string | null;
  // Fase B0, punt 4: gestarte tests van deze aanname die niet meetellen in kans en rangorde, met de reden.
  excludedTests: TestExclusion[];
  // Fase B4: door de consultant gekozen om nu te testen (maximaal 3 per idee); de rest staat op "later".
  selectedForTest?: boolean;
  // Gebruikerstest A2: gekoppelde bevindingen die (nog) niet meetellen in bewijsas en kans, met de reden.
  deskNotCounted?: { claimId: string; reason: string }[];
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
    interview_id?: string | null;
    experiment_id?: string | null;
  } | null;
};

// Observations come through observations_for_idea, so a client scores with the same evidence as the
// consultant (raw observations are consultant-only; the function leaves out the literal quote). Older
// databases without that function fall back to the direct embed.
// B0: waarnemingen uit een interview dat niet als echt gesprek is aangegeven (oefening of onbekend) tellen als
// synthetisch, dus nergens als bewijs.
async function loadObservationLinks(ideaId: string): Promise<ObsLink[]> {
  const realIds = await loadRealInterviewIds(ideaId);
  const practice = (rows: ObsLink[]): ObsLink[] =>
    rows.map((l) => (l.observations ? { ...l, observations: withPracticeFlag({ ...l.observations, interview_id: l.observations.interview_id ?? null }, realIds) } : l));
  const supabase = await supabaseServer();
  const [links, obs] = await Promise.all([
    supabase.from("assumption_observations").select("assumption_id, relation, observation_id").eq("idea_id", ideaId),
    supabase.rpc("observations_for_idea", { p_idea: ideaId }),
  ]);
  if (!links.error && !obs.error) {
    const byId = new Map((obs.data ?? []).map((o) => [o.id, withPracticeFlag(o, realIds)]));
    return (links.data ?? []).map((l) => {
      const o = byId.get(l.observation_id);
      return {
        assumption_id: l.assumption_id,
        observation_id: l.observation_id,
        relation: l.relation,
        observations: o
          ? {
              is_fact: o.is_fact,
              is_behaviour: o.is_behaviour,
              is_real_context: o.is_real_context,
              is_costly: o.is_costly,
              is_synthetic: o.is_synthetic,
              kind: o.kind,
              origin: o.origin,
              review_status: o.review_status ?? null,
              interview_id: o.interview_id,
              experiment_id: o.experiment_id,
            }
          : null,
      };
    });
  }
  const full = await supabase
    .from("assumption_observations")
    .select("assumption_id, observation_id, relation, observations(is_fact, is_behaviour, is_real_context, is_costly, is_synthetic, kind, origin, review_status, interview_id, experiment_id)")
    .eq("idea_id", ideaId);
  if (!full.error) return practice(full.data ?? []);
  const plain = await supabase
    .from("assumption_observations")
    .select("assumption_id, observation_id, relation, observations(is_fact, is_behaviour, is_real_context, is_costly, is_synthetic, kind, origin, interview_id, experiment_id)")
    .eq("idea_id", ideaId);
  return practice(plain.data ?? []);
}

// Everything the probabilities of one idea are computed from, loaded once: assumptions, linked claims and
// observations, evidence factors (default or learned), the source of every signal and the caps (method 2026-11-b).
export const loadAssumptionInputs = cache(async (ideaId: string) => {
  const supabase = await supabaseServer();
  const [{ data: assumptions }, { data: links }, obsLinks, weights, refs, caps, method, { data: experiments }, { data: cards }, { data: interviewObs }] = await Promise.all([
    supabase.from("assumptions").select("*").eq("idea_id", ideaId).order("created_at"),
    // claims.relevance (golf C): indirect bewijs telt half in methode 2026-11-c. Opdrachtgevers lezen claims via
    // dezelfde RLS (can_read_idea), dus ze rekenen met dezelfde weging.
    supabase.from("assumption_claims").select("assumption_id, claim_id, relation, claims(status, relevance)").eq("idea_id", ideaId),
    loadObservationLinks(ideaId),
    // Default factors unless the organisation switched learned weights on (lib/domain/calibration.ts).
    loadIdeaWeights(ideaId),
    loadSourceRefs(ideaId),
    loadIdeaCaps(ideaId),
    ideaMethodVersion(ideaId),
    // Fase B0, punt 4: uitkomst en n per test, om onbesliste tests en tests onder de steekproef niet mee te tellen.
    // Experimenten, hypotheses, Learning Cards en observaties (zonder citaat) zijn ook voor opdrachtgevers leesbaar.
    supabase.from("experiments").select("id, title, type, state, hypotheses(assumption_id, min_sample)").eq("idea_id", ideaId),
    supabase.from("learning_cards").select("experiment_id, status, verdict, metrics").eq("idea_id", ideaId),
    supabase.from("observations").select("experiment_id, interview_id, is_synthetic").eq("idea_id", ideaId).not("interview_id", "is", null),
  ]);
  // B0 punt 2: waarnemingen uit oefengesprekken of nog niet aangegeven gesprekken tellen ook niet als deelnemer of
  // ontdekkingsbewijs.
  const realIds = await loadRealInterviewIds(ideaId);
  const realInterviewObs = (interviewObs ?? []).filter((o) => o.interview_id && realIds.has(o.interview_id));
  return {
    assumptions: assumptions ?? [],
    links: links ?? [],
    obsLinks: obsLinks ?? [],
    weights,
    refs,
    caps,
    method,
    tests: testOutcomesFrom(experiments ?? [], cards ?? [], realInterviewObs),
    interviewObs: realInterviewObs,
  };
});
export type AssumptionInputs = Awaited<ReturnType<typeof loadAssumptionInputs>>;

const obsDims = (o: NonNullable<ObsLink["observations"]>): ObservationDims => ({
  isFact: o.is_fact,
  isBehaviour: o.is_behaviour,
  isRealContext: o.is_real_context,
  isCostly: o.is_costly,
  isSynthetic: o.is_synthetic,
});

// Computes the evidence axis and the probability of every assumption with the calculation module of a method
// version (lib/domain/method): the dossier's own version, or another one for the comparison before a switch.
export function computeAssumptions(inputs: AssumptionInputs, version: MethodVersion): AssumptionWithEvidence[] {
  const method = METHODS[version];
  const { links, weights, refs, caps } = inputs;
  // Fase B0, punt 4: waarnemingen (en enquêtebevindingen) uit een onbesliste test of een test onder de minimale
  // steekproef blijven bestaan, maar tellen niet mee in de bewijsas, de kans en dus de rangorde.
  const excluded = excludedTests(inputs.tests);
  const obsLinks = withoutExcludedTests(inputs.obsLinks, (l) => l.observations?.experiment_id, excluded);
  return inputs.assumptions.map((a) => {
    const claims = withoutExcludedTests(
      links.filter((l) => l.assumption_id === a.id && l.claims),
      (l) => experimentFromSourceKey(refs.get(`claim:${l.claim_id}`)?.key),
      excluded,
    )
      .map((l) => {
        const ref = refs.get(`claim:${l.claim_id}`);
        return {
          claimId: l.claim_id,
          status: l.claims!.status as ClaimStatus,
          relation: l.relation as "supports" | "contradicts",
          sourceKey: ref?.key ?? null,
          sourceLabel: ref?.label ?? null,
          recruitmentGroup: ref?.recruitment ?? null,
          relevance: l.claims!.relevance ?? null,
        };
      });
    // Bewijsas en aantallen per persoon (fase B0, punt 1): één interview levert per bewijsniveau en richting maximaal
    // één waarneming. De kans zelf voegt per bron samen in de rekenmodule van de methode.
    const observations = dedupeByPerson(
      obsLinks.filter((l) => l.assumption_id === a.id && l.observations),
      (l) => ({ interviewId: l.observations!.interview_id, kind: l.observations!.kind, relation: l.relation, dims: obsDims(l.observations!) }),
    ).map((l) => ({ ...obsDims(l.observations!), relation: l.relation as "supports" | "contradicts" }));
    // Gebruikerstest A2/A5: welke gekoppelde bevindingen meetellen, volgt de methodeversie (weerlegd telt vanaf 2026-11-e).
    const deskOpts = { refutedCounts: method.refutedCounts };
    const e = assumptionEvidence(claims, observations, deskOpts);
    const desk = deskTally(claims, deskOpts);
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
            recruitmentGroup: ref?.recruitment ?? null,
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
      priorRationale: a.prior_rationale ?? null,
      priorLocked: !!a.prior_locked_at,
      primaryExperimentId: a.primary_experiment_id ?? null,
      kind: a.kind ?? null,
      // Fase B4: de kolom bestaat pas na migratie 20261110100000; zonder kolom is niets gekozen.
      selectedForTest: a.selected_for_test === true,
      deskNotCounted: desk.notCounted.map((c) => ({ claimId: c.claimId, reason: c.reasonText })),
      excludedTests: inputs.tests
        .filter((t) => t.assumptionId === a.id && isStarted(t.state))
        .map((t) => excluded.get(t.experimentId))
        .filter((x): x is TestExclusion => !!x),
    };
  });
}

// Er is kwalitatief bewijs uit interviews (voor de informatiewaarde), zonder interviews uit tests die niet meetellen.
export function hasDiscoveryEvidence(inputs: Pick<AssumptionInputs, "tests" | "interviewObs">): boolean {
  const excluded = excludedTests(inputs.tests);
  return inputs.interviewObs.some((o) => !o.experiment_id || !excluded.has(o.experiment_id));
}

// Per test waarom hij niet meetelt in kans en rangorde (voor de testpagina).
export const loadTestExclusions = cache(async (ideaId: string): Promise<Map<string, TestExclusion>> => excludedTests((await loadAssumptionInputs(ideaId)).tests));

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
  // B0: alleen waarnemingen uit echte gesprekken (zie loadAssumptionInputs) en uit tests die meetellen.
  const [list, inputs] = await Promise.all([loadAssumptions(ideaId), loadAssumptionInputs(ideaId)]);
  const decisive = await loadDecisiveRelation(ideaId, list);
  return orderByInformationValue(list, hasDiscoveryEvidence(inputs), decisive.assumptionIds);
});

// Fase B4: de beslissende vraag (B2: is_decisive; anders de eerste onderzoeksvraag; zonder vragen de beslisvraag
// van het idee) en de aannames die hem direct raken: via een gekoppelde bevinding van die vraag of tekstoverlap.
export const loadDecisiveRelation = cache(
  async (ideaId: string, list: Pick<AssumptionWithEvidence, "id" | "statement">[]): Promise<{ question: string | null; assumptionIds: Set<string> }> => {
    const supabase = await supabaseServer();
    // select("*"): is_decisive komt mee zodra B2 de kolom toevoegt, zonder dat deze query daarop wacht.
    const [{ data: questions }, { data: links }, { data: idea }] = await Promise.all([
      supabase.from("research_questions").select("*").eq("idea_id", ideaId),
      supabase.from("assumption_claims").select("assumption_id, claims(question_id)").eq("idea_id", ideaId),
      supabase.from("ideas").select("decision_question").eq("id", ideaId).maybeSingle(),
    ]);
    const q = pickDecisiveQuestion((questions ?? []) as unknown as QuestionRow[]);
    const question = q ? { id: q.id, text: q.question } : idea?.decision_question ? { id: null, text: idea.decision_question } : null;
    const linked = new Map<string, string[]>();
    for (const l of links ?? []) linked.set(l.assumption_id, [...(linked.get(l.assumption_id) ?? []), l.claims?.question_id ?? ""]);
    const ids = new Set(list.filter((a) => relatesToDecisive(a.statement, question, linked.get(a.id) ?? [])).map((a) => a.id));
    return { question: question?.text ?? null, assumptionIds: ids };
  },
);

export function orderByInformationValue(list: AssumptionWithEvidence[], hasDiscoveryEvidence: boolean, decisiveIds?: ReadonlySet<string>): AssumptionWithVoi[] {
  const ranked = rankByInformationValue(
    list.map((a) => ({
      id: a.id,
      statement: a.statement,
      importance: a.importance,
      probability: a.probability.probability,
      category: a.category as AssumptionCategory,
      evidence: a.evidence,
      hasDiscoveryEvidence,
      kind: assumptionKind(a),
      decisive: decisiveIds?.has(a.id) ?? false,
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
  const [idea, own, checkins, outcome, question, stopReview] = await Promise.all([
    supabase.from("ideas").select("outcome_statement, outcome_due, outcome_clock_start, reference_class").eq("id", ideaId).maybeSingle(),
    user
      ? supabase.from("forecasts").select("moment").eq("idea_id", ideaId).eq("forecaster_id", user.id)
      : Promise.resolve({ data: [] as { moment: string }[], error: null }),
    supabase.from("outcome_checkins").select("id", { count: "exact", head: true }).eq("idea_id", ideaId),
    supabase.from("idea_outcomes").select("idea_id").eq("idea_id", ideaId).maybeSingle(),
    // Golf B: los opgevraagd, zodat een database zonder deze kolom en tabel gewoon de succesvraag houdt.
    supabase.from("ideas").select("outcome_question").eq("id", ideaId).maybeSingle(),
    supabase.from("stop_reviews").select("idea_id").eq("idea_id", ideaId).maybeSingle(),
  ]);
  if (idea.error || own.error || checkins.error || outcome.error || !idea.data) return undefined;
  const stopped = !question.error && question.data?.outcome_question === "stop_review";
  return {
    outcomeDefined: !!idea.data.outcome_statement,
    baseRateChosen: !!idea.data.reference_class,
    outcomeDue: idea.data.outcome_due,
    clockStart: idea.data.outcome_clock_start,
    ownMoments: (own.data ?? []).map((f) => f.moment).filter((m): m is ForecastMoment => (FORECAST_MOMENTS as readonly string[]).includes(m)),
    checkins: checkins.count ?? 0,
    resolved: stopped ? !stopReview.error && !!stopReview.data : !!outcome.data,
    question: stopped ? "stop_review" : "success",
    today: todayInNL(),
  };
});

// Onderzoeksvragen met de markering van de beslissende vraag (fase B2). Staat de migratie nog niet live, dan zonder.
async function loadQuestionsWithDecisive(supabase: Awaited<ReturnType<typeof supabaseServer>>, ideaId: string) {
  type Q = { id: string; status: string; position: number; is_decisive?: boolean };
  const full = await supabase.from("research_questions").select("id, status, position, is_decisive").eq("idea_id", ideaId).order("position").order("created_at");
  if (!full.error) return (full.data ?? []) as Q[];
  const plain = await supabase.from("research_questions").select("id, status, position").eq("idea_id", ideaId).order("position").order("created_at");
  return (plain.data ?? []) as Q[];
}

const maxIso = (list: (string | null | undefined)[]) => list.filter((x): x is string => !!x).sort().pop() ?? null;

export const loadProgress = cache(async (ideaId: string): Promise<IdeaProgress> => {
  const supabase = await supabaseServer();
  const count = { count: "exact" as const, head: true };
  // Gebruikerstest A10: onafhankelijke ladingen starten meteen en lopen parallel (geen waterval).
  const forecastState = loadForecastState(ideaId);
  const assumptionList = loadAssumptions(ideaId);
  const decisionRule = loadDecisionRule(ideaId);
  // B0: waarnemingen uit oefen- of niet-aangegeven gesprekken tellen niet mee.
  const realObs = realObservationFilter(await loadRealInterviewIds(ideaId));
  const [questions, claims, verified, weak, competitors, alternatives, segments, experiments, cards, checks, decisions, behaviour, sizing, reports, ideaRow] = await Promise.all([
    loadQuestionsWithDecisive(supabase, ideaId),
    supabase.from("claims").select("id", count).eq("idea_id", ideaId),
    supabase.from("claims").select("id", count).eq("idea_id", ideaId).eq("status", "verified"),
    supabase.from("claims").select("id", count).eq("idea_id", ideaId).eq("status", "insufficient"),
    // Gebruikerstest D6: voorstellen (origin 'proposal', zonder bron) tellen niet mee.
    supabase.from("competitors").select("id", count).eq("idea_id", ideaId).neq("origin", "proposal"),
    supabase.from("competitors").select("id", count).eq("idea_id", ideaId).neq("origin", "proposal").in("kind", ["alternative", "status_quo"]),
    supabase.from("segments").select("id", count).eq("idea_id", ideaId),
    supabase.from("experiments").select("id, title, state, started_at, ends_at, created_at, hypotheses(assumption_id, success_threshold_pct)").eq("idea_id", ideaId).order("created_at"),
    supabase.from("learning_cards").select("experiment_id, status, approved_at, verdict").eq("idea_id", ideaId),
    supabase.from("reality_checks").select("created_at").eq("idea_id", ideaId).order("created_at", { ascending: false }).limit(1),
    supabase.from("decisions").select("action, decided_at, client_confirmed_at").eq("idea_id", ideaId).order("decided_at", { ascending: false }),
    supabase.from("observations").select("id", count).eq("idea_id", ideaId).eq("is_behaviour", true).eq("is_synthetic", false).or(realObs),
    supabase.from("sizing_factors").select("key, claims(status)").eq("idea_id", ideaId).eq("key", "base_count"),
    loadReportMeta(ideaId),
    // B1: zonder opdrachtgever wacht een besluit niet op bevestiging.
    supabase.from("ideas").select("client_id").eq("id", ideaId).maybeSingle(),
  ]);
  // B1c/B2: de beslissende vraag (is_decisive; zonder markering of vóór de B2-migratie de eerste vraag) en echte
  // waarnemingen uit tests.
  const questionList = questions;
  const decisive = questionList.find((q) => q.is_decisive === true) ?? questionList[0] ?? null;
  const [decisiveVerified, realTestObs] = await Promise.all([
    decisive
      ? supabase.from("claims").select("id", count).eq("idea_id", ideaId).eq("question_id", decisive.id).eq("status", "verified")
      : Promise.resolve({ count: 0 }),
    supabase.from("observations").select("id", count).eq("idea_id", ideaId).eq("is_synthetic", false).not("experiment_id", "is", null).or(realObs),
  ]);
  const [forecast, rawAssumptions, rule] = await Promise.all([forecastState, assumptionList, decisionRule]);
  const assumptions = rankAssumptions(rawAssumptions);
  const cardList = cards.data ?? [];
  const approvedCards = cardList.filter((c) => c.status === "approved");
  // Verkennend klantonderzoek vanuit Markt telt niet als test: het krijgt geen Learning Card en beslist niets.
  const expList = (experiments.data ?? []).filter((e) => !isExploratory(e.hypotheses)).map((e) => ({
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
    questions: questionList.length,
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
    latestDecisionAction: decisionList[0]?.action ?? null,
    // B1: zonder opdrachtgever is het besluit direct definitief (afgeleid; client_confirmed_at blijft leeg).
    latestDecisionConfirmed: decisionSettled(decisionConfirmation(decisionList[0]?.client_confirmed_at, !!ideaRow.data?.client_id, decisionList[0]?.action)),
    reports: reports.length,
    latestReportAt: reports[0]?.created_at ?? null,
    latestReportShared: !!reports[0]?.shared_at,
    behaviourObservations: behaviour.count ?? 0,
    dossier: {
      questions: questionList.length,
      claims: claims.count ?? 0,
      verifiedClaims: verified.count ?? 0,
      decisiveQuestion: decisive ? { status: decisive.status, verifiedClaims: decisiveVerified.count ?? 0 } : null,
      assumptions: assumptions.length,
      criticalWithPrimaryTest: assumptions.filter((a) => a.importance >= 4 && a.primaryExperimentId).length,
      assumptionsWithEvidence: assumptions.filter((a) => a.evidence > 0).length,
      experiments: expList.length,
      experimentsLive: states.filter((s) => s === "live" || s === "paused").length,
      experimentsEnded: states.filter((s) => ["ended", "analyzed", "decided"].includes(s)).length,
      // B1: alleen een afgeronde test met uitslag geslaagd of niet geslaagd (onbeslist telt niet).
      testsWithVerdict: testsWithVerdict(expList, cardList),
      realTestObservations: realTestObs.count ?? 0,
      decisions: decisionList.length,
      latestDecisionAction: decisionList[0]?.action ?? null,
      // Gebruikerstest A6: zonder vastgelegde beslisregel is stap Aannames niet klaar.
      decisionRule: rule === undefined ? "unknown" : rule ? "saved" : "missing",
    },
    forecast,
  };
});
