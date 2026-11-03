import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { costUsd, estimateCostUsd, estimateTokens, type ProviderId, type TokenUsage } from "./config";
import { isUsableUrl } from "../web-evidence";
import {
  AiProviderError,
  kindForStatus,
  type Citation,
  type FetchedPage,
  type FetchFailure,
  type GenerateRequest,
  type GenerateResult,
  type ProviderAdapter,
  type SearchQuery,
  type SearchResult,
} from "./types";

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

  // Web search with server-side page fetching; continues after pause_turn (at most four turns). Fetched pages are
  // capped at 8,000 tokens each: every extra turn re-sends them, which is what made searches expensive. Therefore:
  // - the search and fetch allowances hold for the whole loop, not per turn (max_uses counts per request);
  // - before every turn the run budget reserves an upper-bound estimate (see roundEstimate) and the loop stops,
  //   returning what it already has, when that does not fit;
  // - a first turn without a single usable URL ends the loop (nothing to read on).
  async function searchLoop(req: GenerateRequest): Promise<GenerateResult> {
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: req.user }];
    const maxSearches = req.webSearch!.maxUses;
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, searches: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const searchResults: SearchResult[] = [];
    const fetched: FetchedPage[] = [];
    const citations: Citation[] = [];
    const texts: string[] = [];
    const queries: SearchQuery[] = [];
    const queryById = new Map<string, SearchQuery>();
    const fetchUrlById = new Map<string, string>();
    const fetchFailed: FetchFailure[] = [];
    let model = cfg.model;
    let refused = false;
    let stoppedForBudget = false;
    let fetchesUsed = 0;
    // Tokens of everything the next turn re-sends: the prompt plus all earlier assistant content (search results
    // with their encrypted content and fetched pages are billed as input).
    let contextTokens = estimateTokens(req.system + req.user);
    for (let turn = 0; turn < 4; turn++) {
      const searchesLeft = Math.max(0, maxSearches - usage.searches);
      const fetchesLeft = Math.max(0, MAX_FETCHES - fetchesUsed);
      if (turn > 0 && searchesLeft === 0 && fetchesLeft === 0) break;
      const tools = [
        { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: Math.max(1, searchesLeft) },
        { type: "web_fetch_20260209" as const, name: "web_fetch" as const, max_uses: Math.max(1, fetchesLeft), citations: { enabled: true }, max_content_tokens: FETCH_TOKENS },
      ];
      const reservation = req.budget?.reserve(roundEstimate(cfg.model, contextTokens, tools[0].max_uses, tools[1].max_uses, req.maxTokens), "de volgende zoekronde");
      if (req.budget && !reservation) {
        stoppedForBudget = true;
        break;
      }
      let res: Anthropic.Beta.BetaMessage;
      try {
        res = await client.beta.messages.create({
          ...base,
          max_tokens: req.maxTokens,
          system: req.system,
          output_config: { effort: req.effort ?? "medium" },
          tools,
          messages,
        });
      } catch (e) {
        reservation?.settle(0);
        throw e;
      }
      model = res.model ?? model;
      const t = tokens(res.usage);
      reservation?.settle(costUsd(id, model, t));
      usage.inputTokens += t.inputTokens;
      usage.outputTokens += t.outputTokens;
      usage.searches += t.searches;
      usage.cacheReadTokens! += t.cacheReadTokens ?? 0;
      usage.cacheWriteTokens! += t.cacheWriteTokens ?? 0;
      contextTokens += estimateTokens(JSON.stringify(res.content));
      fetchesUsed += res.content.filter((b) => b.type === "web_fetch_tool_result").length;
      if (res.stop_reason === "refusal") {
        refused = true;
        break;
      }
      for (const block of res.content) {
        if (block.type === "server_tool_use") {
          // The search term and the fetched URL come from the tool call itself (the results are encrypted).
          if (block.name === "web_search" && typeof block.input.query === "string") {
            const q = { query: block.input.query, urls: [] as string[] };
            queries.push(q);
            queryById.set(block.id, q);
          } else if (block.name === "web_fetch" && typeof block.input.url === "string") {
            fetchUrlById.set(block.id, block.input.url);
          }
        } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          const q = queryById.get(block.tool_use_id);
          for (const r of block.content) {
            searchResults.push({ url: r.url, title: r.title, pageAge: r.page_age ?? null });
            if (q && !q.urls.includes(r.url)) q.urls.push(r.url);
          }
        } else if (block.type === "web_fetch_tool_result") {
          if (block.content.type === "web_fetch_result") {
            const doc = block.content.content;
            const src = doc.source;
            if (src.type === "text") fetched.push({ url: block.content.url, title: doc.title ?? null, text: src.data, kind: "text" });
            // PDFs arrive as a base64 document; ProofLab extracts the text itself (server-only pdf.js).
            else if (src.type === "base64" && src.media_type === "application/pdf") {
              const { pdfToText } = await import("@/lib/pdf-text");
              fetched.push({ url: block.content.url, title: doc.title ?? null, text: await pdfToText(Buffer.from(src.data, "base64")), kind: "pdf" });
            }
          } else {
            const url = fetchUrlById.get(block.tool_use_id);
            if (url) fetchFailed.push({ url, reason: block.content.error_code });
          }
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
      // Stop early when the first turn found nothing usable to read on.
      if (turn === 0 && !searchResults.some((r) => isUsableUrl(r.url)) && fetched.length === 0) break;
      messages.push({ role: "assistant", content: res.content });
    }
    return { provider: id, model, text: texts.join("").trim(), json: undefined, refused, usage, citations, searchResults, fetched, queries, fetchFailed, stoppedForBudget };
  }
}

const MAX_FETCHES = 3;
const FETCH_TOKENS = 8000;
// Upper bound for what one tool result adds to the context (a fetched page is capped at FETCH_TOKENS; search
// results with encrypted content are usually smaller).
const TOOL_RESULT_TOKENS = 10_000;

// Upper-bound cost of one turn. Inside one request the server runs a sampling iteration per tool use, and each
// iteration is billed for the whole context so far: with n tool uses that is at most (n + 1) × context plus the
// growing tool results (TOOL_RESULT_TOKENS × n(n+1)/2). Output: max_tokens (worst case). Plus the searches.
export function roundEstimate(model: string, contextTokens: number, searches: number, fetches: number, maxTokens: number): number {
  const n = searches + fetches;
  const input = (n + 1) * contextTokens + (TOOL_RESULT_TOKENS * n * (n + 1)) / 2;
  return estimateCostUsd("anthropic", model, { inputTokens: input, outputTokens: maxTokens, searches });
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
