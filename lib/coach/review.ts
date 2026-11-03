import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { getIdea } from "@/lib/data";
import { loadProgress } from "@/lib/progress";
import { dossierSummaryForAi, loadDossier, type Dossier } from "@/lib/dossier";
import { sprintStage } from "@/lib/domain/coach";
import { sprintStatus, todayInNL } from "@/lib/domain/sprint";
import { aiConfigured } from "@/lib/env";
import { runAi } from "@/lib/ai/guard";
import { coachReview } from "@/lib/ai/coach";
import { ideaContext } from "@/lib/idea-context";
import { compareFingerprints, describeChanges, makeFingerprint, type FingerprintData } from "./fingerprint";
import { evaluateRules, planNoteChanges, type CoachFacts, type CoachNoteDraft } from "./rules";
import { validateAiNotes } from "./ai-notes";

// The trajectory coach looks at a dossier again only after a real change (fingerprint), at most once per
// two minutes per dossier, and asks the AI at most three times per dossier per day.
export const REVIEW_INTERVAL_MS = 2 * 60 * 1000;
export const MAX_AI_REVIEWS_PER_DAY = 3;

type Db = Awaited<ReturnType<typeof supabaseServer>>;

export type ReviewResult =
  | { status: "throttled"; waitSeconds: number }
  | { status: "unchanged" }
  | { status: "reviewed"; created: number; closed: number; ai: "ok" | "off" | "limit" | "not_needed" | "failed" };

const maxIso = (list: (string | null | undefined)[]) => list.filter((x): x is string => !!x).sort().pop() ?? null;

// Light queries only: counts and latest timestamps per part of the dossier.
export async function dossierFingerprint(db: Db, ideaId: string, sprintWeek: number | null): Promise<FingerprintData> {
  const id = ideaId;
  const exact = { count: "exact" as const };
  const head = { count: "exact" as const, head: true };
  const [claims, sources, competitors, assumptions, experiments, testEvents, interviews, observations, cards, checks, decisions, forecasts, outcome, checkins, replies, ideaRow, stopReview] =
    await Promise.all([
      db.from("claims").select("updated_at", exact).eq("idea_id", id).order("updated_at", { ascending: false }).limit(1),
      db.from("sources").select("created_at", exact).eq("idea_id", id).order("created_at", { ascending: false }).limit(1),
      db.from("competitors").select("created_at", exact).eq("idea_id", id).order("created_at", { ascending: false }).limit(1),
      db.from("assumptions").select("created_at, status, importance").eq("idea_id", id),
      db.from("experiments").select("created_at, state").eq("idea_id", id),
      db.from("test_events").select("id", head).eq("idea_id", id),
      db.from("interviews").select("id", head).eq("idea_id", id),
      db.from("observations").select("created_at", exact).eq("idea_id", id).order("created_at", { ascending: false }).limit(1),
      db.from("learning_cards").select("status, approved_at, created_at").eq("idea_id", id),
      db.from("reality_checks").select("created_at", exact).eq("idea_id", id).order("created_at", { ascending: false }).limit(1),
      db.from("decisions").select("decided_at, client_confirmed_at").eq("idea_id", id),
      db.from("forecasts").select("id", head).eq("idea_id", id),
      db.from("idea_outcomes").select("idea_id", head).eq("idea_id", id),
      db.from("outcome_checkins").select("id", head).eq("idea_id", id),
      db.from("outreach_events").select("received_at", exact).eq("idea_id", id).eq("event_type", "reply").order("received_at", { ascending: false }).limit(1),
      // Uitkomstdefinitie en basispercentage: daarop reageren de regels outcome_undefined en forecast_missing.
      db.from("ideas").select("outcome_statement, reference_class").eq("id", id).maybeSingle(),
      // Het antwoord op de stopvraag (golf B) telt als vastgelegde uitkomst; zonder tabel is het er niet.
      db.from("stop_reviews").select("idea_id", head).eq("idea_id", id),
    ]);
  const tally = (rows: { [k: string]: unknown }[] | null, key: string) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(String(r[key]), (m.get(String(r[key])) ?? 0) + 1);
    return [...m.entries()].sort().map(([k, v]) => `${k}:${v}`).join(",");
  };
  const cardRows = cards.data ?? [];
  const decisionRows = decisions.data ?? [];
  return {
    claims: claims.count ?? 0,
    claims_at: claims.data?.[0]?.updated_at ?? null,
    sources: sources.count ?? 0,
    sources_at: sources.data?.[0]?.created_at ?? null,
    competitors: competitors.count ?? 0,
    competitors_at: competitors.data?.[0]?.created_at ?? null,
    assumptions: assumptions.data?.length ?? 0,
    assumptions_at: maxIso((assumptions.data ?? []).map((a) => a.created_at)),
    assumption_states: tally(assumptions.data, "status") + "|" + tally(assumptions.data, "importance"),
    experiments: experiments.data?.length ?? 0,
    experiments_at: maxIso((experiments.data ?? []).map((e) => e.created_at)),
    experiment_states: tally(experiments.data, "state"),
    test_events: testEvents.count ?? 0,
    interviews: interviews.count ?? 0,
    observations: observations.count ?? 0,
    observations_at: observations.data?.[0]?.created_at ?? null,
    learning_cards: cardRows.length,
    learning_cards_approved: cardRows.filter((c) => c.status === "approved").length,
    reality_checks: checks.count ?? 0,
    reality_checks_at: checks.data?.[0]?.created_at ?? null,
    decisions: decisionRows.length,
    decisions_at: maxIso(decisionRows.map((d) => d.decided_at)),
    decisions_confirmed: decisionRows.filter((d) => d.client_confirmed_at).length,
    forecasts: forecasts.count ?? 0,
    outcome: (outcome.count ?? 0) > 0 || (!stopReview.error && (stopReview.count ?? 0) > 0),
    checkins: checkins.count ?? 0,
    outreach_replies: replies.count ?? 0,
    outreach_replies_at: replies.data?.[0]?.received_at ?? null,
    sprint_week: sprintWeek,
    outcome_defined: !!ideaRow.data?.outcome_statement,
    base_rate_chosen: !!ideaRow.data?.reference_class,
  };
}

// Everything the rules need, from the full dossier plus the prediction and signal tables.
async function loadFacts(db: Db, d: Dossier, sprint: CoachFacts["sprint"], today: string): Promise<CoachFacts> {
  const id = d.idea.id;
  const stopped = d.idea.outcome_question === "stop_review";
  const [sources, forecasts, outcome, checkins, replies, imports, orgResolved, stopReview, rule] = await Promise.all([
    db.from("sources").select("source_type").eq("idea_id", id),
    // Row level security returns only the forecasts this consultant may see (blind rule).
    db.from("forecasts").select("moment, forecaster_kind, probability").eq("idea_id", id),
    db.from("idea_outcomes").select("idea_id").eq("idea_id", id).maybeSingle(),
    db.from("outcome_checkins").select("created_at").eq("idea_id", id),
    db.from("outreach_events").select("received_at", { count: "exact" }).eq("idea_id", id).eq("event_type", "reply").order("received_at", { ascending: false }).limit(1),
    db.from("sources").select("created_at").eq("idea_id", id).eq("source_type", "outreach").order("created_at", { ascending: false }).limit(1),
    db.rpc("own_base_rate", { p_org: d.idea.org_id, p_project_type: null, p_min: 0 }),
    stopped ? db.from("stop_reviews").select("idea_id").eq("idea_id", id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("decision_rules").select("locked_at").eq("idea_id", id).maybeSingle(),
  ]);
  const idea = d.idea;
  return {
    ideaId: id,
    today,
    now: Date.now(),
    sprint,
    claims: d.claims.map((c) => ({
      id: c.id,
      statement: c.statement,
      exactSources: (c.claim_sources ?? [])
        .filter((s) => s.quote_check === "exact" && s.stance === "supports" && s.sources)
        .map((s) => ({ sourceType: s.sources!.source_type, isPrimary: s.sources!.is_primary })),
    })),
    competitorKinds: d.competitors.map((c) => c.kind),
    sourceTypes: (sources.data ?? []).map((s) => s.source_type),
    assumptions: d.assumptions.map((a) => ({ id: a.id, statement: a.statement, importance: a.importance, status: a.status })),
    experiments: d.experiments.map((e) => {
      const h = e.hypotheses;
      const guide = (e.config as { guide?: unknown } | null)?.guide;
      return {
        id: e.id,
        title: e.title,
        type: e.type,
        state: e.state,
        startedAt: e.started_at,
        endsAt: e.ends_at,
        n: e.metrics?.n ?? 0,
        minSample: h?.min_sample ?? 0,
        locked: !!h?.locked_at,
        successThresholdPct: h?.success_threshold_pct ?? null,
        failThresholdPct: h?.fail_threshold_pct ?? null,
        guide: Array.isArray(guide) ? guide.filter((g): g is string => typeof g === "string") : [],
        assumptionId: h?.assumption_id ?? null,
      };
    }),
    interviews: d.interviews.map((i) => ({ isAcquaintance: i.is_acquaintance })),
    observations: d.observations.map((o) => ({ kind: o.kind, isBehaviour: o.is_behaviour, isSynthetic: o.is_synthetic, createdAt: o.created_at, interviewId: o.interview_id })),
    learningCards: d.learningCards.map((c) => ({ id: c.id, status: c.status, approvedAt: c.approved_at })),
    realityCheck: d.realityCheck ? { id: d.realityCheck.id, createdAt: d.realityCheck.created_at } : null,
    decisions: d.decisions.map((x) => ({ id: x.id, decidedAt: x.decided_at, confirmed: !!x.client_confirmed_at, action: x.action, extendWeeks: x.extend_weeks ?? null })),
    decisionDeadline: idea.decision_deadline,
    clientDeciderInvited: d.members.some((m) => m.role === "client_decider"),
    outcome: {
      defined: !!idea.outcome_statement,
      due: idea.outcome_due,
      clockStart: idea.outcome_clock_start,
      resolved: stopped ? !!stopReview.data : !!outcome.data,
      question: stopped ? "stop_review" : "success",
      checkins: (checkins.data ?? []).map((c) => c.created_at),
    },
    forecasts: (forecasts.data ?? []).map((f) => ({ moment: f.moment, kind: f.forecaster_kind, probability: Number(f.probability) })),
    baseRateChosen: !!idea.reference_class,
    idea: { decisionQuestion: idea.decision_question, keyUncertainty: idea.key_uncertainty },
    baseRate: idea.base_rate_low != null && idea.base_rate_high != null ? { low: Number(idea.base_rate_low), high: Number(idea.base_rate_high) } : null,
    // Unknown (schema missing) counts as "enough": then the starting-calibration rule stays quiet.
    orgResolved: orgResolved.error ? Number.POSITIVE_INFINITY : Number(orgResolved.data?.[0]?.resolved ?? 0),
    decisionRule: rule.error ? undefined : { defined: !!rule.data, locked: !!rule.data?.locked_at },
    outreach: { replies: replies.count ?? 0, latestReplyAt: replies.data?.[0]?.received_at ?? null, latestImportAt: imports.data?.[0]?.created_at ?? null },
  };
}

async function sprintFacts(idea: Dossier["idea"], today: string): Promise<CoachFacts["sprint"]> {
  const progress = await loadProgress(idea.id);
  const s = sprintStatus({
    start: idea.sprint_start,
    weeks: idea.sprint_weeks,
    today,
    stage: sprintStage(progress),
    testsStarted: progress.experimentsLive + progress.experimentsEnded > 0,
  });
  return s.planned ? { week: s.week, weeks: s.weeks, state: s.state, behindReason: s.behindReason } : null;
}

// De actuele feiten van één dossier, voor de controle "is dit echt gedaan?" bij een coachnotitie.
export async function loadCoachFacts(ideaId: string): Promise<CoachFacts> {
  const { idea } = await getIdea(ideaId);
  const db = await supabaseServer();
  const today = todayInNL();
  return loadFacts(db, await loadDossier(idea), await sprintFacts(idea, today), today);
}

async function insertNotes(db: Db, ideaId: string, drafts: CoachNoteDraft[], source: "rules" | "ai"): Promise<number> {
  let created = 0;
  // One insert per note: a note that is already open (a parallel review) fails alone on the unique index.
  for (const n of drafts) {
    const { error } = await db.from("coach_notes").insert({
      idea_id: ideaId,
      code: n.code,
      kind: n.kind,
      title: n.title,
      body: n.body,
      href: n.href,
      source,
      audience: n.audience,
    });
    if (!error) created++;
  }
  return created;
}

export async function runCoachReview(ideaId: string, opts: { force?: boolean } = {}): Promise<ReviewResult> {
  const { idea, canWrite } = await getIdea(ideaId);
  if (!canWrite) throw new Error("Alleen het onderzoeksteam kan de coach laten meekijken.");
  const db = await supabaseServer();
  const now = Date.now();
  const today = todayInNL();

  const { data: row } = await db.from("coach_reviews").select("*").eq("idea_id", ideaId).maybeSingle();
  if (row) {
    const since = now - new Date(row.reviewed_at).getTime();
    if (since < REVIEW_INTERVAL_MS) return { status: "throttled", waitSeconds: Math.ceil((REVIEW_INTERVAL_MS - since) / 1000) };
  }

  const sprint = await sprintFacts(idea, today);
  const fingerprint = makeFingerprint({ day: today, data: await dossierFingerprint(db, ideaId, sprint?.week ?? null) });
  const changed = compareFingerprints(row?.fingerprint, fingerprint);
  if (!changed.any && !opts.force) return { status: "unchanged" };

  // Claim this review: only one request per dossier per interval gets past this point.
  const cutoff = new Date(now - REVIEW_INTERVAL_MS).toISOString();
  const reviewedAt = new Date(now).toISOString();
  if (row) {
    const { data: claimed } = await db.from("coach_reviews").update({ reviewed_at: reviewedAt }).eq("idea_id", ideaId).lt("reviewed_at", cutoff).select("idea_id");
    if (!claimed?.length) return { status: "throttled", waitSeconds: Math.ceil(REVIEW_INTERVAL_MS / 1000) };
  } else {
    const { error } = await db.from("coach_reviews").insert({ idea_id: ideaId, fingerprint: "", reviewed_at: reviewedAt, ai_reviews_today: 0, ai_day: today });
    if (error) return { status: "throttled", waitSeconds: Math.ceil(REVIEW_INTERVAL_MS / 1000) };
  }

  const dossier = await loadDossier(idea);
  const facts = await loadFacts(db, dossier, sprint, today);
  const { data: stored } = await db
    .from("coach_notes")
    .select("id, code, source, status, resolved_at, title, body")
    .eq("idea_id", ideaId)
    .order("created_at", { ascending: false })
    .limit(500);
  const notes = stored ?? [];
  const plan = planNoteChanges(
    evaluateRules(facts),
    notes.map((n) => ({ id: n.id, code: n.code, source: n.source, status: n.status, resolvedAt: n.resolved_at })),
    now,
  );
  let created = await insertNotes(db, ideaId, plan.create, "rules");
  if (plan.close.length) await db.from("coach_notes").update({ status: "done" }).in("id", plan.close).eq("status", "open");

  // AI review: only after a real change in the dossier (or on request), within the daily limit and budget.
  let ai: "ok" | "off" | "limit" | "not_needed" | "failed" = "off";
  let aiCount = row && row.ai_day === today ? row.ai_reviews_today : 0;
  if (aiConfigured()) {
    if (!changed.data && !opts.force) ai = "not_needed";
    else if (aiCount >= MAX_AI_REVIEWS_PER_DAY) ai = "limit";
    else {
      aiCount++;
      // Reserve the slot before the call, so parallel requests cannot exceed the daily limit.
      await db.from("coach_reviews").update({ ai_reviews_today: aiCount, ai_day: today }).eq("idea_id", ideaId);
      try {
        const open = [
          ...notes.filter((n) => n.status === "open" && !plan.close.includes(n.id)),
          ...plan.create.map((n) => ({ code: n.code, title: n.title, body: n.body })),
        ];
        const res = await runAi(ideaId, "coach_review", (p) =>
          coachReview(
            ideaContext(idea),
            {
            dossier: dossierSummaryForAi(dossier),
            changes: describeChanges(row?.fingerprint, fingerprint),
            openNotes: open.map((n) => ({ title: n.title, body: n.body })),
            sprint: sprint ? `Week ${sprint.week} van ${sprint.weeks}${sprint.behindReason ? `; ${sprint.behindReason}` : ""}` : "Geen sprint gepland",
            },
            p,
          ),
        );
        const suppressed = notes.filter((n) => n.status !== "open").map((n) => ({ code: n.code, title: n.title }));
        created += await insertNotes(db, ideaId, validateAiNotes(res.data, ideaId, [...open, ...suppressed]), "ai");
        ai = "ok";
      } catch {
        ai = "failed";
      }
    }
  }

  await db.from("coach_reviews").update({ fingerprint, ai_reviews_today: aiCount, ai_day: today }).eq("idea_id", ideaId);
  return { status: "reviewed", created, closed: plan.close.length, ai };
}

// Open notes for the coach panel: clients only see notes meant for everyone.
export async function loadOpenNotes(ideaId: string, audience: "consultant" | "client") {
  const db = await supabaseServer();
  const query = (cols: string) => {
    let q = db.from("coach_notes").select(cols).eq("idea_id", ideaId).eq("status", "open");
    if (audience === "client") q = q.eq("audience", "everyone");
    return q.order("created_at", { ascending: false }).limit(30);
  };
  type Row = { id: string; code: string; kind: string; title: string; body: string; href: string | null; source: string; audience: string; created_at: string; helpful: boolean | null };
  const cols = "id, code, kind, title, body, href, source, audience, created_at";
  // The helpful vote exists from the learning migration on; older databases get the notes without it.
  const withVote = await query(`${cols}, helpful`).returns<Row[]>();
  if (!withVote.error) return withVote.data ?? [];
  const { data } = await query(cols).returns<Omit<Row, "helpful">[]>();
  return (data ?? []).map((n): Row => ({ ...n, helpful: null }));
}

export type OpenNote = Awaited<ReturnType<typeof loadOpenNotes>>[number];
