import type { ProviderId } from "./config";
import { postJson, type HttpOptions } from "./http";
import { toProviderSchema } from "./json-schema";
import type { Citation, GenerateRequest, GenerateResult, ProviderAdapter, SearchResult } from "./types";

// OpenAI Responses API (POST /v1/responses) with the built-in `web_search` tool and strict JSON schema output.
// https://developers.openai.com/api/docs/guides/tools-web-search

export const OPENAI_URL = "https://api.openai.com/v1/responses";

type OutputItem =
  | { type: "message"; content?: ({ type: "output_text"; text: string; annotations?: { type: string; url?: string; title?: string }[] } | { type: "refusal"; refusal: string })[] }
  | { type: "web_search_call"; status?: string; action?: { type?: string; query?: string; sources?: { type?: string; url?: string }[] } }
  | { type: string };

type OpenAiResponse = {
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: OutputItem[];
  usage?: { input_tokens?: number; input_tokens_details?: { cached_tokens?: number }; output_tokens?: number };
};

export function createOpenAiAdapter(cfg: { apiKey: string; model: string } & HttpOptions): ProviderAdapter {
  const id: ProviderId = "openai";
  return {
    id,
    model: cfg.model,
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const body: Record<string, unknown> = {
        model: cfg.model,
        instructions: req.system,
        input: req.user,
        max_output_tokens: req.maxTokens,
        reasoning: { effort: req.effort ?? "medium" },
        store: false,
      };
      if (req.json) body.text = { format: { type: "json_schema", name: req.json.name, schema: toProviderSchema(req.json.schema), strict: true } };
      if (req.webSearch) {
        body.tools = [{ type: "web_search" }];
        body.max_tool_calls = req.webSearch.maxUses;
        body.include = ["web_search_call.action.sources"];
      }
      const res = (await postJson(id, OPENAI_URL, { authorization: `Bearer ${cfg.apiKey}` }, body, {
        ...cfg,
        timeoutMs: req.timeoutMs ?? cfg.timeoutMs ?? 240_000,
      })) as OpenAiResponse;
      return parseOpenAi(res, cfg.model, !!req.json);
    },
  };
}

export function parseOpenAi(res: OpenAiResponse, fallbackModel: string, wantJson: boolean): GenerateResult {
  const texts: string[] = [];
  const citations: Citation[] = [];
  const searchResults: SearchResult[] = [];
  let refused = res.incomplete_details?.reason === "content_filter";
  let searches = 0;
  for (const item of res.output ?? []) {
    if (item.type === "message" && "content" in item) {
      for (const c of item.content ?? []) {
        if (c.type === "refusal") refused = true;
        else if (c.type === "output_text") {
          texts.push(c.text);
          for (const a of c.annotations ?? []) {
            if (a.type === "url_citation" && a.url) citations.push({ url: a.url, title: a.title ?? null, citedText: null });
          }
        }
      }
    } else if (item.type === "web_search_call" && "action" in item) {
      if (!item.action?.type || item.action.type === "search") searches++;
      for (const s of item.action?.sources ?? []) if (s.url) searchResults.push({ url: s.url, title: s.url, pageAge: null });
    }
  }
  const text = texts.join("\n").trim();
  const cached = res.usage?.input_tokens_details?.cached_tokens ?? 0;
  let json: unknown = undefined;
  if (wantJson && !refused && text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  return {
    provider: "openai",
    model: res.model ?? fallbackModel,
    text,
    json,
    refused,
    usage: {
      inputTokens: Math.max(0, (res.usage?.input_tokens ?? 0) - cached),
      cacheReadTokens: cached,
      outputTokens: res.usage?.output_tokens ?? 0,
      searches,
    },
    citations,
    searchResults,
    fetched: [],
  };
}
