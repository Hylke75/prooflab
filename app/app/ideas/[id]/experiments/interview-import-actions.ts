"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWritableIdea } from "@/lib/data";
import { CHANNELS } from "@/lib/domain/tracking";
import { RECRUITMENT_KEYS } from "@/lib/domain/recruitment";
import { interviewIntake } from "@/lib/domain/interview-intake";
import { fieldErrorsFrom, savedNothing } from "@/lib/domain/form-errors";
import { fictionSignals, fictionWarning } from "@/lib/domain/practice";
import { proposePseudonyms, type PseudonymItem } from "@/lib/domain/pseudonymize";
import { TRANSCRIPT_FORMATS, type Segment, type TranscriptFormat } from "@/lib/domain/transcript-parse";
import {
  DUPLICATE_IMPORT,
  heldOnError,
  IMPORT_SCHEMA_MISSING,
  missingImportSchema,
  parseDecisionsField,
  parseNamesField,
  participantLabelError,
  prepareImport,
  retentionFrom,
} from "@/lib/domain/interview-import";
import { todayInNL } from "@/lib/domain/sprint";
import { readSource } from "@/lib/interview-source";
import { withDefaultedFallback, withFields } from "@/lib/defaulted-fields";
import type { Json } from "@/lib/database.types";
import type { FormState } from "@/components/ui/ActionForm";

// Fase 1 · punt 3: transcripten importeren. Twee stappen:
// 1. parseInterviewFile: het bestand of de geplakte tekst uitlezen en een voorstel voor pseudonimisering maken.
//    Er wordt niets opgeslagen en er gaat niets naar een AI-dienst.
// 2. saveImportedInterview: na de controle door de consultant. De server leest de bron opnieuw, stelt het voorstel
//    opnieuw op, legt de keuzes eroverheen en controleert het resultaat. Alleen de gepseudonimiseerde tekst, de
//    segmenten (zonder tekst) en de labels met aantallen worden bewaard; het bestand en de originele namen niet.
// Met expId: een gesprek in een lopende interviewtest. Zonder expId: een verkennend interview (vanuit Markt) dat nooit
// over status of kans beslist.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedPreview = {
  format: TranscriptFormat;
  formatLabel: string;
  sourceLabel: string;
  segments: Segment[];
  proposal: PseudonymItem[];
  speakers: number;
  hasTimestamps: boolean;
  chars: number;
  warnings: string[];
  duplicate: boolean;
};
export type ParseResult = { error: string | null; field?: string; preview?: ParsedPreview };

async function checkTarget(ideaId: string, expId: string | null): Promise<{ error: string | null; testGroup: string | null }> {
  if (!UUID.test(ideaId) || (expId !== null && !UUID.test(expId))) return { error: "Onbekend dossier of onbekende test.", testGroup: null };
  if (!expId) return { error: null, testGroup: null };
  const supabase = await supabaseServer();
  const { data: exp } = await supabase.from("experiments").select("state, type, recruitment_group").eq("id", expId).eq("idea_id", ideaId).maybeSingle();
  if (!exp || exp.type !== "interview") return { error: "Interviewtest niet gevonden.", testGroup: null };
  if (!["live", "paused"].includes(exp.state)) return { error: "Interviews voeg je toe terwijl de interviewronde loopt. Importeer het anders als verkennend interview vanuit Markt.", testGroup: null };
  return { error: null, testGroup: exp.recruitment_group ?? null };
}

export async function parseInterviewFile(ideaId: string, expId: string | null, form: FormData): Promise<ParseResult> {
  try {
    await requireWritableIdea(ideaId);
  } catch {
    return { error: "Je kijkt mee als opdrachtgever: interviews importeert het onderzoeksteam." };
  }
  const target = await checkTarget(ideaId, expId);
  if (target.error) return { error: target.error };
  const src = await readSource(ideaId, form);
  if (!src.ok) return { error: src.error, field: src.field };
  const supabase = await supabaseServer();
  const { data: dup, error: dupError } = await supabase.from("interviews").select("id").eq("idea_id", ideaId).eq("source_hash", src.hash).limit(1);
  if (dupError && missingImportSchema(dupError)) return { error: IMPORT_SCHEMA_MISSING };
  const segments = src.parsed.segments;
  return {
    error: null,
    preview: {
      format: src.format,
      formatLabel: TRANSCRIPT_FORMATS[src.format],
      sourceLabel: src.label,
      segments,
      proposal: proposePseudonyms(segments),
      speakers: src.parsed.speakers.length,
      hasTimestamps: src.parsed.hasTimestamps,
      chars: segments.reduce((n, s) => n + s.text.length, 0),
      warnings: src.parsed.warnings,
      duplicate: (dup ?? []).length > 0,
    },
  };
}

const ImportSchema = z.object({
  participant_label: z.string().trim().max(80).min(2, "Gebruik een pseudoniem, bijv. 'Deelnemer A'."),
  dmu_role: z.enum(["user", "buyer", "payer", "decider", "influencer", "other"]),
  segment: z.string().trim().max(160).optional(),
  recruited_via: z.enum(Object.keys(CHANNELS) as [string, ...string[]]),
  held_on: z.string().date("Vul de datum van het gesprek in."),
  recruitment_group: z.union([z.enum(RECRUITMENT_KEYS), z.literal("")]).optional(),
  is_practice: z.enum(["real", "practice"], { error: "Geef aan of dit een echt gesprek of een oefening is." }).transform((v) => v === "practice"),
});

const MESSAGES: Partial<Record<string, string>> = {
  dmu_role: "Kies de rol in het koopproces.",
  recruited_via: "Kies via welk kanaal de deelnemer is geworven.",
  recruitment_group: "Kies een wervingsgroep.",
};

export async function saveImportedInterview(ideaId: string, expId: string | null, _: FormState, form: FormData): Promise<FormState> {
  try {
    await requireWritableIdea(ideaId);
  } catch {
    return { error: "Je kijkt mee als opdrachtgever: interviews importeert het onderzoeksteam." };
  }
  const target = await checkTarget(ideaId, expId);
  if (target.error) return { error: target.error };
  const p = ImportSchema.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  const fieldErrors: Record<string, string> = p.success ? {} : fieldErrorsFrom(p.error.issues, MESSAGES);
  if (p.success) {
    const dateError = heldOnError(p.data.held_on, todayInNL());
    if (dateError) fieldErrors.held_on = dateError;
  }
  // Toestemming alleen bij een echt gesprek (gebruikerstest C8): een oefening vraagt geen vinkje en telt nergens mee.
  const intake = interviewIntake({
    isPractice: p.success ? p.data.is_practice : form.get("is_practice") === "practice",
    consent: form.get("consent_recorded") === "on",
    recruitmentGroup: p.success ? p.data.recruitment_group : null,
    recruitedVia: p.success ? p.data.recruited_via : String(form.get("recruited_via") ?? ""),
    testGroup: target.testGroup,
  });
  if (intake.error && form.get("is_practice") === "real") fieldErrors.consent_recorded = intake.error;

  // De bron opnieuw lezen en de pseudonimisering hercontroleren; de browser stuurt alleen keuzes.
  const src = await readSource(ideaId, form);
  if (!src.ok) return { error: src.error, fieldErrors: { ...fieldErrors, [src.field ?? "file"]: src.error } };
  const prepared = prepareImport(src.parsed.segments, parseDecisionsField(form.get("decisions")), parseNamesField(form.get("extra_names")));
  if (!prepared.ok) return { error: `Het interview is niet opgeslagen: ${prepared.errors[0]}`, fieldErrors };
  if (p.success) {
    const labelError = participantLabelError(p.data.participant_label, prepared.decisions);
    if (labelError) fieldErrors.participant_label = labelError;
  }
  if (!p.success || Object.keys(fieldErrors).length) return { error: savedNothing("Het interview", fieldErrors), fieldErrors };

  const supabase = await supabaseServer();
  const row = {
    idea_id: ideaId,
    experiment_id: expId,
    participant_label: p.data.participant_label,
    dmu_role: p.data.dmu_role,
    segment: p.data.segment || null,
    recruited_via: p.data.recruited_via,
    held_on: p.data.held_on,
    record_type: "transcript",
    transcript: prepared.transcript,
    consent_recorded: intake.consent_recorded,
    is_practice: p.data.is_practice,
    recruitment_group: intake.recruitment_group,
    is_acquaintance: intake.is_acquaintance,
    source_format: src.format,
    source_hash: src.hash,
    segments: prepared.segments as unknown as Json,
    pseudonym_labels: prepared.labels as unknown as Json,
    // De database zet tijd en gebruiker zelf (stamp_interview_import) en rekent de bewaartermijn vanaf de gespreksdatum.
    pseudonymized_at: new Date().toISOString(),
    retention_until: retentionFrom(p.data.held_on),
  };
  // Zonder eigen keuze is de wervingsgroep afgeleid uit het kanaal (fase 1 · punt 1).
  const defaulted = p.data.recruitment_group ? [] : ["recruitment_group"];
  const { data, error } = await withDefaultedFallback((w) => supabase.from("interviews").insert(withFields(row, defaulted, w)).select("id").single());
  if (error?.code === "23505") return { error: DUPLICATE_IMPORT };
  if (error && missingImportSchema(error)) return { error: IMPORT_SCHEMA_MISSING };
  if (error || !data) return { error: "Het interview is niet opgeslagen. Probeer het opnieuw." };
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  // B0: een als echt aangegeven gesprek met woorden als "fictief" of "test": opgeslagen, maar controleer de keuze.
  const warn = p.data.is_practice ? null : fictionWarning(fictionSignals(`${p.data.participant_label}\n${prepared.transcript}`));
  const base = expId ? `/app/ideas/${ideaId}/experiments/${expId}/interviews/${data.id}` : `/app/ideas/${ideaId}/interviews/${data.id}`;
  redirect(`${base}?geimporteerd=1${warn ? "&controleer=1" : ""}`);
}
