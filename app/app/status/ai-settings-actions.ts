"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/data";
import { log } from "@/lib/log";
import { PROVIDERS, PROVIDER_LABELS, modelFor } from "@/lib/ai/providers/config";
import { adapterFor, configuredProviders } from "@/lib/ai/providers";

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

// ---------------------------------------------------------------------------
// Connection test: one tiny question per connected provider
// ---------------------------------------------------------------------------

export type ConnectionResult = { provider: string; name: string; model: string; ok: boolean; ms: number; message: string };
export type ConnectionTestState = { error: string | null; results?: ConnectionResult[] };

// Sends each provider with a key a minimal prompt (a few tokens, no web search) and reports whether the key and
// the model work. Costs a fraction of a cent per provider; not booked against a dossier.
export async function testAiConnections(): Promise<ConnectionTestState> {
  const ws = await getWorkspace();
  if (!ws.org || ws.org.role !== "owner") return { error: "Alleen eigenaren van de werkruimte kunnen de verbindingen testen." };
  const connected = configuredProviders();
  const results = await Promise.all(
    PROVIDERS.map(async (p): Promise<ConnectionResult> => {
      const name = PROVIDER_LABELS[p].name;
      const model = modelFor(p);
      if (!connected.includes(p)) return { provider: p, name, model, ok: false, ms: 0, message: "Geen sleutel ingesteld." };
      const t0 = Date.now();
      try {
        // Lage denkstand en ruimte voor denktokens: met 64 tokens en de standaard (hoge) denkstand gaf Gemini een
        // leeg antwoord omdat alle tokens aan nadenken opgingen.
        const r = await adapterFor(p).generate({ system: "Dit is een verbindingstest.", user: "Antwoord alleen met het woord OK.", maxTokens: 1024, effort: "low", timeoutMs: 30000 });
        const ms = Date.now() - t0;
        const answer = r.text.trim().slice(0, 40);
        return { provider: p, name, model: r.model, ok: true, ms, message: answer ? `Antwoord: "${answer}"` : "Verbonden (leeg antwoord)." };
      } catch (e) {
        const message = e instanceof Error ? e.message : "Onbekende fout";
        log.warn("ai_connection_test_failed", { provider: p, model, message });
        return { provider: p, name, model, ok: false, ms: Date.now() - t0, message };
      }
    }),
  );
  return { error: null, results };
}
