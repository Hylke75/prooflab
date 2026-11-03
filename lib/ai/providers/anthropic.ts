import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { ProviderId, TokenUsage } from "./config";
import { AiProviderError, kindForStatus, type Citation, type FetchedPage, type GenerateRequest, type GenerateResult, type ProviderAdapter, type SearchResult } from "./types";

// Claude through the official Anthropic SDK: the existing behaviour (structured output via a Zod format,
// server-side web_search + web_fetch with citations, server-side refusal fallback), behind the shared interface.

// Server-side refusal fallback: on a policy decline the API re-runs the request on a suitable model inside the
// same call.
export const FALLBACK_BETAS = ["server-side-fallback-2026-07-01"] as const;

type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number } | null;
};

const tokens = (u: Usage): TokenUsage => ({
  inputTokens: u.input_tokens,
  outputTokens: u.output_tokens,
  cacheReadTokens: u.cache_read_input_tokens ?? 0,
  cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  searches: u.server_tool_use?.web_search_requests ?? 0,
});

export function createAnthropicAdapter(cfg: { apiKey: string; model: string; fetch?: typeof fetch; maxRetries?: number; timeoutMs?: number }): ProviderAdapter {
  const id: ProviderId = "anthropic";
  const client = new Anthropic({
    apiKey: cfg.apiKey,
    maxRetries: cfg.maxRetries ?? 2,
    timeout: cfg.timeoutMs ?? 10 * 60 * 1000,
    ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
  });
  const base = { model: cfg.model, betas: [...FALLBACK_BETAS], fallbacks: "default" as const };

  return {
    id,
    model: cfg.model,
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      try {
        if (req.json) {
          const res = await client.beta.messages.parse({
            ...base,
            max_tokens: req.maxTokens,
            system: req.system,
            output_config: { effort: req.effort ?? "medium", format: betaZodOutputFormat(req.json.schema) },
            messages: [{ role: "user", content: req.user }],
          });
          return {
            provider: id,
            model: res.model ?? cfg.model,
            text: res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n"),
            json: res.parsed_output ?? undefined,
            refused: res.stop_reason === "refusal",
            usage: tokens(res.usage),
            citations: [],
            searchResults: [],
            fetched: [],
          };
        }
        if (req.webSearch) return await searchLoop(req);
        const res = await client.beta.messages.create({
          ...base,
          max_tokens: req.maxTokens,
          system: req.system,
          output_config: { effort: req.effort ?? "medium" },
          messages: [{ role: "user", content: req.user }],
        });
        return {
          provider: id,
          model: res.model ?? cfg.model,
          text: res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim(),
          json: undefined,
          refused: res.stop_reason === "refusal",
          usage: tokens(res.usage),
          citations: [],
          searchResults: [],
          fetched: [],
        };
      } catch (e) {
        throw mapError(e);
      }
    },
  };

  // Web search with server-side page fetching; continues after pause_turn (at most four turns).
  async function searchLoop(req: GenerateRequest): Promise<GenerateResult> {
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: req.user }];
    const tools = [
      { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: req.webSearch!.maxUses },
      { type: "web_fetch_20260209" as const, name: "web_fetch" as const, max_uses: 4, citations: { enabled: true }, max_content_tokens: 20000 },
    ];
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, searches: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const searchResults: SearchResult[] = [];
    const fetched: FetchedPage[] = [];
    const citations: Citation[] = [];
    const texts: string[] = [];
    let model = cfg.model;
    let refused = false;
    for (let turn = 0; turn < 4; turn++) {
      const res = await client.beta.messages.create({
        ...base,
        max_tokens: req.maxTokens,
        system: req.system,
        output_config: { effort: req.effort ?? "medium" },
        tools,
        messages,
      });
      model = res.model ?? model;
      const t = tokens(res.usage);
      usage.inputTokens += t.inputTokens;
      usage.outputTokens += t.outputTokens;
      usage.searches += t.searches;
      usage.cacheReadTokens! += t.cacheReadTokens ?? 0;
      usage.cacheWriteTokens! += t.cacheWriteTokens ?? 0;
      if (res.stop_reason === "refusal") {
        refused = true;
        break;
      }
      for (const block of res.content) {
        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          for (const r of block.content) searchResults.push({ url: r.url, title: r.title, pageAge: r.page_age ?? null });
        } else if (block.type === "web_fetch_tool_result" && block.content.type === "web_fetch_result") {
          const src = block.content.content.source;
          if (src.type === "text") fetched.push({ url: block.content.url, title: block.content.content.title ?? null, text: src.data });
        } else if (block.type === "text") {
          texts.push(block.text);
          for (const c of block.citations ?? []) {
            // Claude's cited_text is a verbatim slice of the source.
            if (c.type === "web_search_result_location") citations.push({ url: c.url, title: c.title ?? null, citedText: c.cited_text });
            else if (c.type === "char_location") citations.push({ url: null, title: c.document_title ?? null, citedText: c.cited_text });
          }
        }
      }
      if (res.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: res.content });
    }
    return { provider: id, model, text: texts.join("").trim(), json: undefined, refused, usage, citations, searchResults, fetched };
  }
}

function mapError(e: unknown): unknown {
  if (e instanceof AiProviderError) return e;
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new AiProviderError("anthropic", "timeout", null);
  if (e instanceof Anthropic.APIConnectionError) return new AiProviderError("anthropic", "network", null);
  if (e instanceof Anthropic.APIError && typeof e.status === "number") {
    const detail = (e.error as { error?: { message?: string } } | undefined)?.error?.message;
    return new AiProviderError("anthropic", kindForStatus(e.status), e.status, detail);
  }
  return e;
}
