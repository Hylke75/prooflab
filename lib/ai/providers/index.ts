import "server-only";
import { configuredProviders, providerKey } from "@/lib/env";
import { modelFor, type ProviderId } from "./config";
import { createAnthropicAdapter } from "./anthropic";
import { createGeminiAdapter } from "./gemini";
import { createOpenAiAdapter } from "./openai";
import type { ProviderAdapter } from "./types";
import { AiNotConfiguredError } from "../client";

const cache = new Map<string, ProviderAdapter>();

// The adapter for a provider with this environment's key and model. Throws AiNotConfiguredError without a key.
export function adapterFor(provider: ProviderId): ProviderAdapter {
  const key = providerKey(provider);
  if (!key) throw new AiNotConfiguredError(provider);
  const model = modelFor(provider);
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
