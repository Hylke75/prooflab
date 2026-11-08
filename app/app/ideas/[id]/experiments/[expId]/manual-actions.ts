"use server";

// Experimentencatalogus: ruwe resultaten van een handmatig sjabloon invoeren en intrekken. Alleen het onderzoeksteam
// (requireWritableIdea en RLS can_write_idea). De database bewaakt dezelfde regels (guard_manual_result): alleen bij
// een lopende test, een datum tussen de start en vandaag, en na het afronden ligt alles vast.

import { revalidatePath } from "next/cache";
import { requireWritableIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { schemaMissing } from "@/lib/action-counts-data";
import {
  EVIDENCE_BUCKET,
  EVIDENCE_MAX_BYTES,
  MANUAL_SCHEMA_MISSING,
  evidenceFileName,
  sniffEvidence,
  validateManualEntry,
  validateWithdrawReason,
} from "@/lib/domain/manual-results";
import { todayInNL } from "@/lib/domain/sprint";
import type { FormState } from "@/components/ui/ActionForm";

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const refresh = (ideaId: string, expId: string) => {
  revalidatePath(`/app/ideas/${ideaId}/experiments/${expId}`);
  revalidatePath(`/app/ideas/${ideaId}/experiments`);
};

function dbMessage(error: { message: string; code?: string }): string {
  if (schemaMissing(error)) return MANUAL_SCHEMA_MISSING;
  if (error.message.includes("MANUAL_RESULT_CLOSED")) return "Resultaten voer je in terwijl de test loopt of gepauzeerd is. Na het afronden ligt alles vast.";
  if (error.message.includes("MANUAL_RESULT_DATE")) return "De waarneming moet tussen de start van de test en vandaag liggen.";
  if (error.message.includes("MANUAL_RESULT_EVIDENCE")) return "Het bewijsbestand kon niet aan deze regel worden gekoppeld. Upload het opnieuw.";
  if (error.message.includes("MANUAL_RESULT_LOCKED")) return "Een ingevoerd resultaat ligt vast; intrekken kan alleen terwijl de test loopt, met een reden.";
  if (error.message.includes("MANUAL_RESULT_TYPE")) return "Handmatige resultaten horen bij een handmatig sjabloon.";
  return "Het resultaat kon niet worden opgeslagen. Probeer het opnieuw.";
}

const int = (v: FormDataEntryValue | null): number | null => {
  const s = String(v ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
};

export async function addManualResult(ideaId: string, expId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireWritableIdea(ideaId);
  if (!isUuid(expId)) return { error: "Experiment niet gevonden." };
  const supabase = await supabaseServer();
  const { data: exp } = await supabase.from("experiments").select("id, type, state, started_at").eq("id", expId).eq("idea_id", ideaId).maybeSingle();
  if (!exp || exp.type !== "manual") return { error: "Handmatige resultaten horen bij een handmatig sjabloon." };
  if (exp.state !== "live" && exp.state !== "paused") return { error: "Resultaten voer je in terwijl de test loopt of gepauzeerd is. Na het afronden ligt alles vast." };
  const file = form.get("evidence");
  const upload = file instanceof File && file.size > 0 ? file : null;
  // Het opgegeven type van een bestand zegt weinig: het type volgt uit de inhoud (alleen gelezen als het niet te groot is).
  const bytes = upload && upload.size <= EVIDENCE_MAX_BYTES ? new Uint8Array(await upload.arrayBuffer()) : null;
  const mime = bytes && upload ? sniffEvidence(bytes, upload.type) : null;
  const input = {
    observed_on: String(form.get("observed_on") ?? ""),
    units: int(form.get("units")),
    successes: int(form.get("successes")),
    note: String(form.get("note") ?? ""),
    today: todayInNL(),
    startedOn: exp.started_at ? todayInNL(new Date(exp.started_at)) : null,
    evidence: upload ? { mime: mime ?? "onbekend", size: upload.size } : null,
  };
  const fieldErrors = validateManualEntry(input);
  if (Object.keys(fieldErrors).length) return { error: "Het resultaat is nog niet opgeslagen: controleer de gemarkeerde velden.", fieldErrors };

  let path: string | null = null;
  if (bytes && mime) {
    path = `${ideaId}/${expId}/${crypto.randomUUID()}-${evidenceFileName(upload?.name || "bewijs", mime)}`;
    const up = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
    if (up.error) return { error: "Uploaden kan nu niet. Is de bucket manual-evidence aangemaakt (migratie 20261118100000_experiment_catalog)? Sla de regel zonder bestand op of probeer het later opnieuw." };
  }
  const { error } = await supabase.from("manual_results").insert({
    experiment_id: expId,
    idea_id: ideaId,
    observed_on: input.observed_on,
    units: input.units as number,
    successes: input.successes as number,
    note: input.note.trim().slice(0, 1000),
    evidence_path: path,
    evidence_mime: path ? mime : null,
    evidence_size: path && bytes ? bytes.length : null,
  });
  if (error) {
    if (path) await supabase.storage.from(EVIDENCE_BUCKET).remove([path]);
    return { error: dbMessage(error) };
  }
  refresh(ideaId, expId);
  return { error: null, ok: `Vastgelegd: ${input.successes} van ${input.units}, handmatig ingevoerd${path ? " met bewijsbestand" : ""}. Het oordeel volgt pas na de eindconditie.` };
}

export async function withdrawManualResult(ideaId: string, expId: string, resultId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireWritableIdea(ideaId);
  if (!isUuid(expId) || !isUuid(resultId)) return { error: "Resultaat niet gevonden." };
  const reason = String(form.get("withdraw_reason") ?? "").trim();
  const problem = validateWithdrawReason(reason);
  if (problem) return { error: problem, fieldErrors: { withdraw_reason: problem } };
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("manual_results")
    .update({ withdraw_reason: reason.slice(0, 600), withdrawn_at: new Date().toISOString() })
    .eq("id", resultId)
    .eq("experiment_id", expId)
    .eq("idea_id", ideaId)
    .is("withdrawn_at", null)
    .select("id");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "Deze regel is al ingetrokken of bestaat niet meer." };
  refresh(ideaId, expId);
  return { error: null, ok: "Ingetrokken. De regel blijft zichtbaar met de reden, maar telt niet meer mee." };
}
