import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { AiBudgetError, AiNotConfiguredError, AiRefusedError, type AiUsage } from "./client";
import { logAiRun } from "./log";
import { log } from "@/lib/log";
import { PROVIDER_KEY_ENV, PROVIDER_LABELS, type ProviderId } from "./providers/config";
import { taskForPurpose } from "./providers/select";
import { AiProviderError } from "./providers/types";
import { aiSettingsForOrg, providerFor } from "./settings";
import { configuredProviders } from "@/lib/env";
import { pickProvider } from "./providers/select";

// Every AI call goes through here: the organisation's monthly cap (across all providers together) is checked
// against the ai_runs ledger (which users cannot edit or delete), and the call is always logged with its provider,
// including refusals and failures, by everyone who triggers it (consultants and clients alike).
//
// The provider is the organisation's choice for the task of this purpose (with fallback to any configured
// provider), unless the caller names one (ensembles: one runAi per provider).
export async function runAi<T extends { usage: AiUsage }>(
  ideaId: string,
  purpose: string,
  call: (provider: ProviderId) => Promise<T>,
  opts: { provider?: ProviderId } = {},
): Promise<T> {
  let provider: ProviderId | undefined = opts.provider;
  try {
    provider ??= await providerFor(ideaId, taskForPurpose(purpose));
    await assertAiBudget(ideaId);
    const result = await call(provider);
    await logAiRun({ ideaId, purpose, provider, outcome: "ok", usage: result.usage });
    return result;
  } catch (e) {
    if (e instanceof AiBudgetError) throw e;
    const outcome = e instanceof AiRefusedError ? "refused" : "error";
    // Refusals and a missing API key are expected states (warn); anything else is an incident (error).
    const expected = outcome === "refused" || e instanceof AiNotConfiguredError;
    await log[expected ? "warn" : "error"](
      "ai_call_failed",
      { ideaId, purpose, provider: provider ?? null, outcome, notConfigured: e instanceof AiNotConfiguredError, kind: e instanceof AiProviderError ? e.kind : null },
      e,
    );
    await logAiRun({
      ideaId,
      purpose,
      provider: provider ?? null,
      outcome,
      usage: e instanceof AiRefusedError ? e.usage : undefined,
      detail: String(e),
    });
    throw e;
  }
}

// Fase B3: een AI-aanroep vóórdat er een idee is (het voorstel uit de intake). Zelfde regels als runAi: het
// maandbudget van de organisatie wordt eerst gecontroleerd en elke aanroep komt in het grootboek, hier op de
// organisatie. Zonder de migratie 20261110090000_b3_intake.sql is er geen budgetcontrole per organisatie: dan
// gooit assertOrgAiBudget een AiBudgetError en valt de intake terug op het voorstel uit de regels.
export async function runOrgAi<T extends { usage: AiUsage }>(orgId: string, purpose: string, call: (provider: ProviderId) => Promise<T>): Promise<T> {
  let provider: ProviderId | undefined;
  try {
    const pick = pickProvider(await aiSettingsForOrg(orgId), taskForPurpose(purpose), configuredProviders());
    if (!pick) throw new AiNotConfiguredError();
    provider = pick.provider;
    await assertOrgAiBudget(orgId);
    const result = await call(provider);
    await logAiRun({ ideaId: null, orgId, purpose, provider, outcome: "ok", usage: result.usage });
    return result;
  } catch (e) {
    // Geen sleutel of geen budget: er is geen aanroep gedaan, dus niets te boeken.
    if (e instanceof AiBudgetError || e instanceof AiNotConfiguredError) throw e;
    const outcome = e instanceof AiRefusedError ? "refused" : "error";
    await log[outcome === "refused" ? "warn" : "error"](
      "ai_call_failed",
      { orgId, purpose, provider: provider ?? null, outcome, kind: e instanceof AiProviderError ? e.kind : null },
      e,
    );
    await logAiRun({ ideaId: null, orgId, purpose, provider: provider ?? null, outcome, usage: e instanceof AiRefusedError ? e.usage : undefined, detail: String(e) });
    throw e;
  }
}

export async function assertOrgAiBudget(orgId: string): Promise<void> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("org_ai_spend_for_org", { p_org: orgId });
  const row = data?.[0];
  if (error) await log.warn("ai_org_budget_check_failed", { orgId, code: error.code });
  if (error || !row) throw new AiBudgetError("Het AI-budget van deze werkruimte kon niet worden gecontroleerd.");
  if (Number(row.spent) >= Number(row.cap)) {
    throw new AiBudgetError(`Het AI-maandbudget van deze werkruimte ($${Number(row.cap).toFixed(0)}) is bereikt.`);
  }
}

export async function assertAiBudget(ideaId: string): Promise<void> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("org_ai_spend", { p_idea: ideaId });
  const row = data?.[0];
  if (error) await log.error("ai_budget_check_failed", { ideaId, code: error.code });
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
  if (e instanceof AiProviderError) {
    const name = PROVIDER_LABELS[e.provider].name;
    if (e.kind === "auth") return `${name} weigerde de API-sleutel. Controleer ${PROVIDER_KEY_ENV[e.provider]} in de Vercel-omgevingsvariabelen.`;
    if (e.kind === "rate_limit") return `${name} is even overbelast of de limiet van het account is bereikt. Probeer het later opnieuw.`;
    if (e.kind === "timeout") return `${name} reageerde niet op tijd. Probeer het later opnieuw.`;
  }
  return fallback;
}
