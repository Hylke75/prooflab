import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { PROMPT_VERSION } from "./client";
import { modelFor, type ProviderId } from "./providers/config";
import { log } from "@/lib/log";

// Every AI call is recorded with provider, model, prompt version, tokens and cost (never prompts or secrets).
// Fase B3: een aanroep zonder idee (het intakevoorstel) staat op de organisatie (orgId, idea_id leeg).
export async function logAiRun(input: {
  ideaId: string | null;
  orgId?: string | null;
  purpose: string;
  provider: ProviderId | null;
  outcome: "ok" | "rejected" | "refused" | "error";
  usage?: { cost: number; searches: number; inputTokens: number; outputTokens: number; provider?: ProviderId; model?: string };
  detail?: string;
}) {
  const supabase = await supabaseServer();
  const provider = input.usage?.provider ?? input.provider;
  const { error } = await supabase.from("ai_runs").insert({
    idea_id: input.ideaId,
    ...(input.ideaId ? {} : { org_id: input.orgId ?? null }),
    purpose: input.purpose,
    provider,
    model: (input.usage?.model ?? (provider ? modelFor(provider) : "geen")).slice(0, 120),
    prompt_version: PROMPT_VERSION,
    input_tokens: input.usage?.inputTokens ?? 0,
    output_tokens: input.usage?.outputTokens ?? 0,
    web_searches: input.usage?.searches ?? 0,
    cost_usd: Number((input.usage?.cost ?? 0).toFixed(4)),
    outcome: input.outcome,
    detail: input.detail?.slice(0, 500) ?? null,
  });
  // The ledger is what the monthly cap is checked against: a missing row must be visible to operations.
  if (error) await log.error("ai_ledger_insert_failed", { ideaId: input.ideaId, orgId: input.orgId ?? null, purpose: input.purpose, code: error.code });
}
