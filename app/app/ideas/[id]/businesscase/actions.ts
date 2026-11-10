"use server";

import { requireWritableIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { BusinessCaseSchema, firstIssue } from "@/lib/business-case-schema";
import { BUSINESS_CASE_VERSION, unitEconomicsFromCase, type BusinessCaseInputs } from "@/lib/domain/business-case";
import { log } from "@/lib/log";

export type SaveResult = { ok: true; savedAt: string } | { ok: false; error: string };

const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

// Automatisch opslaan (businesscase): de hele invoer in één keer, strikt gecontroleerd. De zes velden die ook in
// Financiële haalbaarheid staan, worden daar meegeschreven zodat rapport en marktpotentieel hetzelfde zeggen.
export async function saveBusinessCase(ideaId: string, raw: unknown): Promise<SaveResult> {
  try {
    await requireWritableIdea(ideaId);
  } catch {
    return { ok: false, error: "Je hebt alleen leesrechten op dit idee; wijzigingen worden niet bewaard." };
  }
  const parsed = BusinessCaseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const inputs = parsed.data as BusinessCaseInputs;
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  const savedAt = new Date().toISOString();
  const { error } = await supabase
    .from("business_cases")
    .upsert({ idea_id: ideaId, inputs, version: BUSINESS_CASE_VERSION, updated_at: savedAt, updated_by: auth.user?.id ?? null });
  if (error) {
    if (MISSING_TABLE.has(error.code ?? "")) return { ok: false, error: "Opslaan kan nog niet: de databasemigratie voor de businesscase ontbreekt. Je berekening blijft zichtbaar tot je de pagina verlaat." };
    log.error("business_case_save_failed", { ideaId, code: error.code });
    return { ok: false, error: "Opslaan mislukt. Controleer je verbinding; we proberen het bij de volgende wijziging opnieuw." };
  }
  const ue = unitEconomicsFromCase(inputs);
  if (Object.keys(ue).length > 0) {
    const { error: ueError } = await supabase.from("unit_economics").upsert({ idea_id: ideaId, ...ue, updated_at: savedAt });
    if (ueError) log.error("business_case_ue_sync_failed", { ideaId, code: ueError.code });
  }
  return { ok: true, savedAt };
}
