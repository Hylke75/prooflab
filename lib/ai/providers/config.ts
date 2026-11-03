// The three AI providers ProofLab can use, their model IDs and their prices. Pure data and helpers (no
// server-only import) so the settings screen, tests and the ledger share one source of truth.
//
// Model IDs live ONLY in DEFAULT_MODELS below; each can be overridden per environment with
// ANTHROPIC_MODEL, OPENAI_MODEL or GEMINI_MODEL.

export const PROVIDERS = ["anthropic", "openai", "gemini"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export const isProvider = (v: unknown): v is ProviderId => typeof v === "string" && (PROVIDERS as readonly string[]).includes(v);

export const PROVIDER_LABELS: Record<ProviderId, { name: string; vendor: string; short: string }> = {
  anthropic: { name: "Claude", vendor: "Anthropic", short: "Claude" },
  openai: { name: "ChatGPT", vendor: "OpenAI", short: "ChatGPT" },
  gemini: { name: "Gemini", vendor: "Google", short: "Gemini" },
};

export const providerLabel = (p: ProviderId) => `${PROVIDER_LABELS[p].name} (${PROVIDER_LABELS[p].vendor})`;

// Environment variable that holds each provider's API key (set in the Vercel project, never in the database).
export const PROVIDER_KEY_ENV: Record<ProviderId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

export const PROVIDER_MODEL_ENV: Record<ProviderId, string> = {
  anthropic: "ANTHROPIC_MODEL",
  openai: "OPENAI_MODEL",
  gemini: "GEMINI_MODEL",
};

// The one place with model IDs.
export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-opus-5-5",
  openai: "gpt-5.5",
  gemini: "gemini-4-argon",
};

type EnvLike = Record<string, string | undefined>;

export function modelFor(provider: ProviderId, source: EnvLike = process.env): string {
  const override = source[PROVIDER_MODEL_ENV[provider]]?.trim();
  return override || DEFAULT_MODELS[provider];
}

// Best-effort provider for a stored model ID (AI forecasts store the model, not the provider).
export function providerOfModel(model: string | null | undefined): ProviderId | null {
  if (!model) return null;
  const m = model.toLowerCase();
  for (const p of PROVIDERS) if (m === DEFAULT_MODELS[p] || m === modelFor(p)) return p;
  if (m.startsWith("claude")) return "anthropic";
  if (m.startsWith("gemini")) return "gemini";
  if (/^(gpt|o\d|chatgpt)/.test(m)) return "openai";
  return null;
}

// ---------------------------------------------------------------------------
// Prices (USD) for the ai_runs ledger and the monthly cap
// ---------------------------------------------------------------------------
// Per million tokens, and per web search / search query. Checked against the providers' price pages on
// 2026-11-03. Where a price rises on a known date (Gemini from 1 December 2026) the higher price is used so the
// cap is never undercounted; free search allowances are ignored for the same reason. A model ID set through the
// environment that is not listed here is priced at its provider's default model.

export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number; perSearch: number };

export const PRICES: Record<ProviderId, Record<string, Price>> = {
  anthropic: {
    [DEFAULT_MODELS.anthropic]: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, perSearch: 10 / 1000 },
  },
  openai: {
    [DEFAULT_MODELS.openai]: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 5, perSearch: 10 / 1000 },
  },
  gemini: {
    // No separate cache price used: cached tokens are counted at the input price (never lower than billed).
    [DEFAULT_MODELS.gemini]: { input: 4, output: 20, cacheRead: 4, cacheWrite: 4, perSearch: 14 / 1000 },
  },
};

export function priceFor(provider: ProviderId, model?: string | null): Price {
  const table = PRICES[provider];
  return (model && table[model]) || table[DEFAULT_MODELS[provider]];
}

export type TokenUsage = {
  inputTokens: number; // uncached input tokens
  outputTokens: number; // including reasoning/thinking tokens
  searches: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export function costUsd(provider: ProviderId, model: string | null | undefined, u: TokenUsage): number {
  const p = priceFor(provider, model);
  const perM =
    u.inputTokens * p.input + (u.cacheReadTokens ?? 0) * p.cacheRead + (u.cacheWriteTokens ?? 0) * p.cacheWrite + u.outputTokens * p.output;
  return perM / 1_000_000 + u.searches * p.perSearch;
}
