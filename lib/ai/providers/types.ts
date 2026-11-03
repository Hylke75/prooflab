import type { z } from "zod";
import { PROVIDER_LABELS, type ProviderId, type TokenUsage } from "./config";

// One interface for text/JSON generation across Claude, ChatGPT and Gemini.

export type Effort = "low" | "medium" | "high";

export type GenerateRequest = {
  system: string;
  user: string;
  maxTokens: number;
  effort?: Effort;
  // Structured output: the provider is asked for JSON matching this schema; the caller validates it again.
  json?: { name: string; schema: z.ZodType };
  // Server-side web search by the provider. With Claude also server-side page fetching (web_fetch).
  webSearch?: { maxUses: number };
  timeoutMs?: number;
};

// A web page the provider itself fetched, with its text (Claude's web_fetch). Other providers return none; their
// pages are fetched by ProofLab (lib/ai/web-evidence.ts).
export type FetchedPage = { url: string; title: string | null; text: string };

// citedText is text FROM the source only when the provider says so (Claude's citations). For ChatGPT and
// Gemini a citation marks a URL; the cited span is the model's own sentence, so citedText is null.
export type Citation = { url: string | null; title: string | null; citedText: string | null };

export type SearchResult = { url: string; title: string; pageAge: string | null };

export type GenerateResult = {
  provider: ProviderId;
  model: string;
  text: string;
  json: unknown; // parsed JSON when `json` was requested, else undefined
  refused: boolean;
  usage: TokenUsage;
  citations: Citation[];
  searchResults: SearchResult[];
  fetched: FetchedPage[];
};

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly model: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

export type ProviderErrorKind = "auth" | "rate_limit" | "timeout" | "bad_request" | "server" | "network";

export class AiProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly kind: ProviderErrorKind,
    readonly status: number | null,
    detail?: string,
  ) {
    super(`${PROVIDER_LABELS[provider].name}: ${kindText(kind)}${status ? ` (HTTP ${status})` : ""}${detail ? ` – ${detail.slice(0, 200)}` : ""}`);
  }
}

function kindText(k: ProviderErrorKind): string {
  switch (k) {
    case "auth":
      return "API-sleutel geweigerd";
    case "rate_limit":
      return "limiet bereikt of overbelast";
    case "timeout":
      return "geen antwoord binnen de tijd";
    case "bad_request":
      return "verzoek afgewezen";
    case "server":
      return "storing bij de aanbieder";
    default:
      return "geen verbinding";
  }
}

export function kindForStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 408) return "timeout";
  if (status >= 500) return "server";
  return "bad_request";
}
