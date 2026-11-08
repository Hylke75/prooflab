"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWritableIdea } from "@/lib/data";
import { aiConfigured } from "@/lib/env";
import { aiErrorMessage, runAi } from "@/lib/ai/guard";
import { suggestInterviewThemes } from "@/lib/ai/research";
import { cleanThemeLabel, filterThemeProposals, findCode, MAX_THEME_WINDOWS, mergeThemeFilters, THEMES_NEVER_COUNT, type ThemeFilter } from "@/lib/domain/themes";
import { RESPONDENT_SPEAKER } from "@/lib/domain/ai-interview";
import { displaySegments, PURGED_TRANSCRIPT } from "@/lib/domain/quote-marking";
import { transcriptWindows } from "@/lib/domain/transcript-parse";
import { missingImportSchema } from "@/lib/domain/interview-import";
import type { FormState } from "@/components/ui/ActionForm";

// Fase 1 · punt 3: thema's. Een AI-voorstel ziet alleen gepseudonimiseerde tekst, in vensters; alleen thema's met
// letterlijk teruggevonden citaten (met positie) blijven. Een AI-thema en elke AI-toewijzing zijn een voorstel tot de
// consultant ze accepteert. Thema's tellen nooit mee in de kans: ze worden nergens aan een aanname gekoppeld.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCHEMA_MISSING = "Thema's vragen een database-update (migratie 20261115090000_interviews_import).";
const refresh = (ideaId: string) => revalidatePath(`/app/ideas/${ideaId}`, "layout");

export async function suggestThemes(ideaId: string, interviewId: string, _: FormState): Promise<FormState> {
  await requireWritableIdea(ideaId);
  if (!UUID.test(interviewId)) return { error: "Interview niet gevonden." };
  if (!aiConfigured()) return { error: "AI is niet verbonden. Maak thema's zelf en wijs ze toe aan gemarkeerde citaten." };
  const supabase = await supabaseServer();
  const { data } = await supabase.from("interviews").select("*").eq("id", interviewId).eq("idea_id", ideaId).maybeSingle();
  const iv = data as (typeof data & { segments?: unknown; pseudonymized_at?: string | null }) | null;
  if (!iv) return { error: "Interview niet gevonden." };
  if (iv.transcript === PURGED_TRANSCRIPT) return { error: "Het transcript is verwijderd na afloop van de bewaartermijn." };
  // Geen AI vóór pseudonimisering: een zelf geplakt transcript gaat niet naar een AI-dienst voor thema's.
  if (!iv.pseudonymized_at) return { error: "Dit transcript is niet door ProofLab gepseudonimiseerd. Importeer het opnieuw (met pseudonimisering) om AI-thema's te gebruiken." };
  const [{ data: codes, error: codesError }, { data: idea }, { data: question }] = await Promise.all([
    supabase.from("interview_codes").select("id, label, status").eq("idea_id", ideaId),
    supabase.from("ideas").select("decision_question").eq("id", ideaId).maybeSingle(),
    iv.experiment_id ? supabase.from("experiments").select("hypotheses(we_believe)").eq("id", iv.experiment_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (codesError && missingImportSchema(codesError)) return { error: SCHEMA_MISSING };
  const segments = displaySegments(iv.transcript, iv.segments);
  const windows = transcriptWindows(iv.transcript, segments.map((s) => ({ charStart: s.a, charEnd: s.b }))).slice(0, MAX_THEME_WINDOWS);
  const focus = question?.hypotheses?.we_believe ?? idea?.decision_question ?? "";
  const existing = (codes ?? []).filter((c) => c.status !== "rejected").map((c) => c.label);
  const parts: ThemeFilter[] = [];
  try {
    for (const w of windows) {
      const res = await runAi(ideaId, "interview_themes", (p) => suggestInterviewThemes(focus, iv.transcript.slice(w.start, w.end), existing, p));
      parts.push(filterThemeProposals(res.data.themes, iv.transcript, segments, w));
    }
  } catch (e) {
    if (!parts.length) return { error: aiErrorMessage(e, "Er konden geen thema's worden voorgesteld. Maak ze zelf.") };
  }
  const result = mergeThemeFilters(parts);
  // AI-gemodereerd interview: alleen citaten uit antwoorden van de respondent (vragen van de AI tellen nooit).
  if ((iv as { ai_moderated?: boolean }).ai_moderated) {
    for (const t of result.themes) t.quotes = t.quotes.filter((q) => segments[q.segmentIndex]?.s === RESPONDENT_SPEAKER);
    result.themes = result.themes.filter((t) => t.quotes.length > 0);
  }

  const { data: existingObs } = await supabase.from("observations").select("id, quote_start, quote_end").eq("interview_id", interviewId);
  let newThemes = 0;
  let assigned = 0;
  let skipped = 0;
  const known = [...(codes ?? [])];
  for (const t of result.themes) {
    let code = findCode(known, t.label);
    // Een eerder afgewezen thema komt niet terug.
    if (code?.status === "rejected") {
      skipped++;
      continue;
    }
    if (!code) {
      const { data: created, error } = await supabase.from("interview_codes").insert({ idea_id: ideaId, label: t.label, description: t.description || null, origin: "ai" }).select("id, label, status").single();
      if (error || !created) continue;
      code = created;
      known.push(created);
      newThemes++;
    }
    for (const q of t.quotes) {
      // Een citaat op precies dezelfde plek hergebruiken; anders een thema-citaat (telt nergens mee).
      let obsId = (existingObs ?? []).find((o) => o.quote_start === q.start && o.quote_end === q.end)?.id;
      if (!obsId) {
        const { data: obs } = await supabase
          .from("observations")
          .insert({
            idea_id: ideaId,
            experiment_id: iv.experiment_id,
            interview_id: interviewId,
            kind: "other",
            summary: t.label.slice(0, 400),
            quote: q.quote,
            quote_check: "exact",
            origin: "ai",
            theme_only: true,
            quote_start: q.start,
            quote_end: q.end,
            segment_index: q.segmentIndex,
          })
          .select("id")
          .single();
        if (!obs) continue;
        obsId = obs.id;
        existingObs?.push({ id: obs.id, quote_start: q.start, quote_end: q.end });
      }
      const { error } = await supabase.from("observation_codes").insert({ observation_id: obsId, code_id: code.id, idea_id: ideaId, origin: "ai" });
      if (!error) assigned++;
    }
  }
  refresh(ideaId);
  const dropped = result.notFound + result.invalidLabels;
  return {
    error: null,
    ok: `${newThemes} nieuwe thema's voorgesteld, ${assigned} citaten toegewezen${skipped ? `; ${skipped} eerder afgewezen thema's overgeslagen` : ""}${dropped ? `; ${dropped} voorstellen afgewezen omdat het citaat niet letterlijk in het transcript stond` : ""}. Beoordeel ze.`,
    warning: THEMES_NEVER_COUNT,
  };
}

const CodeSchema = z.object({
  label: z.string().trim().min(3, "Een thema is 3–80 tekens.").max(80, "Een thema is 3–80 tekens."),
  description: z.string().trim().max(400).optional(),
});

export async function createThemeCode(ideaId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireWritableIdea(ideaId);
  const p = CodeSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message, fieldErrors: { label: p.error.issues[0].message } };
  const label = cleanThemeLabel(p.data.label);
  if (!label) return { error: "Een thema is 3–80 tekens.", fieldErrors: { label: "Een thema is 3–80 tekens." } };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("interview_codes").insert({ idea_id: ideaId, label, description: p.data.description || null, origin: "manual" });
  if (error?.code === "23505") return { error: "Dit thema bestaat al.", fieldErrors: { label: "Dit thema bestaat al." } };
  if (error && missingImportSchema(error)) return { error: SCHEMA_MISSING };
  if (error) return { error: "Het thema kon niet worden opgeslagen." };
  refresh(ideaId);
  return { error: null, ok: `Thema "${label}" toegevoegd. Wijs het toe aan citaten.` };
}

// Een AI-thema accepteren of afwijzen (één keer; de database legt wie en wanneer vast).
export async function reviewThemeCode(ideaId: string, codeId: string, status: "accepted" | "rejected") {
  await requireWritableIdea(ideaId);
  if (!UUID.test(codeId) || (status !== "accepted" && status !== "rejected")) return;
  const supabase = await supabaseServer();
  await supabase.from("interview_codes").update({ status }).eq("id", codeId).eq("idea_id", ideaId).eq("status", "proposed");
  refresh(ideaId);
}

// Een AI-toewijzing (thema ↔ citaat) accepteren of afwijzen. Alleen een geaccepteerde telt in "X van N".
export async function reviewThemeAssignment(ideaId: string, observationId: string, codeId: string, status: "accepted" | "rejected") {
  await requireWritableIdea(ideaId);
  if (!UUID.test(observationId) || !UUID.test(codeId) || (status !== "accepted" && status !== "rejected")) return;
  const supabase = await supabaseServer();
  await supabase.from("observation_codes").update({ review_status: status }).eq("observation_id", observationId).eq("code_id", codeId).eq("idea_id", ideaId).eq("origin", "ai").is("review_status", null);
  refresh(ideaId);
}

// Alle open AI-toewijzingen van één thema in dit gesprek in één keer accepteren (nog steeds een menselijke keuze).
export async function acceptThemeAssignments(ideaId: string, interviewId: string, codeId: string) {
  await requireWritableIdea(ideaId);
  if (!UUID.test(interviewId) || !UUID.test(codeId)) return;
  const supabase = await supabaseServer();
  const { data: obs } = await supabase.from("observations").select("id").eq("interview_id", interviewId).eq("idea_id", ideaId);
  const ids = (obs ?? []).map((o) => o.id);
  if (ids.length) {
    await supabase.from("observation_codes").update({ review_status: "accepted" }).eq("code_id", codeId).eq("idea_id", ideaId).eq("origin", "ai").is("review_status", null).in("observation_id", ids);
  }
  refresh(ideaId);
}

// Handmatig een thema toewijzen aan een citaat uit een interview (telt meteen mee in "X van N", nooit in de kans).
export async function assignThemeCode(ideaId: string, observationId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireWritableIdea(ideaId);
  const codeId = String(form.get("code_id") ?? "");
  if (!UUID.test(observationId) || !UUID.test(codeId)) return { error: "Kies een thema." };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("observation_codes").insert({ observation_id: observationId, code_id: codeId, idea_id: ideaId, origin: "manual" });
  if (error?.code === "23505") return { error: "Dit thema hoort al bij dit citaat." };
  if (error && missingImportSchema(error)) return { error: SCHEMA_MISSING };
  if (error) return { error: "Het thema kon niet worden toegewezen." };
  refresh(ideaId);
  return { error: null, ok: "Thema toegewezen." };
}

export async function removeThemeAssignment(ideaId: string, observationId: string, codeId: string) {
  await requireWritableIdea(ideaId);
  if (!UUID.test(observationId) || !UUID.test(codeId)) return;
  const supabase = await supabaseServer();
  await supabase.from("observation_codes").delete().eq("observation_id", observationId).eq("code_id", codeId).eq("idea_id", ideaId).eq("origin", "manual");
  refresh(ideaId);
}
