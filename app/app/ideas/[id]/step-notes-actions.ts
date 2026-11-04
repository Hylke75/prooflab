"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ui/ActionForm";
import { getIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import {
  BUCKET,
  DOC_DESCRIPTION_MAX,
  displayFileName,
  isNoteStep,
  NOTE_BODY_MAX,
  NOTE_TITLE_MAX,
  parseStoragePath,
  storagePath,
  validateFile,
  type NoteStep,
} from "@/lib/domain/step-files";

// Eigen notities en documenten per stap. Alle schrijfacties lopen met de sessie van de gebruiker, dus row level
// security en de storage-policies gelden altijd; de controles hieronder geven daarbovenop een duidelijke melding.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READ_ONLY = "Je kijkt mee als opdrachtgever: notities en documenten toevoegen of wijzigen doet het onderzoeksteam.";
const NOT_YOURS = "Je kunt alleen je eigen notities en documenten wijzigen of verwijderen (de eigenaar van de werkruimte kan alles).";

async function writable(ideaId: string): Promise<string | null> {
  if (!UUID.test(ideaId)) return "Onbekend idee.";
  const { canWrite } = await getIdea(ideaId);
  return canWrite ? null : READ_ONLY;
}

function done(ideaId: string, ok: string): FormState {
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  return { error: null, ok };
}

const text = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

// ---------------------------------------------------------------------------
// Notities
// ---------------------------------------------------------------------------

export async function saveStepNote(ideaId: string, step: NoteStep, noteId: string | null, _: FormState, form: FormData): Promise<FormState> {
  const denied = await writable(ideaId);
  if (denied) return { error: denied };
  if (!isNoteStep(step) || (noteId !== null && !UUID.test(noteId))) return { error: "Onbekende stap of notitie." };
  const title = text(form.get("title")).trim();
  const body = text(form.get("body")).replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  const fieldErrors: Record<string, string> = {};
  if (title.length > NOTE_TITLE_MAX) fieldErrors.title = `De titel is te lang (${title.length} van ${NOTE_TITLE_MAX} tekens).`;
  if (!body.trim()) fieldErrors.body = "Schrijf eerst de tekst van de notitie.";
  else if (body.length > NOTE_BODY_MAX) fieldErrors.body = `De tekst is te lang (${body.length.toLocaleString("nl-NL")} van ${NOTE_BODY_MAX.toLocaleString("nl-NL")} tekens).`;
  if (Object.keys(fieldErrors).length) return { error: "De notitie is nog niet opgeslagen.", fieldErrors };

  const supabase = await supabaseServer();
  if (noteId) {
    const { data, error } = await supabase.from("step_notes").update({ title, body }).eq("id", noteId).eq("idea_id", ideaId).select("id");
    if (error) return { error: "Opslaan mislukt. Probeer het opnieuw." };
    if (!data?.length) return { error: NOT_YOURS };
    return done(ideaId, "Notitie bijgewerkt.");
  }
  const { error } = await supabase.from("step_notes").insert({ idea_id: ideaId, step, title, body });
  if (error) return { error: "Opslaan mislukt. Probeer het opnieuw." };
  return done(ideaId, "Notitie toegevoegd.");
}

export async function deleteStepNote(ideaId: string, noteId: string): Promise<FormState> {
  const denied = await writable(ideaId);
  if (denied) return { error: denied };
  if (!UUID.test(noteId)) return { error: "Onbekende notitie." };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("step_notes").delete().eq("id", noteId).eq("idea_id", ideaId).select("id");
  if (error) return { error: "Verwijderen mislukt. Probeer het opnieuw." };
  if (!data?.length) return { error: NOT_YOURS };
  return done(ideaId, "Notitie verwijderd.");
}

// ---------------------------------------------------------------------------
// Documenten
// ---------------------------------------------------------------------------

export type UploadTicket = { error: string } | { error: null; path: string; token: string; signedUrl: string; mime: string };

// Stap 1: de server controleert naam, grootte en type en maakt een pad en een eenmalige uploadlink. De link wordt
// gemaakt met de sessie van de gebruiker, dus de storage-policy (mag schrijven in dit dossier) geldt ook hier.
export async function prepareStepUpload(ideaId: string, step: NoteStep, file: { name: string; size: number; type: string }): Promise<UploadTicket> {
  const denied = await writable(ideaId);
  if (denied) return { error: denied };
  if (!isNoteStep(step)) return { error: "Onbekende stap." };
  const check = validateFile(file);
  if (!check.ok) return { error: check.error };
  const path = storagePath(ideaId, step, crypto.randomUUID(), file.name);
  const supabase = await supabaseServer();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    log.warn("step_document.upload_url_failed", { ideaId, step, code: error?.name });
    return { error: "Uploaden kan nu niet. Staat Storage aan en is de bucket step-documents aangemaakt? Probeer het later opnieuw." };
  }
  return { error: null, path, token: data.token, signedUrl: data.signedUrl, mime: check.mime };
}

// Stap 2: na het uploaden legt de server de gegevens vast. Hij controleert het pad (hoort bij dit idee en deze stap)
// en leest grootte en type van het opgeslagen bestand zelf; klopt iets niet, dan verdwijnt het bestand weer.
export async function recordStepDocument(ideaId: string, step: NoteStep, path: string, originalName: string, description: string): Promise<FormState> {
  const denied = await writable(ideaId);
  if (denied) return { error: denied };
  const parsed = parseStoragePath(path);
  if (!isNoteStep(step) || !parsed || parsed.ideaId !== ideaId.toLowerCase() || parsed.step !== step) return { error: "Het pad van het document klopt niet." };
  const desc = description.trim();
  if (desc.length > DOC_DESCRIPTION_MAX) return { error: `De omschrijving is te lang (${desc.length} van ${DOC_DESCRIPTION_MAX} tekens).`, fieldErrors: { description: "Maak de omschrijving korter." } };

  const supabase = await supabaseServer();
  const folder = `${parsed.ideaId}/${parsed.step}`;
  const objectName = path.slice(folder.length + 1);
  const { data: list, error: listError } = await supabase.storage.from(BUCKET).list(folder, { search: parsed.id, limit: 5 });
  const obj = list?.find((o) => o.name === objectName);
  if (listError || !obj) return { error: "Het bestand is niet aangekomen. Probeer het opnieuw." };
  const meta = (obj.metadata ?? {}) as { size?: number; mimetype?: string };
  const fileName = displayFileName(originalName);
  const check = validateFile({ name: fileName, size: Number(meta.size ?? 0), type: meta.mimetype ?? "" });
  const removeObject = async () => {
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) log.warn("step_document.cleanup_failed", { ideaId, step });
  };
  if (!check.ok) {
    await removeObject();
    return { error: check.error };
  }
  const { error } = await supabase.from("step_documents").insert({
    idea_id: ideaId,
    step,
    storage_path: path,
    file_name: fileName,
    mime_type: check.mime,
    size_bytes: Number(meta.size),
    description: desc || null,
  });
  if (error) {
    await removeObject();
    return { error: "Het document kon niet worden vastgelegd. Probeer het opnieuw." };
  }
  return done(ideaId, `Document "${fileName}" toegevoegd.`);
}

export async function deleteStepDocument(ideaId: string, docId: string): Promise<FormState> {
  const denied = await writable(ideaId);
  if (denied) return { error: denied };
  if (!UUID.test(docId)) return { error: "Onbekend document." };
  const supabase = await supabaseServer();
  const { data: doc } = await supabase.from("step_documents").select("id, storage_path, created_by").eq("id", docId).eq("idea_id", ideaId).maybeSingle();
  if (!doc) return { error: "Dit document bestaat niet meer." };
  const { data: allowed } = await supabase.rpc("can_edit_step_item", { p_idea: ideaId, p_created_by: doc.created_by });
  if (!allowed) return { error: NOT_YOURS };
  // Eerst het bestand, dan de rij: zo blijft er nooit een bestand achter zonder vermelding in het dossier.
  const { error: removeError } = await supabase.storage.from(BUCKET).remove([doc.storage_path]);
  if (removeError) return { error: "Het bestand kon niet worden verwijderd. Probeer het opnieuw." };
  const { data, error } = await supabase.from("step_documents").delete().eq("id", docId).eq("idea_id", ideaId).select("id");
  if (error || !data?.length) {
    log.warn("step_document.row_delete_failed", { ideaId, docId });
    return { error: "Het bestand is verwijderd, maar de vermelding niet. Probeer het opnieuw." };
  }
  return done(ideaId, "Document verwijderd.");
}
