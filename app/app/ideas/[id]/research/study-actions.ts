"use server";

// Klantonderzoek vanuit stap 1 Markt: verkennende enquêtes en online interviews (schriftelijk). Elk onderzoek hangt
// aan een onderzoeksvraag, is verkennend (geen drempels, geen aanname) en draait op de enquête-engine. Zie
// lib/domain/customer-research.ts voor de regels.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { getWorkspace, requireWritableIdea } from "@/lib/data";
import { RECRUITMENT_KEYS } from "@/lib/domain/recruitment";
import { fieldErrorsFrom, savedNothing } from "@/lib/domain/form-errors";
import { SurveyConfigSchema, templateSurvey, type SurveyConfig } from "@/lib/domain/survey";
import { surveyErrors } from "@/lib/domain/survey-editor";
import type { DraftResult } from "@/lib/domain/survey-draft";
import {
  asExploratory,
  DEFAULT_DAYS,
  emptyExploratorySurvey,
  exploratoryHypothesis,
  isExploratory,
  missingStudySchema,
  onlineInterviewConfig,
  studyFormatOf,
  STUDY_SCHEMA_MISSING,
} from "@/lib/domain/customer-research";
import { coachSurveyDraft } from "@/lib/survey-coach";
import type { Json } from "@/lib/database.types";

export type StudyState = { error: string | null; ok?: string | null; fieldErrors?: Record<string, string> };

const text = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max, message);

const StudyInput = z.object({
  format: z.enum(["survey", "interview"], { error: "Kies een enquête of een online interview." }),
  question_id: z.string().uuid("Kies de onderzoeksvraag waar dit onderzoek bij hoort."),
  title: text(3, 120, "Geef het onderzoek een titel van 3 tot 120 tekens."),
  goal: text(10, 600, "Beschrijf in een zin wat je wilt leren (minstens 10 tekens)."),
  audience: text(2, 300, "Beschrijf de doelgroep."),
  start: z.enum(["ai", "template", "empty"]).default("template"),
  target_n: z.coerce.number({ error: "Vul een streefaantal in." }).int("Vul een heel getal in.").min(1, "Minstens 1.").max(5000, "Hoogstens 5000."),
  max_days: z.coerce.number({ error: "Vul een looptijd in." }).int("Vul een heel getal in.").min(1, "Minstens 1 dag.").max(180, "Hoogstens 180 dagen."),
  recruitment_group: z.enum(RECRUITMENT_KEYS).optional(),
});

// Een nieuw verkennend onderzoek: kies de onderzoeksvraag, titel en doel, en begin met een AI-voorstel, het
// sjabloon of (bijna) leeg. Daarna gaat de consultant door naar de editor op de onderzoekspagina. Er wordt niets
// gepubliceerd: het onderzoek start als concept en gaat pas live na een expliciete goedkeuring.
export async function createStudy(ideaId: string, _: StudyState, form: FormData): Promise<StudyState> {
  const { idea } = await requireWritableIdea(ideaId);
  const ws = await getWorkspace();
  const raw = Object.fromEntries(form);
  if (raw.recruitment_group === "") delete raw.recruitment_group;
  const p = StudyInput.safeParse(raw);
  if (!p.success) {
    const fieldErrors = fieldErrorsFrom(p.error.issues);
    return { error: savedNothing("Het onderzoek", fieldErrors), fieldErrors };
  }
  const v = p.data;
  const supabase = await supabaseServer();
  const { data: q } = await supabase.from("research_questions").select("id, question").eq("id", v.question_id).eq("idea_id", ideaId).maybeSingle();
  if (!q) return { error: "Die onderzoeksvraag bestaat niet (meer) in dit dossier.", fieldErrors: { question_id: "Kies een onderzoeksvraag uit de lijst." } };

  const researcher = ws.org?.name ?? "de onderzoeker";
  const ctx = { title: v.title, goal: v.goal, audience: v.audience, researcher };
  let config: SurveyConfig;
  let draftId: string | null = null;
  let origin = v.start === "empty" ? "leeg" : "sjabloon";
  if (v.format === "interview") {
    config = onlineInterviewConfig(ctx);
    origin = "leidraad";
  } else if (v.start === "ai") {
    // Hetzelfde AI-voorstel als bij de testkaart, met de onderzoeksvraag als onderwerp. Zonder AI: het sjabloon.
    const res = await coachSurveyDraft(idea, { subject: `Onderzoeksvraag: ${q.question} Doel: ${v.goal}`, audience: v.audience, researcher });
    config = { ...asExploratory(res.draft.config), title: v.title };
    draftId = res.draftId;
    origin = res.draft.origin === "ai" ? "ai" : "terugval";
  } else if (v.start === "template") {
    config = { ...asExploratory(templateSurvey({ assumption: q.question, audience: v.audience, researcher, product: idea.title, screen: true })), title: v.title };
  } else {
    config = emptyExploratorySurvey(ctx);
  }
  const parsed = SurveyConfigSchema.safeParse(config);
  if (!parsed.success) return { error: `De opzet is ongeldig: ${surveyErrors(config)[0] ?? "controleer de vragen"}.` };

  const { data: h, error: hErr } = await supabase
    .from("hypotheses")
    .insert({
      idea_id: ideaId,
      ...exploratoryHypothesis({ format: v.format, goal: v.goal, audience: v.audience, targetN: v.target_n, maxDays: v.max_days || DEFAULT_DAYS, researchQuestionId: q.id }),
    })
    .select("id")
    .single();
  if (hErr || !h) return { error: missingStudySchema(hErr) ? STUDY_SCHEMA_MISSING : `Het onderzoek kon niet worden opgeslagen (${hErr?.message ?? "onbekende fout"}). Probeer het opnieuw.` };
  const { data: exp, error } = await supabase
    .from("experiments")
    .insert({
      idea_id: ideaId,
      hypothesis_id: h.id,
      type: "survey",
      title: v.title,
      config: parsed.data as unknown as Json,
      channels: [],
      cost_estimate_eur: 0,
      recruitment_group: v.recruitment_group ?? null,
      ai_draft_id: draftId,
    })
    .select("id")
    .single();
  if (error || !exp) {
    // Geen halve opslag: zonder experiment heeft de hypothese geen betekenis.
    await supabase.from("hypotheses").delete().eq("id", h.id).is("locked_at", null);
    return { error: `Het onderzoek kon niet worden opgeslagen (${error?.message ?? "onbekende fout"}). Probeer het opnieuw.` };
  }
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  redirect(`/app/ideas/${ideaId}/experiments/${exp.id}?nieuw=${origin}`);
}

async function loadStudy(ideaId: string, expId: string) {
  const supabase = await supabaseServer();
  const { data: exp } = await supabase.from("experiments").select("id, state, type, config, hypotheses(*)").eq("id", expId).eq("idea_id", ideaId).maybeSingle();
  if (!exp || exp.type !== "survey" || !isExploratory(exp.hypotheses)) return null;
  return exp;
}

export type SaveStudyResult = { error: string | null; ok?: string | null };

// De editor op de onderzoekspagina: de vragen van een verkennend onderzoek wijzigen zolang het een concept is of
// ter review ligt. De vorm (enquête of online interview) en het verkennende karakter blijven gelijk.
export async function saveStudyConfig(ideaId: string, expId: string, input: { config: unknown; aiDraftId?: string | null }): Promise<SaveStudyResult> {
  await requireWritableIdea(ideaId);
  const exp = await loadStudy(ideaId, expId);
  if (!exp) return { error: "Onderzoek niet gevonden." };
  if (!["draft", "ready_for_review"].includes(exp.state)) return { error: "Na goedkeuring ligt het onderzoek vast en kunnen de vragen niet meer veranderen." };
  const format = studyFormatOf(exp.config as { format?: string } | null);
  const candidate = { ...(input.config as Record<string, unknown>), purpose: "explore", format };
  const errors = surveyErrors(candidate);
  if (errors.length) return { error: `Nog niet opgeslagen: ${errors[0]}` };
  const config = SurveyConfigSchema.parse(candidate);
  const supabase = await supabaseServer();
  const aiDraftId = typeof input.aiDraftId === "string" && /^[0-9a-f-]{36}$/i.test(input.aiDraftId) ? input.aiDraftId : undefined;
  const { error } = await supabase
    .from("experiments")
    .update({ config: config as unknown as Json, ...(aiDraftId ? { ai_draft_id: aiDraftId } : {}) })
    .eq("id", expId)
    .eq("idea_id", ideaId);
  if (error) return { error: "De vragen konden niet worden opgeslagen. Probeer het opnieuw." };
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  return { error: null, ok: "Vragen opgeslagen." };
}

export type StudyDraftState = { error: string | null; draft: DraftResult | null; draftId?: string | null };

// "Laat de coach een eerste opzet maken" in de editor van een verkennende enquête: hetzelfde voorstel als bij de
// testkaart, met de onderzoeksvraag en het doel als onderwerp. Er wordt niets opgeslagen tot de consultant opslaat.
export async function draftStudyWithCoach(ideaId: string, expId: string): Promise<StudyDraftState> {
  const { idea } = await requireWritableIdea(ideaId);
  const exp = await loadStudy(ideaId, expId);
  if (!exp?.hypotheses) return { error: "Onderzoek niet gevonden.", draft: null };
  if (studyFormatOf(exp.config as { format?: string } | null) === "interview") return { error: "Een online interview gebruikt de interviewleidraad, geen enquêteopzet.", draft: null };
  const h = exp.hypotheses;
  const supabase = await supabaseServer();
  const { data: q } = h.research_question_id
    ? await supabase.from("research_questions").select("question").eq("id", h.research_question_id).eq("idea_id", ideaId).maybeSingle()
    : { data: null };
  const ws = await getWorkspace();
  const subject = `${q ? `Onderzoeksvraag: ${q.question} ` : ""}Doel: ${h.we_believe}`;
  const res = await coachSurveyDraft(idea, { subject, audience: h.target_group, researcher: ws.org?.name ?? "de onderzoeker" });
  return { error: null, draft: { ...res.draft, config: asExploratory(res.draft.config) }, draftId: res.draftId };
}

// Een concept weggooien (alleen vóór goedkeuring) en terug naar het tabblad Klantonderzoek.
export async function deleteStudyDraft(ideaId: string, expId: string) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { data: exp } = await supabase.from("experiments").select("state, hypothesis_id, hypotheses(exploratory, success_threshold_pct, assumption_id)").eq("id", expId).eq("idea_id", ideaId).maybeSingle();
  if (!exp || !isExploratory(exp.hypotheses) || !["draft", "ready_for_review"].includes(exp.state)) return;
  await supabase.from("experiments").delete().eq("id", expId).eq("idea_id", ideaId);
  await supabase.from("hypotheses").delete().eq("id", exp.hypothesis_id).is("locked_at", null);
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  redirect(`/app/ideas/${ideaId}/research?tab=klantonderzoek`);
}
