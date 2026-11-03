import "server-only";
import type { z } from "zod";
import { AiBudgetError, AiRefusedError, type AiUsage } from "./client";
import { currentRunBudget } from "./budget";
import { costUsd, estimateCostUsd, estimateTokens, type ModelTier, type ProviderId } from "./providers/config";
import { adapterFor } from "./providers";
import type { Effort, GenerateRequest, GenerateResult } from "./providers/types";

// Provider-independent helpers on top of the adapters: cost booking, refusals, schema validation and the run
// budget are the same whichever provider answers.

export function usageOf(r: Pick<GenerateResult, "provider" | "model" | "usage">): AiUsage {
  return {
    cost: costUsd(r.provider, r.model, r.usage),
    searches: r.usage.searches,
    inputTokens: r.usage.inputTokens + (r.usage.cacheReadTokens ?? 0) + (r.usage.cacheWriteTokens ?? 0),
    outputTokens: r.usage.outputTokens,
    provider: r.provider,
    model: r.model,
  };
}

// Search content a provider adds to the input per web search when it does not loop in ProofLab (ChatGPT, Gemini).
const SEARCH_CONTENT_TOKENS = 10_000;

export async function generate(provider: ProviderId, req: GenerateRequest, refusal = "Het model weigerde dit verzoek.", tier: ModelTier = "main") {
  const adapter = adapterFor(provider, tier);
  const budget = currentRunBudget();
  // Claude's search loop checks the budget itself before every round (lib/ai/providers/anthropic.ts).
  if (budget && req.webSearch && provider === "anthropic") {
    const res = await adapter.generate({ ...req, budget });
    const usage = usageOf(res);
    if (res.refused) throw new AiRefusedError(refusal, usage);
    return { res, usage };
  }
  // Every other call: one reservation for the whole call, checked before it is made.
  const reservation = budget
    ? budget.reserve(
        estimateCostUsd(provider, adapter.model, {
          // The JSON schema travels with the request: a fixed allowance.
          inputTokens: estimateTokens(req.system + req.user) + (req.json ? 2000 : 0) + (req.webSearch ? req.webSearch.maxUses * SEARCH_CONTENT_TOKENS : 0),
          outputTokens: req.maxTokens,
          searches: req.webSearch?.maxUses ?? 0,
        }),
        "deze stap",
      )
    : null;
  if (budget && !reservation) throw new AiBudgetError(budget.hit ?? "Budget van deze run bereikt.");
  let res: GenerateResult;
  try {
    res = await adapter.generate(req);
  } catch (e) {
    // Unknown usage on a failed call: nothing to book.
    reservation?.settle(0);
    throw e;
  }
  const usage = usageOf(res);
  reservation?.settle(usage.cost);
  if (res.refused) throw new AiRefusedError(refusal, usage);
  return { res, usage };
}

export async function generateJson<T extends z.ZodType>(
  provider: ProviderId,
  opts: { schema: T; name: string; system: string; user: string; maxTokens: number; effort: Effort; refusal?: string; tier?: ModelTier },
): Promise<{ data: z.infer<T>; usage: AiUsage; model: string }> {
  const { res, usage } = await generate(
    provider,
    { system: opts.system, user: opts.user, maxTokens: opts.maxTokens, effort: opts.effort, json: { name: opts.name, schema: opts.schema } },
    opts.refusal,
    opts.tier,
  );
  // Validated here for every provider: the providers' own schema enforcement is a help, not the guarantee.
  const parsed = opts.schema.safeParse(res.json);
  if (!parsed.success) throw new Error("Ongeldige gestructureerde uitvoer van het model.");
  return { data: parsed.data as z.infer<T>, usage, model: res.model };
}

export async function generateText(
  provider: ProviderId,
  opts: { system: string; user: string; maxTokens: number; effort: Effort; refusal?: string },
): Promise<{ text: string; usage: AiUsage; model: string }> {
  const { res, usage } = await generate(provider, { system: opts.system, user: opts.user, maxTokens: opts.maxTokens, effort: opts.effort }, opts.refusal);
  return { text: res.text, usage, model: res.model };
}
