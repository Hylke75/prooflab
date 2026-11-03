import "server-only";
import { configuredProviders, providerKey } from "@/lib/env";
import { modelFor, type ModelTier, type ProviderId } from "./config";
import { createAnthropicAdapter } from "./anthropic";
import { createGeminiAdapter } from "./gemini";
import { createOpenAiAdapter } from "./openai";
import type { ProviderAdapter } from "./types";
import { AiNotConfiguredError } from "../client";

const cache = new Map<string, ProviderAdapter>();

// The adapter for a provider with this environment's key and model. Throws AiNotConfiguredError without a key.
// tier "research" gives the provider's cheaper model for searching and reading.
export function adapterFor(provider: ProviderId, tier: ModelTier = "main"): ProviderAdapter {
  const key = providerKey(provider);
  if (!key) throw new AiNotConfiguredError(provider);
  const model = modelFor(provider, process.env, tier);
  const k = `${provider}:${model}`;
  let a = cache.get(k);
  if (!a) {
    a =
      provider === "anthropic"
        ? createAnthropicAdapter({ apiKey: key, model })
        : provider === "openai"
          ? createOpenAiAdapter({ apiKey: key, model })
          : createGeminiAdapter({ apiKey: key, model });
    cache.set(k, a);
  }
  return a;
}

export { configuredProviders };
