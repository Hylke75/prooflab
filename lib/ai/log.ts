import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { MODEL, PROMPT_VERSION } from "./client";

// Every AI call is recorded with model, prompt version, tokens and cost (never prompts or secrets).
export async function logAiRun(input: {
  ideaId: string;
  purpose: string;
  outcome: "ok" | "rejected" | "refused" | "error";
  usage?: { cost: number; searches: number; inputTokens: number; outputTokens: number };
  detail?: string;
}) {
  const supabase = await supabaseServer();
  await supabase.from("ai_runs").insert({
    idea_id: input.ideaId,
    purpose: input.purpose,
    model: MODEL,
    prompt_version: PROMPT_VERSION,
    input_tokens: input.usage?.inputTokens ?? 0,
    output_tokens: input.usage?.outputTokens ?? 0,
    web_searches: input.usage?.searches ?? 0,
    cost_usd: Number((input.usage?.cost ?? 0).toFixed(4)),
    outcome: input.outcome,
    detail: input.detail?.slice(0, 500) ?? null,
  });
}
