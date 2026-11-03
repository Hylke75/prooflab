"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/data";
import { log } from "@/lib/log";
import { PROVIDERS } from "@/lib/ai/providers/config";

export type AiSettingsState = { error: string | null; ok?: string | null };

const provider = z.enum(PROVIDERS);
const optional = z.union([provider, z.literal("")]).transform((v) => (v === "" ? null : v));

const Schema = z.object({
  default_provider: provider,
  research_provider: optional,
  coach_provider: optional,
  survey_provider: optional,
  promo_provider: optional,
  forecast_provider: optional,
  ensemble: z.literal("on").optional(),
});

// Saves the organisation's provider choice. Only which provider to use is stored; API keys stay in the server
// environment. The database (RLS) has the final say on who may write.
export async function saveAiSettings(_: AiSettingsState, form: FormData): Promise<AiSettingsState> {
  const ws = await getWorkspace();
  if (!ws.org || ws.org.role !== "owner") return { error: "Alleen eigenaren van de werkruimte kunnen de AI-aanbieders kiezen." };
  const v = Schema.safeParse(Object.fromEntries(form.entries()));
  if (!v.success) return { error: "Kies voor elke taak een geldige aanbieder." };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("org_ai_settings").upsert({
    org_id: ws.org.id,
    default_provider: v.data.default_provider,
    research_provider: v.data.research_provider,
    coach_provider: v.data.coach_provider,
    survey_provider: v.data.survey_provider,
    promo_provider: v.data.promo_provider,
    forecast_provider: v.data.forecast_provider,
    ensemble: v.data.ensemble === "on",
  });
  if (error) {
    await log.warn("ai_settings_save_failed", { code: error.code });
    return { error: "De keuze kon niet worden opgeslagen. Is migratie 20261105090000_ai_providers.sql toegepast?" };
  }
  revalidatePath("/app", "layout");
  return { error: null, ok: "AI-aanbieders opgeslagen." };
}
