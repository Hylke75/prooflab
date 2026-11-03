import "server-only";
import type { z } from "zod";
import { AiRefusedError, type AiUsage } from "./client";
import { costUsd, type ProviderId } from "./providers/config";
import { adapterFor } from "./providers";
import type { Effort, GenerateRequest, GenerateResult } from "./providers/types";

// Provider-independent helpers on top of the adapters: cost booking, refusals and schema validation are the
// same whichever provider answers.

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

export async function generate(provider: ProviderId, req: GenerateRequest, refusal = "Het model weigerde dit verzoek.") {
  const res = await adapterFor(provider).generate(req);
  const usage = usageOf(res);
  if (res.refused) throw new AiRefusedError(refusal, usage);
  return { res, usage };
}

export async function generateJson<T extends z.ZodType>(
  provider: ProviderId,
  opts: { schema: T; name: string; system: string; user: string; maxTokens: number; effort: Effort; refusal?: string },
): Promise<{ data: z.infer<T>; usage: AiUsage; model: string }> {
  const { res, usage } = await generate(
    provider,
    { system: opts.system, user: opts.user, maxTokens: opts.maxTokens, effort: opts.effort, json: { name: opts.name, schema: opts.schema } },
    opts.refusal,
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
