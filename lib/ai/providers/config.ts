// The three AI providers ProofLab can use, their model IDs and their prices. Pure data and helpers (no
// server-only import) so the settings screen, tests and the ledger share one source of truth.
//
// Model IDs live ONLY in DEFAULT_MODELS below; each can be overridden per environment with
// ANTHROPIC_MODEL, OPENAI_MODEL or GEMINI_MODEL, and the research model with ANTHROPIC_RESEARCH_MODEL,
// OPENAI_RESEARCH_MODEL or GEMINI_RESEARCH_MODEL.

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

// Het kleinere, goedkopere model per aanbieder voor zoeken en uitlezen (webonderzoek, citaten uitlezen,
// steuncontrole). Het zware model doet alleen de onderzoekskaart en de reality-check.
export const PROVIDER_RESEARCH_MODEL_ENV: Record<ProviderId, string> = {
  anthropic: "ANTHROPIC_RESEARCH_MODEL",
  openai: "OPENAI_RESEARCH_MODEL",
  gemini: "GEMINI_RESEARCH_MODEL",
};

// The one place with model IDs: DEFAULT_MODELS is the heavy model, DEFAULT_RESEARCH_MODELS the research model
// (smaller model of each provider, per the providers' model pages on 2026-11-03).
export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-opus-5-5",
  openai: "gpt-5.5",
  gemini: "gemini-4-argon",
};
export const DEFAULT_RESEARCH_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-haiku-5-5",
  openai: "gpt-5.4-mini",
  gemini: "gemini-3.8-flash",
};

// "main": the heavy model; "research": the cheaper model for searching and reading.
export type ModelTier = "main" | "research";

type EnvLike = Record<string, string | undefined>;

export function modelFor(provider: ProviderId, source: EnvLike = process.env, tier: ModelTier = "main"): string {
  if (tier === "research") return source[PROVIDER_RESEARCH_MODEL_ENV[provider]]?.trim() || DEFAULT_RESEARCH_MODELS[provider];
  const override = source[PROVIDER_MODEL_ENV[provider]]?.trim();
  return override || DEFAULT_MODELS[provider];
}

// Best-effort provider for a stored model ID (AI forecasts store the model, not the provider).
export function providerOfModel(model: string | null | undefined): ProviderId | null {
  if (!model) return null;
  const m = model.toLowerCase();
  for (const p of PROVIDERS) if (m === DEFAULT_MODELS[p] || m === DEFAULT_RESEARCH_MODELS[p] || m === modelFor(p) || m === modelFor(p, process.env, "research")) return p;
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
    // Haiku is cheaper below 100,000 prompt tokens; the higher long-prompt price is used so the cap is never undercounted.
    [DEFAULT_RESEARCH_MODELS.anthropic]: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625, perSearch: 10 / 1000 },
  },
  openai: {
    [DEFAULT_MODELS.openai]: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 5, perSearch: 10 / 1000 },
    [DEFAULT_RESEARCH_MODELS.openai]: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0.75, perSearch: 10 / 1000 },
  },
  gemini: {
    // No separate cache price used: cached tokens are counted at the input price (never lower than billed).
    [DEFAULT_MODELS.gemini]: { input: 4, output: 20, cacheRead: 4, cacheWrite: 4, perSearch: 14 / 1000 },
    // The price from 1 January 2027 (the higher one) is used.
    [DEFAULT_RESEARCH_MODELS.gemini]: { input: 1.5, output: 7.5, cacheRead: 1.5, cacheWrite: 1.5, perSearch: 14 / 1000 },
  },
};

export function priceFor(provider: ProviderId, model?: string | null): Price {
  const table = PRICES[provider];
  if (model && table[model]) return table[model];
  // Fase B2: een aanbieder antwoordt soms met een gedateerde variant van het gevraagde model (bijv. "<model>-20261001").
  // Die krijgt de prijs van het model waar hij mee begint, niet die van het zware model: anders boekt de run meer
  // dan de reservering en lijkt het plafond overschreden.
  const prefix = model ? Object.keys(table).find((k) => model.startsWith(`${k}-`)) : undefined;
  return (prefix && table[prefix]) || table[DEFAULT_MODELS[provider]];
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

// ---------------------------------------------------------------------------
// Cost estimate before a model call (run budget, lib/ai/budget.ts)
// ---------------------------------------------------------------------------
// Expected input and output tokens (output: the call's max_tokens, the worst case) times the price, plus 20%
// margin. Uncached input price: the estimate never assumes a cache hit.

export const ESTIMATE_MARGIN = 1.2;

export function estimateCostUsd(provider: ProviderId, model: string | null | undefined, u: { inputTokens: number; outputTokens: number; searches: number }): number {
  return costUsd(provider, model, { inputTokens: u.inputTokens, outputTokens: u.outputTokens, searches: u.searches }) * ESTIMATE_MARGIN;
}

// Conservative token count for text: about three characters per token (Dutch and JSON are denser than English).
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3);
