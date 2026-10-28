"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { getIdea, getWorkspace, requireWritableIdea } from "@/lib/data";
import { dossierSummaryForAi, factsFrom, loadDossier } from "@/lib/dossier";
import { runRealityCheck, type Finding } from "@/lib/domain/reality-check";
import { aiConfigured } from "@/lib/env";
import { challengeDossier } from "@/lib/ai/research";
import { ideaContext } from "@/lib/idea-context";
import { logAiRun } from "@/lib/ai/log";
import type { Json } from "@/lib/database.types";

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
  const ws = await getWorkspace();
  const supabase = await supabaseServer();
  const { data: card } = await supabase.from("learning_cards").select("*, experiments(id, state, hypotheses(assumption_id))").eq("id", cardId).eq("idea_id", ideaId).single();
  if (!card || card.status !== "draft") return { error: "Deze Learning Card is al goedgekeurd." };
  await supabase.from("learning_cards").update({ status: "approved", approved_by: ws.user.id, approved_at: new Date().toISOString() }).eq("id", cardId);
  const assumptionId = card.experiments?.hypotheses?.assumption_id;
  if (assumptionId) {
    const status = card.verdict === "pass" ? "supported" : card.verdict === "fail" ? "refuted" : "inconclusive";
    await supabase.from("assumptions").update({ status }).eq("id", assumptionId);
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
      const res = await challengeDossier(ideaContext(idea), dossierSummaryForAi(dossier));
      await logAiRun({ ideaId, purpose: "reality_check", outcome: "ok", usage: res.usage });
      for (const c of res.data.challenges) findings.push({ code: "ai_challenge", severity: c.severity, title: c.title, detail: c.detail, source: "ai" });
      aiUsed = true;
    } catch (e) {
      await logAiRun({ ideaId, purpose: "reality_check", outcome: "error", detail: String(e) });
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

const DecisionSchema = z.object({
  action: z.enum(["continue", "adjust", "test_more", "pause", "stop"]),
  rationale: z.string().trim().min(15, "Leg in minstens één zin uit waarom.").max(2000),
  next_step: z.string().trim().max(600).optional(),
});

export async function saveDecision(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const p = DecisionSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await supabaseServer();
  const { data: check } = await supabase.from("reality_checks").select("id, created_at, findings").eq("idea_id", ideaId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!check) return { error: "Doe eerst de Reality Check. Een besluit zonder tegenspraak is niet toegestaan." };
  const { data: lastCard } = await supabase.from("learning_cards").select("approved_at").eq("idea_id", ideaId).eq("status", "approved").order("approved_at", { ascending: false }).limit(1).maybeSingle();
  if (lastCard?.approved_at && lastCard.approved_at > check.created_at) return { error: "Er is nieuw bewijs sinds de laatste Reality Check. Voer de check opnieuw uit." };
  const blockers = ((check.findings as { findings?: Finding[] })?.findings ?? []).filter((f) => f.severity === "blocker");
  if (blockers.length && p.data.action === "continue") return { error: "Er zijn blokkerende punten in de Reality Check. 'Doorgaan' kan pas als die zijn opgelost." };
  const { data: exps } = await supabase.from("experiments").select("id").eq("idea_id", ideaId).eq("state", "analyzed");
  const { error } = await supabase.from("decisions").insert({
    idea_id: ideaId,
    reality_check_id: check.id,
    experiment_id: exps?.[0]?.id ?? null,
    action: p.data.action,
    rationale: p.data.rationale,
    next_step: p.data.next_step || null,
  });
  if (error) return { error: "Het besluit kon niet worden opgeslagen." };
  for (const e of exps ?? []) await supabase.from("experiments").update({ state: "decided" }).eq("id", e.id);
  const status = { continue: "continued", stop: "stopped", pause: "parked", adjust: "active", test_more: "active" }[p.data.action];
  await supabase.from("ideas").update({ status }).eq("id", ideaId);
  refresh(ideaId);
  return { error: null, ok: "Besluit vastgelegd. De opdrachtgever kan het nu bevestigen; werk daarna het rapport bij." };
}

export async function confirmDecision(ideaId: string, decisionId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { isClientDecider } = await getIdea(ideaId);
  if (!isClientDecider) return { error: "Alleen de opdrachtgever kan dit besluit bevestigen." };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("confirm_decision", { p_decision: decisionId, p_comment: String(form.get("comment") ?? "").slice(0, 1000) });
  if (error) return { error: "Bevestigen mislukt." };
  refresh(ideaId);
  return { error: null, ok: data ? "Besluit bevestigd." : "Dit besluit was al bevestigd." };
}
