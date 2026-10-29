import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { AiBudgetError, AiNotConfiguredError, AiRefusedError, type AiUsage } from "./client";
import { logAiRun } from "./log";

// Every AI call goes through here: the organisation's monthly cap is checked against the ai_runs
// ledger (which users cannot edit or delete), and the call is always logged, including refusals
// and failures, by everyone who triggers it (consultants and clients alike).
export async function runAi<T extends { usage: AiUsage }>(ideaId: string, purpose: string, call: () => Promise<T>): Promise<T> {
  await assertAiBudget(ideaId);
  try {
    const result = await call();
    await logAiRun({ ideaId, purpose, outcome: "ok", usage: result.usage });
    return result;
  } catch (e) {
    await logAiRun({
      ideaId,
      purpose,
      outcome: e instanceof AiRefusedError ? "refused" : "error",
      usage: e instanceof AiRefusedError ? e.usage : undefined,
      detail: String(e),
    });
    throw e;
  }
}

export async function assertAiBudget(ideaId: string): Promise<void> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("org_ai_spend", { p_idea: ideaId });
  const row = data?.[0];
  if (error || !row) throw new AiBudgetError("Geen toegang tot het AI-budget van dit dossier.");
  if (Number(row.spent) >= Number(row.cap)) {
    throw new AiBudgetError(
      `Het AI-maandbudget van deze werkruimte ($${Number(row.cap).toFixed(0)}) is bereikt. Werk handmatig verder of verhoog het budget.`,
    );
  }
}

// A user-facing sentence for a failed AI step.
export function aiErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof AiBudgetError) return e.message;
  if (e instanceof AiNotConfiguredError) return "AI is niet verbonden in deze omgeving.";
  if (e instanceof AiRefusedError) return "Het model weigerde deze stap. Werk handmatig verder.";
  return fallback;
}
