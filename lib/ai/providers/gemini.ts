import type { ProviderId } from "./config";
import { postJson, type HttpOptions } from "./http";
import { toProviderSchema } from "./json-schema";
import type { Citation, GenerateRequest, GenerateResult, ProviderAdapter, SearchResult } from "./types";

// Gemini API models.generateContent with the `google_search` grounding tool and JSON schema output.
// https://ai.google.dev/api/generate-content · https://ai.google.dev/gemini-api/docs/google-search

export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const BLOCKED_FINISH = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY"]);

type GeminiResponse = {
  modelVersion?: string;
  promptFeedback?: { blockReason?: string };
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string; thought?: boolean }[] };
    groundingMetadata?: { webSearchQueries?: string[]; groundingChunks?: { web?: { uri?: string; title?: string } }[] };
  }[];
  usageMetadata?: { promptTokenCount?: number; cachedContentTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
};

export function createGeminiAdapter(cfg: { apiKey: string; model: string } & HttpOptions): ProviderAdapter {
  const id: ProviderId = "gemini";
  return {
    id,
    model: cfg.model,
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const generationConfig: Record<string, unknown> = {
        maxOutputTokens: req.maxTokens,
        thinkingConfig: { thinkingLevel: req.effort === "low" ? "low" : "high" },
      };
      if (req.json) {
        generationConfig.responseMimeType = "application/json";
        generationConfig.responseJsonSchema = toProviderSchema(req.json.schema);
      }
      const body: Record<string, unknown> = {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [{ text: req.user }] }],
        generationConfig,
      };
      if (req.webSearch) body.tools = [{ google_search: {} }];
      const url = `${GEMINI_BASE}/${encodeURIComponent(cfg.model)}:generateContent`;
      const res = (await postJson(id, url, { "x-goog-api-key": cfg.apiKey }, body, {
        ...cfg,
        timeoutMs: req.timeoutMs ?? cfg.timeoutMs ?? 240_000,
      })) as GeminiResponse;
      return parseGemini(res, cfg.model, !!req.json);
    },
  };
}

export function parseGemini(res: GeminiResponse, fallbackModel: string, wantJson: boolean): GenerateResult {
  const cand = res.candidates?.[0];
  const refused = !!res.promptFeedback?.blockReason || (!!cand?.finishReason && BLOCKED_FINISH.has(cand.finishReason));
  const text = (cand?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("")
    .trim();
  const gm = cand?.groundingMetadata;
  const citations: Citation[] = [];
  const searchResults: SearchResult[] = [];
  for (const c of gm?.groundingChunks ?? []) {
    if (!c.web?.uri) continue;
    // The uri is usually a Google redirect to the page; ProofLab fetches it and keeps the final address.
    citations.push({ url: c.web.uri, title: c.web.title ?? null, citedText: null });
    searchResults.push({ url: c.web.uri, title: c.web.title ?? c.web.uri, pageAge: null });
  }
  const u = res.usageMetadata ?? {};
  const cached = u.cachedContentTokenCount ?? 0;
  let json: unknown = undefined;
  if (wantJson && !refused && text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  return {
    provider: "gemini",
    model: res.modelVersion ?? fallbackModel,
    text,
    json,
    refused,
    usage: {
      inputTokens: Math.max(0, (u.promptTokenCount ?? 0) - cached),
      cacheReadTokens: cached,
      outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
      // Billed per search query the model runs (Gemini 3 and newer).
      searches: (gm?.webSearchQueries ?? []).filter((q) => q.trim().length > 0).length,
    },
    citations,
    searchResults,
    fetched: [],
  };
}
