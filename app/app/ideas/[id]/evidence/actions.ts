"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { getIdea, requireWritableIdea } from "@/lib/data";
import type { CardVerdict } from "@/lib/domain/evidence";
import { assumptionStatusFromCards } from "@/lib/domain/primary-test";
import { METHODS } from "@/lib/domain/method";
import { ideaMethodVersion } from "@/lib/method-data";
import { dossierSummaryForAi, factsFrom, loadDossier } from "@/lib/dossier";
import { runRealityCheck, type Finding } from "@/lib/domain/reality-check";
import { aiConfigured } from "@/lib/env";
import { challengeDossier } from "@/lib/ai/research";
import { ideaContext } from "@/lib/idea-context";
import { runAi } from "@/lib/ai/guard";
import type { Json } from "@/lib/database.types";
import { loadProgress } from "@/lib/progress";
import { decisionBlocker, outcomeDueForQuestion, outcomeQuestionFor } from "@/lib/domain/forecast";
import { todayInNL } from "@/lib/domain/sprint";
import { deviates, isFinalAction } from "@/lib/domain/decision-rule";
import { loadRuleCheck } from "@/lib/decision-rule-data";
import { EXTEND_MAX_WEEKS, EXTEND_MIN_WEEKS, extensionBlocker } from "@/lib/domain/extension";
import { againstFor } from "@/lib/against-data";

export type ActionState = { error: string | null; ok?: string | null };
const refresh = (id: string) => revalidatePath(`/app/ideas/${id}`, "layout");

const CardSchema = z.object({
  we_learned: z.string().trim().min(10).max(1500),
  therefore: z.string().trim().min(5).max(1500),
  data_reliability: z.enum(["low", "medium", "high"]),
});

export async function updateLearningCard(ideaId: string, cardId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const p = CardSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Vul in wat je hebt geleerd en wat je daarom gaat doen." };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("learning_cards").update(p.data).eq("id", cardId).eq("idea_id", ideaId).eq("status", "draft");
  if (error) return { error: "Opslaan mislukt." };
  refresh(ideaId);
  return { error: null, ok: "Learning Card bijgewerkt." };
}

// Human approval is required before a result changes the status of an assumption.
export async function approveLearningCard(ideaId: string, cardId: string, _: ActionState): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { data: card } = await supabase.from("learning_cards").select("*, experiments(id, state, hypotheses(assumption_id))").eq("id", cardId).eq("idea_id", ideaId).single();
  if (!card || card.status !== "draft") return { error: "Deze Learning Card is al goedgekeurd." };
  // Approver and time are stamped by the database; the guard makes a second approval impossible.
  const { data: approved, error } = await supabase
    .from("learning_cards")
    .update({ status: "approved" })
    .eq("id", cardId)
    .eq("status", "draft")
    .select("id");
  if (error || !approved?.length) return { error: "Goedkeuren is niet gelukt. Ververs de pagina en probeer het opnieuw." };
  const assumptionId = card.experiments?.hypotheses?.assumption_id;
  if (assumptionId) {
    // Tot en met methode 2026-11-b telt elke goedgekeurde test van deze aanname, niet alleen de laatste. Vanaf
    // 2026-11-c beslist alleen de vooraf aangewezen hoofdtest; verkennende tests geven richting.
    const [{ data: verdicts }, { data: a }, version] = await Promise.all([
      supabase
        .from("learning_cards")
        .select("verdict, experiment_id, experiments!inner(hypotheses!inner(assumption_id))")
        .eq("idea_id", ideaId)
        .eq("status", "approved")
        .eq("experiments.hypotheses.assumption_id", assumptionId),
      supabase.from("assumptions").select("primary_experiment_id").eq("id", assumptionId).maybeSingle(),
      ideaMethodVersion(ideaId),
    ]);
    const status = assumptionStatusFromCards(
      (verdicts ?? []).map((v) => ({ verdict: v.verdict as CardVerdict, experimentId: v.experiment_id })),
      a?.primary_experiment_id ?? null,
      METHODS[version].primaryDecides,
    );
    await supabase.from("assumptions").update({ status }).eq("id", assumptionId).eq("idea_id", ideaId);
  }
  if (card.experiments?.state === "ended") await supabase.from("experiments").update({ state: "analyzed" }).eq("id", card.experiments.id);
  refresh(ideaId);
  return { error: null, ok: "Goedgekeurd. De aanname en de risicokaart zijn bijgewerkt." };
}

export async function runCheck(ideaId: string, _: ActionState): Promise<ActionState> {
  const { idea } = await requireWritableIdea(ideaId);
  const dossier = await loadDossier(idea);
  const result = runRealityCheck(factsFrom(dossier));
  const findings: (Finding & { source?: string })[] = result.findings.map((f) => ({ ...f, source: "regels" }));
  let aiUsed = false;
  if (aiConfigured()) {
    try {
      const res = await runAi(ideaId, "reality_check", (p) => challengeDossier(ideaContext(idea), dossierSummaryForAi(dossier), p));
      for (const c of res.data.challenges) findings.push({ code: "ai_challenge", severity: c.severity, title: c.title, detail: c.detail, source: "ai" });
      aiUsed = true;
    } catch {
      // Logged by runAi; the rule-based check below still runs.
    }
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.from("reality_checks").insert({
    idea_id: ideaId,
    findings: { findings, investorQuestions: result.investorQuestions } as unknown as Json,
    advice: result.advice,
    advice_reason: result.adviceReason,
    ai_used: aiUsed,
  });
  if (error) return { error: "De Reality Check kon niet worden opgeslagen." };
  refresh(ideaId);
  return { error: null, ok: "Reality Check uitgevoerd." };
}

// Pre-mortem (research 3.10): "Het is zes maanden na het besluit en dit is mislukt. Wat is de meest
// waarschijnlijke reden?" Each reason becomes an assumption on the map (origin 'premortem'), so it is
// tested like any other. Empty rows are skipped; at least one reason is required.
const PremortemReason = z.object({
  statement: z.string().trim().min(10, "Beschrijf elke reden in minstens één korte zin.").max(400),
  category: z.enum(["desirability", "feasibility", "viability", "context"]),
  importance: z.coerce.number().int().min(1).max(5),
});

export async function addPremortem(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const reasons: z.infer<typeof PremortemReason>[] = [];
  for (const i of [1, 2, 3]) {
    const statement = String(form.get(`reason_${i}`) ?? "").trim();
    if (!statement) continue;
    const p = PremortemReason.safeParse({
      statement,
      category: form.get(`category_${i}`) ?? "desirability",
      importance: form.get(`importance_${i}`) ?? 4,
    });
    if (!p.success) return { error: p.error.issues[0].message };
    reasons.push(p.data);
  }
  if (reasons.length === 0) return { error: "Vul minstens één reden in." };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("assumptions").insert(reasons.map((r) => ({ ...r, idea_id: ideaId, origin: "premortem" })));
  if (error) return { error: "De pre-mortem kon niet worden opgeslagen." };
  refresh(ideaId);
  return { error: null, ok: `${reasons.length} reden(en) staan nu als aanname op de risicokaart. Voer de Reality Check opnieuw uit.` };
}

const DecisionSchema = z.object({
  action: z.enum(["continue", "adjust", "test_more", "extend", "pause", "stop"]),
  extend_weeks: z.coerce.number().int().min(EXTEND_MIN_WEEKS).max(EXTEND_MAX_WEEKS).optional(),
  rationale: z.string().trim().min(15, "Leg in minstens één zin uit waarom.").max(2000),
  next_step: z.string().trim().max(600).optional(),
  rule_deviation_reason: z.string().trim().max(2000).optional(),
});

export async function saveDecision(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { idea } = await requireWritableIdea(ideaId);
  const p = DecisionSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await supabaseServer();
  const { data: check } = await supabase.from("reality_checks").select("id, created_at, findings").eq("idea_id", ideaId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!check) return { error: "Doe eerst de Reality Check. Een besluit zonder tegenspraak is niet toegestaan." };
  const { data: lastCard } = await supabase.from("learning_cards").select("approved_at").eq("idea_id", ideaId).eq("status", "approved").order("approved_at", { ascending: false }).limit(1).maybeSingle();
  if (lastCard?.approved_at && lastCard.approved_at > check.created_at) return { error: "Er is nieuw bewijs sinds de laatste Reality Check. Voer de check opnieuw uit." };
  const blockers = ((check.findings as { findings?: Finding[] })?.findings ?? []).filter((f) => f.severity === "blocker");
  if (blockers.length && p.data.action === "continue") return { error: "Er zijn blokkerende punten in de Reality Check. 'Doorgaan' kan pas als die zijn opgelost." };
  // Prediction loop: a decision is measured against the outcome six months later, so the outcome must be
  // defined and the decider gives their own forecast while the decision moment is open.
  const progress = await loadProgress(ideaId);
  const blocker = decisionBlocker(progress);
  if (blocker) return { error: blocker };
  // Golf B, punt 20: één verlengde testfase van 2 tot 8 weken; tijdens die fase geen definitief besluit.
  if (p.data.action === "extend" && !p.data.extend_weeks) return { error: `Kies hoeveel weken extra testen (${EXTEND_MIN_WEEKS} tot ${EXTEND_MAX_WEEKS}).` };
  const { data: earlier } = await supabase.from("decisions").select("action, decided_at, extend_weeks").eq("idea_id", ideaId);
  const extBlock = extensionBlocker(
    p.data.action,
    (earlier ?? []).map((x) => ({ action: x.action, decidedOn: todayInNL(new Date(x.decided_at)), extendWeeks: x.extend_weeks ?? null })),
    todayInNL(),
    !!idea.outcome_clock_start,
  );
  if (extBlock) return { error: extBlock };
  // Golf B, punt 6: een definitief besluit wordt getoetst aan de beslisregel. Wie afwijkt, motiveert dat.
  const ruleCheck = isFinalAction(p.data.action) ? await loadRuleCheck(ideaId) : null;
  const deviation = ruleCheck ? deviates(p.data.action, ruleCheck.evaluation.met) : false;
  if (deviation && (p.data.rule_deviation_reason ?? "").length < 15) return { error: "Dit besluit wijkt af van de beslisregel. Motiveer in minstens één zin waarom." };
  // The decision links the most recently ended analysed experiment; all analysed ones become decided.
  const { data: exps } = await supabase.from("experiments").select("id").eq("idea_id", ideaId).eq("state", "analyzed").order("ended_at", { ascending: false });
  const { error } = await supabase.from("decisions").insert({
    idea_id: ideaId,
    reality_check_id: check.id,
    experiment_id: exps?.[0]?.id ?? null,
    action: p.data.action,
    rationale: p.data.rationale,
    next_step: p.data.next_step || null,
    rule_met: ruleCheck ? ruleCheck.evaluation.met : null,
    rule_evaluation: ruleCheck ? (ruleCheck.evaluation as unknown as Json) : null,
    rule_deviation_reason: deviation ? p.data.rule_deviation_reason : null,
    extend_weeks: p.data.action === "extend" ? p.data.extend_weeks : null,
  });
  if (error) {
    // The database enforces the same rules; show its reason when it refuses.
    if (error.message.includes("DECISION_STALE")) return { error: "Er is nieuw bewijs sinds de laatste Reality Check. Voer de check opnieuw uit." };
    if (error.message.includes("DECISION_BLOCKED")) return { error: "Er zijn blokkerende punten in de Reality Check. 'Doorgaan' kan pas als die zijn opgelost." };
    if (error.message.includes("DECISION_CHECK")) return { error: "Voer de Reality Check opnieuw uit voordat je besluit." };
    if (error.message.includes("EXTEND_ACTIVE")) return { error: "De verlengde testfase loopt nog. Het definitieve besluit volgt daarna." };
    if (error.message.includes("EXTEND_ONCE")) return { error: "Dit dossier heeft al een verlengde testfase gehad." };
    if (error.message.includes("EXTEND_AFTER_FINAL")) return { error: "Na een definitief besluit is er geen verlengde testfase meer." };
    if (error.message.includes("DECISION_RULE_DEVIATION")) return { error: "Dit besluit wijkt af van de beslisregel. Motiveer in minstens één zin waarom." };
    if (error.message.includes("DECISION_RULE_EVAL")) return { error: "De toets aan de beslisregel klopt niet meer met het dossier. Ververs de pagina en probeer het opnieuw." };
    return { error: "Het besluit kon niet worden opgeslagen." };
  }
  for (const e of exps ?? []) await supabase.from("experiments").update({ state: "decided" }).eq("id", e.id);
  const status = { continue: "continued", stop: "stopped", pause: "parked", adjust: "active", test_more: "active", extend: "active" }[p.data.action];
  await supabase.from("ideas").update({ status }).eq("id", ideaId);
  // The first decision after the outcome definition starts the six-month clock (set once, never moved).
  // The six-month clock starts at a final decision (continue, stop or pause). "Verder testen", "bijsturen" en de
  // verlengde testfase (extend) houden het traject gaande: de klok start pas bij het definitieve besluit daarna.
  const finalDecision = p.data.action === "continue" || p.data.action === "stop" || p.data.action === "pause";
  if (progress.forecast && !idea.outcome_due && finalDecision) {
    const decidedOn = todayInNL();
    // Een vooraf geplande meetdatum wordt de uitkomstdatum als hij nog binnen zes maanden na het besluit valt. Na een
    // stop of pauze vervalt de uitkomstvraag: dan volgt na zes maanden de stopvraag (de database legt dat ook zelf vast).
    const question = outcomeQuestionFor(p.data.action);
    await supabase.from("ideas").update({ outcome_due: outcomeDueForQuestion(question, decidedOn, idea.outcome_measure_date), outcome_clock_start: decidedOn }).eq("id", ideaId).is("outcome_due", null);
  }
  refresh(ideaId);
  if (p.data.action === "extend")
    return { error: null, ok: `Verlengde testfase van ${p.data.extend_weeks} weken vastgelegd. Het definitieve besluit en de uitkomstklok volgen daarna.` };
  return { error: null, ok: "Besluit vastgelegd. De opdrachtgever kan het nu bevestigen; werk daarna het rapport bij." };
}

// Golf B, punt 18: bevestigen kan alleen na de samenvatting "Wat ging tegen". De server stelt die opnieuw samen uit het
// dossier van nu en geeft haar mee; de database eist dat en telt de mislukte tests en de afwijking na.
export async function confirmDecision(ideaId: string, decisionId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { idea, isClientDecider } = await getIdea(ideaId);
  if (!isClientDecider) return { error: "Alleen de opdrachtgever kan dit besluit bevestigen." };
  if (form.get("reviewed") !== "on") return { error: "Open eerst de samenvatting \u201cWat ging tegen\u201d of vink aan dat u die hebt gelezen." };
  const supabase = await supabaseServer();
  const [dossier, { data: decision }] = await Promise.all([
    loadDossier(idea),
    supabase.from("decisions").select("action, rule_met, rule_deviation_reason").eq("id", decisionId).eq("idea_id", ideaId).maybeSingle(),
  ]);
  if (!decision) return { error: "Dit besluit bestaat niet (meer)." };
  const summary = { ...againstFor(dossier, decision), acknowledged: true };
  const { data, error } = await supabase.rpc("confirm_decision", {
    p_decision: decisionId,
    p_comment: String(form.get("comment") ?? "").slice(0, 1000),
    p_reviewed_against_summary: summary as unknown as Json,
  });
  if (error) {
    if (error.message.includes("REVIEW_")) return { error: "De samenvatting \u201cWat ging tegen\u201d is niet compleet. Ververs de pagina en lees haar opnieuw." };
    return { error: "Bevestigen mislukt." };
  }
  refresh(ideaId);
  return { error: null, ok: data ? "Besluit bevestigd." : "Dit besluit was al bevestigd." };
}
