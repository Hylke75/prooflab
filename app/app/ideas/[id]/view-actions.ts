"use server";

import { revalidatePath } from "next/cache";
import { requireWritableIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { missingColumn } from "@/lib/research-questions-data";
import { parseDetailLevel } from "@/lib/view-mode";

export type SetDetailLevelResult = { error: string | null };

// Fase 1 · punt 1: de stand van het dossier wisselen (Snel of Grondig). Alleen voor wie mag schrijven; alleen
// weergave, dus geen herberekening. De database laat updated_at staan en zet de wissel in het auditspoor.
export async function setDetailLevel(ideaId: string, level: unknown): Promise<SetDetailLevelResult> {
  const parsed = parseDetailLevel(level);
  if (!parsed) return { error: "Kies Snel of Grondig." };
  try {
    await requireWritableIdea(ideaId);
  } catch {
    return { error: "Alleen het onderzoeksteam kan de weergave van dit dossier wisselen." };
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.from("ideas").update({ detail_level: parsed }).eq("id", ideaId);
  if (error) {
    // Zolang de migratie 20261114090000_fase1_weergave.sql niet is toegepast, bestaat de kolom niet: dan blijft alles Grondig.
    if (missingColumn(error)) return { error: "De weergave kan nog niet worden bewaard (databasemigratie ontbreekt). Het dossier blijft op Grondig." };
    return { error: "De weergave is niet gewisseld. Probeer het opnieuw." };
  }
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  return { error: null };
}
