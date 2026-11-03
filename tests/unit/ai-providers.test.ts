import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createOpenAiAdapter, OPENAI_URL } from "@/lib/ai/providers/openai";
import { createGeminiAdapter, GEMINI_BASE } from "@/lib/ai/providers/gemini";
import { createAnthropicAdapter } from "@/lib/ai/providers/anthropic";
import { AiProviderError } from "@/lib/ai/providers/types";
import { toProviderSchema } from "@/lib/ai/providers/json-schema";

// The three adapters against a mocked fetch: request shape, parsing of text, usage and citations, and errors.
// No real API is ever called.

type Call = { url: string; init: RequestInit };

function mockFetch(responses: (Response | ((init: RequestInit) => Promise<Response>))[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("unexpected call");
    return typeof next === "function" ? next(init ?? {}) : next;
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

// Never resolves until the request is aborted, like a hanging connection.
const hang = (init: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });

const body = (c: Call) => JSON.parse(String(c.init.body));
const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);
const Schema = z.object({ answer: z.string(), score: z.number().int().min(1).max(5), note: z.string().nullable() });

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

describe("OpenAI adapter (Responses API)", () => {
  const ok = {
    model: "gpt-test-1",
    status: "completed",
    output: [
      { type: "web_search_call", status: "completed", action: { type: "search", query: "cbs evenementen", sources: [{ type: "url", url: "https://www.cbs.nl/a" }] } },
      { type: "web_search_call", status: "completed", action: { type: "open_page" } },
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "BRON: https://www.cbs.nl/a\nCITAAT: In 2025 waren er 1.200 evenementen.",
            annotations: [{ type: "url_citation", url: "https://www.cbs.nl/a", title: "CBS", start_index: 0, end_index: 10 }],
          },
        ],
      },
    ],
    usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 200 }, output_tokens: 300 },
  };

  it("sends instructions, input, web_search and the source include; parses text, usage and citations", async () => {
    const m = mockFetch([json(ok)]);
    const a = createOpenAiAdapter({ apiKey: "sk-test", model: "gpt-test", fetch: m.fetch });
    const r = await a.generate({ system: "SYS", user: "VRAAG", maxTokens: 500, effort: "low", webSearch: { maxUses: 3 } });
    expect(m.calls[0].url).toBe(OPENAI_URL);
    expect(header(m.calls[0], "authorization")).toBe("Bearer sk-test");
    expect(body(m.calls[0])).toMatchObject({
      model: "gpt-test",
      instructions: "SYS",
      input: "VRAAG",
      max_output_tokens: 500,
      reasoning: { effort: "low" },
      tools: [{ type: "web_search" }],
      max_tool_calls: 3,
      include: ["web_search_call.action.sources"],
      store: false,
    });
    expect(r.text).toContain("CITAAT");
    expect(r.model).toBe("gpt-test-1");
    expect(r.usage).toEqual({ inputTokens: 800, cacheReadTokens: 200, outputTokens: 300, searches: 1 });
    // A URL citation marks a page; the cited span is the model's own text, so no citedText.
    expect(r.citations).toEqual([{ url: "https://www.cbs.nl/a", title: "CBS", citedText: null }]);
    expect(r.searchResults.map((s) => s.url)).toEqual(["https://www.cbs.nl/a"]);
    expect(r.refused).toBe(false);
  });

  it("asks for a strict JSON schema and parses the JSON", async () => {
    const m = mockFetch([json({ output: [{ type: "message", content: [{ type: "output_text", text: '{"answer":"ja","score":3,"note":null}' }] }], usage: { input_tokens: 5, output_tokens: 5 } })]);
    const a = createOpenAiAdapter({ apiKey: "k", model: "gpt-test", fetch: m.fetch });
    const r = await a.generate({ system: "s", user: "u", maxTokens: 50, json: { name: "out", schema: Schema } });
    const fmt = body(m.calls[0]).text.format;
    expect(fmt).toMatchObject({ type: "json_schema", name: "out", strict: true });
    expect(fmt.schema.required).toEqual(["answer", "score", "note"]);
    expect(fmt.schema.additionalProperties).toBe(false);
    expect(body(m.calls[0]).tools).toBeUndefined();
    expect(r.json).toEqual({ answer: "ja", score: 3, note: null });
  });

  it("marks a refusal", async () => {
    const m = mockFetch([json({ output: [{ type: "message", content: [{ type: "refusal", refusal: "Nee." }] }], usage: { input_tokens: 5, output_tokens: 2 } })]);
    const r = await createOpenAiAdapter({ apiKey: "k", model: "m", fetch: m.fetch }).generate({ system: "s", user: "u", maxTokens: 10 });
    expect(r.refused).toBe(true);
  });

  it("maps 401 to an auth error without leaking the key", async () => {
    const m = mockFetch([json({ error: { message: "Incorrect API key provided: sk-abcdefghijkl" } }, 401)]);
    const a = createOpenAiAdapter({ apiKey: "sk-abcdefghijkl", model: "m", fetch: m.fetch, maxRetries: 2 });
    const e = await a.generate({ system: "s", user: "u", maxTokens: 10 }).catch((x) => x);
    expect(e).toBeInstanceOf(AiProviderError);
    expect(e).toMatchObject({ provider: "openai", kind: "auth", status: 401 });
    expect(String(e.message)).not.toContain("sk-abcdefghijkl");
    expect(m.calls).toHaveLength(1); // no retry on auth errors
  });

  it("retries a 429 (honouring Retry-After) and then succeeds", async () => {
    const sleeps: number[] = [];
    const m = mockFetch([json({ error: { message: "rate" } }, 429, { "retry-after": "2" }), json(ok)]);
    const a = createOpenAiAdapter({ apiKey: "k", model: "m", fetch: m.fetch, maxRetries: 2, sleep: async (ms) => void sleeps.push(ms) });
    const r = await a.generate({ system: "s", user: "u", maxTokens: 10 });
    expect(r.text).toContain("BRON");
    expect(sleeps).toEqual([2000]);
  });

  it("gives up on a persistent 429 with a rate_limit error", async () => {
    const m = mockFetch([json({}, 429), json({}, 429)]);
    const a = createOpenAiAdapter({ apiKey: "k", model: "m", fetch: m.fetch, maxRetries: 1, sleep: async () => {} });
    await expect(a.generate({ system: "s", user: "u", maxTokens: 10 })).rejects.toMatchObject({ kind: "rate_limit", status: 429 });
    expect(m.calls).toHaveLength(2);
  });

  it("aborts after the timeout", async () => {
    const m = mockFetch([hang]);
    const a = createOpenAiAdapter({ apiKey: "k", model: "m", fetch: m.fetch, timeoutMs: 20 });
    await expect(a.generate({ system: "s", user: "u", maxTokens: 10 })).rejects.toMatchObject({ provider: "openai", kind: "timeout" });
  });
});

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

describe("Gemini adapter (generateContent + google_search)", () => {
  const ok = {
    modelVersion: "gemini-test-001",
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text: "denkwerk", thought: true }, { text: "BRON: https://example.nl/x\n" }, { text: "CITAAT: Zo staat het er." }] },
        groundingMetadata: {
          webSearchQueries: ["eventmanagers nederland", ""],
          groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "example.nl" } }],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 900, cachedContentTokenCount: 100, candidatesTokenCount: 200, thoughtsTokenCount: 50 },
  };

  it("posts to the model's generateContent with the key header and the google_search tool; parses grounding and usage", async () => {
    const m = mockFetch([json(ok)]);
    const a = createGeminiAdapter({ apiKey: "AIza-test", model: "gemini-test", fetch: m.fetch });
    const r = await a.generate({ system: "SYS", user: "VRAAG", maxTokens: 800, effort: "medium", webSearch: { maxUses: 4 } });
    expect(m.calls[0].url).toBe(`${GEMINI_BASE}/gemini-test:generateContent`);
    expect(header(m.calls[0], "x-goog-api-key")).toBe("AIza-test");
    expect(m.calls[0].url).not.toContain("AIza");
    expect(body(m.calls[0])).toMatchObject({
      systemInstruction: { parts: [{ text: "SYS" }] },
      contents: [{ role: "user", parts: [{ text: "VRAAG" }] }],
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: 800, thinkingConfig: { thinkingLevel: "high" } },
    });
    // Thought parts are not part of the answer.
    expect(r.text).toBe("BRON: https://example.nl/x\nCITAAT: Zo staat het er.");
    expect(r.model).toBe("gemini-test-001");
    expect(r.usage).toEqual({ inputTokens: 800, cacheReadTokens: 100, outputTokens: 250, searches: 1 });
    expect(r.citations).toEqual([{ url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "example.nl", citedText: null }]);
  });

  it("asks for JSON with responseJsonSchema and parses it", async () => {
    const m = mockFetch([json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"answer":"x","score":2,"note":"n"}' }] } }], usageMetadata: {} })]);
    const r = await createGeminiAdapter({ apiKey: "k", model: "g", fetch: m.fetch }).generate({ system: "s", user: "u", maxTokens: 10, effort: "low", json: { name: "o", schema: Schema } });
    const gc = body(m.calls[0]).generationConfig;
    expect(gc.responseMimeType).toBe("application/json");
    expect(gc.responseJsonSchema.properties.score).toEqual({ type: "integer", minimum: 1, maximum: 5 });
    expect(gc.thinkingConfig).toEqual({ thinkingLevel: "low" });
    expect(r.json).toEqual({ answer: "x", score: 2, note: "n" });
  });

  it("treats a safety stop or a blocked prompt as a refusal", async () => {
    const m = mockFetch([json({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] }), json({ promptFeedback: { blockReason: "OTHER" } })]);
    const a = createGeminiAdapter({ apiKey: "k", model: "g", fetch: m.fetch });
    expect((await a.generate({ system: "s", user: "u", maxTokens: 10 })).refused).toBe(true);
    expect((await a.generate({ system: "s", user: "u", maxTokens: 10 })).refused).toBe(true);
  });

  it("maps 403, 429 and timeouts", async () => {
    const m = mockFetch([json({ error: { message: "API key not valid" } }, 403), json({}, 429), hang]);
    const a = createGeminiAdapter({ apiKey: "k", model: "g", fetch: m.fetch, maxRetries: 0, timeoutMs: 20 });
    await expect(a.generate({ system: "s", user: "u", maxTokens: 10 })).rejects.toMatchObject({ provider: "gemini", kind: "auth", status: 403 });
    await expect(a.generate({ system: "s", user: "u", maxTokens: 10 })).rejects.toMatchObject({ kind: "rate_limit" });
    await expect(a.generate({ system: "s", user: "u", maxTokens: 10 })).rejects.toMatchObject({ kind: "timeout" });
  });
});

// ---------------------------------------------------------------------------
// Anthropic (SDK with an injected fetch)
// ---------------------------------------------------------------------------

describe("Anthropic adapter (Messages API via the SDK)", () => {
  const message = (content: unknown[], extra: Record<string, unknown> = {}) => ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-test",
    stop_reason: "end_turn",
    stop_sequence: null,
    content,
    usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 10, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 2 } },
    ...extra,
  });

  it("searches with web_search + web_fetch and keeps Claude's verbatim citations and fetched pages", async () => {
    const m = mockFetch([
      json(
        message([
          { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://cbs.nl/p", title: "CBS", page_age: "2026-01-02", encrypted_content: "x" }] },
          {
            type: "web_fetch_tool_result",
            tool_use_id: "f1",
            content: { type: "web_fetch_result", url: "https://cbs.nl/p", retrieved_at: "2026-11-01", content: { type: "document", title: "CBS pagina", source: { type: "text", media_type: "text/plain", data: "Kop\nIn 2025 waren er 1.200 evenementen.\nVoet" }, citations: null } },
          },
          { type: "text", text: "Er waren 1.200 evenementen.", citations: [{ type: "web_search_result_location", url: "https://cbs.nl/p", title: "CBS", cited_text: "In 2025 waren er 1.200 evenementen.", encrypted_index: "e" }] },
        ]),
      ),
    ]);
    const a = createAnthropicAdapter({ apiKey: "sk-ant-test", model: "claude-test", fetch: m.fetch, maxRetries: 0 });
    const r = await a.generate({ system: "SYS", user: "VRAAG", maxTokens: 1000, effort: "medium", webSearch: { maxUses: 3 } });
    expect(m.calls[0].url).toContain("/v1/messages");
    expect(header(m.calls[0], "authorization") ?? header(m.calls[0], "x-api-key")).toContain("sk-ant-test");
    expect(header(m.calls[0], "anthropic-beta")).toContain("server-side-fallback");
    const b = body(m.calls[0]);
    expect(b.model).toBe("claude-test");
    expect(b.system).toBe("SYS");
    expect(b.tools.map((t: { name: string }) => t.name)).toEqual(["web_search", "web_fetch"]);
    expect(b.tools[0].max_uses).toBe(3);
    expect(r.citations).toEqual([{ url: "https://cbs.nl/p", title: "CBS", citedText: "In 2025 waren er 1.200 evenementen." }]);
    expect(r.fetched[0]).toMatchObject({ url: "https://cbs.nl/p", title: "CBS pagina" });
    expect(r.searchResults[0]).toEqual({ url: "https://cbs.nl/p", title: "CBS", pageAge: "2026-01-02" });
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 40, searches: 2, cacheReadTokens: 10, cacheWriteTokens: 0 });
  });

  it("returns structured output and flags a refusal", async () => {
    const m = mockFetch([json(message([{ type: "text", text: '{"answer":"ok","score":4,"note":null}' }])), json(message([{ type: "text", text: "" }], { stop_reason: "refusal" }))]);
    const a = createAnthropicAdapter({ apiKey: "k", model: "claude-test", fetch: m.fetch, maxRetries: 0 });
    const r = await a.generate({ system: "s", user: "u", maxTokens: 100, json: { name: "o", schema: Schema } });
    expect(r.json).toEqual({ answer: "ok", score: 4, note: null });
    expect(body(m.calls[0]).output_config.format.type).toBe("json_schema");
    const refused = await a.generate({ system: "s", user: "u", maxTokens: 100 });
    expect(refused.refused).toBe(true);
  });

  it("maps 401, 429 and timeouts to provider errors", async () => {
    const err = (status: number) => json({ type: "error", error: { type: "x", message: "nope" } }, status);
    const m = mockFetch([err(401), err(429), hang]);
    const a = createAnthropicAdapter({ apiKey: "k", model: "claude-test", fetch: m.fetch, maxRetries: 0, timeoutMs: 30 });
    await expect(a.generate({ system: "s", user: "u", maxTokens: 10 })).rejects.toMatchObject({ provider: "anthropic", kind: "auth", status: 401 });
    await expect(a.generate({ system: "s", user: "u", maxTokens: 10 })).rejects.toMatchObject({ provider: "anthropic", kind: "rate_limit", status: 429 });
    await expect(a.generate({ system: "s", user: "u", maxTokens: 10 })).rejects.toMatchObject({ provider: "anthropic", kind: "timeout" });
  });
});

describe("JSON schema for OpenAI/Gemini", () => {
  it("drops $schema and zod's safe-integer bounds, closes every object and requires every property", () => {
    const s = toProviderSchema(z.object({ n: z.number().int(), o: z.object({ a: z.string() }).nullable(), list: z.array(z.object({ b: z.boolean() })).max(3) }));
    expect(s.$schema).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain("9007199254740991");
    expect(s.required).toEqual(["n", "o", "list"]);
    expect(s.additionalProperties).toBe(false);
  });
});
