import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { configuredProviders } from "@/lib/env";
import { log } from "@/lib/log";
import { AiNotConfiguredError } from "./client";
import type { ProviderId } from "./providers/config";
import { DEFAULT_AI_SETTINGS, ensembleProviders, pickProvider, settingsFromRow, type AiSettings, type AiTask } from "./providers/select";

// The organisation's provider choice (org_ai_settings). Without a row, or before the migration is applied, the
// defaults apply: Claude first, ensemble on. Keys are never stored; only which provider to use.

export async function aiSettingsForOrg(orgId: string): Promise<AiSettings> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("org_ai_settings").select("*").eq("org_id", orgId).maybeSingle();
  if (error) {
    await log.warn("ai_settings_unavailable", { code: error.code });
    return DEFAULT_AI_SETTINGS;
  }
  return settingsFromRow(data);
}

export async function aiSettingsForIdea(ideaId: string): Promise<AiSettings> {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("ideas").select("org_id").eq("id", ideaId).maybeSingle();
  return data?.org_id ? aiSettingsForOrg(data.org_id) : DEFAULT_AI_SETTINGS;
}

// The provider for one task of this idea's organisation, falling back to any configured provider.
export async function providerFor(ideaId: string, task: AiTask): Promise<ProviderId> {
  const pick = pickProvider(await aiSettingsForIdea(ideaId), task, configuredProviders());
  if (!pick) throw new AiNotConfiguredError();
  return pick.provider;
}

// All providers for a task that may run on several (web research, forecast), chosen one first.
export async function providersFor(ideaId: string, task: AiTask): Promise<ProviderId[]> {
  const list = ensembleProviders(await aiSettingsForIdea(ideaId), task, configuredProviders());
  if (list.length === 0) throw new AiNotConfiguredError();
  return list;
}
