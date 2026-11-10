"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWritableIdea } from "@/lib/data";
import type { FormState } from "@/components/ui/ActionForm";
import type { Json } from "@/lib/database.types";
import { contactProblem } from "@/lib/domain/test-privacy";
import { missingImportSchema } from "@/lib/domain/interview-import";
import {
  AI_INTERVIEW_SCHEMA_MISSING,
  buildTranscript,
  checkGuide,
  exclusionReasonError,
  labelsFromMap,
  LIMITS,
  parseScreenerOptions,
  SettingsSchema,
  type PseudonymMap,
  type ScreenerKind,
  type ScreenerQuestion,
  type StoredTurn,
} from "@/lib/domain/ai-interview";

// De AI-interviewer instellen, goedkeuren, pauzeren, en gesprekken uitsluiten, weer opnemen of verwijderen. De
// database bewaakt hetzelfde (guard_ai_interview_config en de functies ai_interview_*).

const refresh = (id: string) => revalidatePath(`/app/ideas/${id}`, "layout");

function dbError(error: { message?: string | null; code?: string | null } | null, fallback: string): string {
  if (!error) return fallback;
  if (missingImportSchema(error)) return AI_INTERVIEW_SCHEMA_MISSING;
  const m = /([A-Z_]{6,}): ([^\n]+)/.exec(error.message ?? "");
  return m ? m[2].charAt(0).toUpperCase() + m[2].slice(1) + "." : fallback;
}

async function interviewTest(ideaId: string, expId: string) {
  const supabase = await supabaseServer();
  const { data: exp } = await supabase.from("experiments").select("id, type, state, config, title").eq("id", expId).eq("idea_id", ideaId).maybeSingle();
  return exp && exp.type === "interview" ? exp : null;
}

const guideOf = (config: unknown): string[] => {
  const g = (config as { guide?: unknown } | null)?.guide;
  return Array.isArray(g) ? g.filter((x): x is string => typeof x === "string") : [];
};

function screenerFrom(form: FormData): { screener: ScreenerQuestion[]; errors: Record<string, string> } {
  const screener: ScreenerQuestion[] = [];
  const errors: Record<string, string> = {};
  for (let i = 0; i < LIMITS.screenerQuestions; i++) {
    const text = String(form.get(`screener_${i}_text`) ?? "").trim();
    const optionsText = String(form.get(`screener_${i}_options`) ?? "");
    if (!text && !optionsText.trim()) continue;
    const kindRaw = String(form.get(`screener_${i}_kind`) ?? "other");
    const kind: ScreenerKind = kindRaw === "role" || kindRaw === "segment" ? kindRaw : "other";
    if (text.length < 5 || text.length > 200) errors[`screener_${i}_text`] = "Een screenervraag is 5 tot 200 tekens.";
    const parsed = parseScreenerOptions(optionsText, kind);
    if (parsed.errors.length) errors[`screener_${i}_options`] = parsed.errors.join(" ");
    screener.push({ id: `s${i + 1}`, kind, text, options: parsed.options });
  }
  if (screener.filter((q) => q.kind === "role").length > 1) errors.screener_0_kind = "Gebruik hooguit één vraag naar de rol.";
  if (screener.filter((q) => q.kind === "segment").length > 1) errors.screener_0_kind = "Gebruik hooguit één vraag naar het segment.";
  return { screener, errors };
}

export async function saveAiInterviewConfig(ideaId: string, expId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireWritableIdea(ideaId);
  const exp = await interviewTest(ideaId, expId);
  if (!exp) return { error: "Interviewtest niet gevonden." };
  const p = SettingsSchema.safeParse(Object.fromEntries(form));
  const fieldErrors: Record<string, string> = {};
  if (!p.success) for (const issue of p.error.issues) fieldErrors[String(issue.path[0] ?? "intro")] ??= issue.message;
  const contact = String(form.get("privacy_contact") ?? "");
  const contactError = contactProblem(contact);
  if (contactError) fieldErrors.privacy_contact = contactError;
  const { screener, errors } = screenerFrom(form);
  Object.assign(fieldErrors, errors);
  const guide = guideOf(exp.config);
  if (guide.length < LIMITS.guide.min) return { error: `De testkaart heeft minder dan ${LIMITS.guide.min} interviewvragen. Maak een testkaart met een leidraad.` };
  if (!p.success || Object.keys(fieldErrors).length) return { error: "De opzet is niet opgeslagen. Verbeter de velden hieronder.", fieldErrors };
  const row = {
    guide: guide.slice(0, LIMITS.guide.max) as unknown as Json,
    max_turns: p.data.max_turns,
    max_minutes: p.data.max_minutes,
    max_probes: p.data.max_probes,
    retention_months: p.data.retention_months,
    intro: p.data.intro,
    sponsor_mode: p.data.sponsor_mode,
    sponsor_name: p.data.sponsor_mode === "client" ? p.data.sponsor_name : null,
    privacy_contact: contact.trim(),
    screener: screener as unknown as Json,
  };
  const supabase = await supabaseServer();
  const { data: existing, error: readError } = await supabase.from("ai_interview_configs").select("id, status").eq("experiment_id", expId).maybeSingle();
  if (readError) return { error: dbError(readError, "De opzet is niet opgeslagen. Probeer het opnieuw.") };
  if (existing?.status === "approved") return { error: "De opzet is goedgekeurd en ligt vast. Trek de goedkeuring in (kan zolang er geen gesprekken zijn) om iets te veranderen." };
  const { error } = existing
    ? await supabase.from("ai_interview_configs").update(row).eq("id", existing.id)
    : await supabase.from("ai_interview_configs").insert({ ...row, experiment_id: expId, idea_id: ideaId });
  if (error) return { error: dbError(error, "De opzet is niet opgeslagen. Probeer het opnieuw.") };
  refresh(ideaId);
  return { error: null, ok: "Opzet opgeslagen. Controleer de leidraad en keur hem goed om de AI-interviewer te gebruiken." };
}

export async function approveAiInterview(ideaId: string, expId: string, _: FormState, form: FormData): Promise<FormState> {
  const { idea } = await requireWritableIdea(ideaId);
  const exp = await interviewTest(ideaId, expId);
  if (!exp) return { error: "Interviewtest niet gevonden." };
  if (!["approved", "live", "paused"].includes(exp.state)) return { error: "Keur eerst de testkaart goed; daarna keur je de leidraad voor de AI-interviewer goed." };
  const missing = ["check_guide", "check_disclosure"].filter((k) => form.get(k) !== "on");
  if (missing.length) return { error: "Bevestig beide punten om goed te keuren.", fieldErrors: Object.fromEntries(missing.map((k) => [k, "Bevestig dit punt."])) };
  const supabase = await supabaseServer();
  const { data: c, error: readError } = await supabase.from("ai_interview_configs").select("id, guide, status").eq("experiment_id", expId).maybeSingle();
  if (readError || !c) return { error: dbError(readError, "Sla eerst de opzet op.") };
  const guide = guideOf({ guide: c.guide });
  // De leidraadcontrole moet slagen: geen hypothetische, sturende of verkopende vragen en geen bijzondere gegevens.
  const check = checkGuide(guide, [idea.title, String((exp.config as { product_name?: unknown } | null)?.product_name ?? "")]);
  if (!check.ok) return { error: `Goedkeuren kan niet: ${check.problems.join(" ")} Pas de leidraad aan via een nieuwe testkaart.` };
  if (JSON.stringify(guide) !== JSON.stringify(guideOf(exp.config))) {
    // De testkaart is sinds het opslaan veranderd: neem de huidige leidraad over en laat opnieuw controleren.
    await supabase.from("ai_interview_configs").update({ guide: guideOf(exp.config) as unknown as Json }).eq("id", c.id);
    refresh(ideaId);
    return { error: "De interviewvragen van de testkaart zijn veranderd. De leidraad is bijgewerkt; controleer hem en keur opnieuw goed." };
  }
  const { error } = await supabase.from("ai_interview_configs").update({ status: "approved" }).eq("id", c.id);
  if (error) return { error: dbError(error, "Goedkeuren is niet gelukt. Probeer het opnieuw.") };
  refresh(ideaId);
  return { error: null, ok: "Leidraad goedgekeurd en vergrendeld. Zodra de interviewronde loopt, kun je de link delen." };
}

export async function revokeAiInterview(ideaId: string, expId: string, _: FormState): Promise<FormState> {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { error } = await supabase.from("ai_interview_configs").update({ status: "draft" }).eq("experiment_id", expId).eq("idea_id", ideaId);
  if (error) return { error: dbError(error, "Intrekken is niet gelukt.") };
  refresh(ideaId);
  return { error: null, ok: "Goedkeuring ingetrokken. Je kunt de opzet weer aanpassen." };
}

export async function setAiInterviewPaused(ideaId: string, expId: string, paused: boolean, _: FormState): Promise<FormState> {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { error } = await supabase.from("ai_interview_configs").update({ paused }).eq("experiment_id", expId).eq("idea_id", ideaId);
  if (error) return { error: dbError(error, "Dat is niet gelukt.") };
  refresh(ideaId);
  return { error: null, ok: paused ? "De AI-interviewer is gepauzeerd: nieuwe en lopende gesprekken stoppen netjes." : "De AI-interviewer neemt weer gesprekken af." };
}

export async function excludeAiInterview(ideaId: string, sessionId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireWritableIdea(ideaId);
  const reason = String(form.get("reason") ?? "");
  const err = exclusionReasonError(reason);
  if (err) return { error: err, fieldErrors: { reason: err } };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("ai_interview_exclude", { p_session: sessionId, p_reason: reason.trim() });
  if (error) return { error: dbError(error, "Uitsluiten is niet gelukt.") };
  refresh(ideaId);
  return { error: null, ok: "Gesprek uitgesloten: het telt nergens meer mee. Het transcript en de reden blijven bewaard." };
}

// Weer opnemen (ook een afgebroken gesprek met antwoorden): het transcript wordt opnieuw opgebouwd uit de beurten.
export async function includeAiInterview(ideaId: string, sessionId: string, _: FormState): Promise<FormState> {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const [{ data: s }, { data: turns }] = await Promise.all([
    supabase.from("ai_interview_sessions").select("id, started_at, pseudonym_map").eq("id", sessionId).eq("idea_id", ideaId).maybeSingle(),
    supabase.from("ai_interview_turns").select("seq, role, kind, text, created_at").eq("session_id", sessionId).order("seq"),
  ]);
  if (!s) return { error: "Gesprek niet gevonden." };
  const { transcript, segments } = buildTranscript((turns ?? []) as StoredTurn[], s.started_at);
  const { error } = await supabase.rpc("ai_interview_include", {
    p_session: sessionId,
    p_transcript: transcript,
    p_segments: segments as unknown as Json,
    p_labels: labelsFromMap((s.pseudonym_map ?? {}) as PseudonymMap) as unknown as Json,
  });
  if (error) return { error: dbError(error, "Opnemen is niet gelukt.") };
  refresh(ideaId);
  return { error: null, ok: "Gesprek opgenomen als interview van deze test (AI-gemodereerd). Codeer nu de uitspraken." };
}

export async function deleteAiInterview(ideaId: string, sessionId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireWritableIdea(ideaId);
  if (form.get("confirm_delete") !== "on") return { error: "Bevestig dat je dit gesprek definitief verwijdert.", fieldErrors: { confirm_delete: "Bevestig dit." } };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("ai_interview_delete", { p_session: sessionId });
  if (error) return { error: dbError(error, "Verwijderen is niet gelukt.") };
  refresh(ideaId);
  return { error: null, ok: "Gesprek, beurten en interview zijn verwijderd. Het auditspoor noemt alleen dat het gebeurde." };
}
