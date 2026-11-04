import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiBudgetError, AiRefusedError } from "@/lib/ai/client";
import { AiProviderError } from "@/lib/ai/providers/types";
import { FAILURE_TEXT, failedProviders, failureCode, retryable } from "@/lib/research-failures";
import { fakeSupabase, runnerRpcs } from "./helpers/fake-supabase";
import { doc, f, FILLER, LONG, msg, r, s, seedRun } from "./helpers/research-fixtures";

// Fase B2, punt 5: een mislukte aanbieder krijgt een korte reden (timeout, quotum, geweigerd) en kan opnieuw.

describe("reden van een mislukte aanbieder", () => {
  it("vertaalt fouten naar een korte reden", () => {
    expect(failureCode(new AiProviderError("gemini", "timeout", null))).toBe("timeout");
    expect(failureCode(new AiProviderError("gemini", "rate_limit", 429))).toBe("quota");
    expect(failureCode(new AiProviderError("openai", "auth", 401))).toBe("auth");
    expect(failureCode(new AiProviderError("openai", "bad_request", 400))).toBe("rejected");
    expect(failureCode(new AiRefusedError("nee"))).toBe("refused");
    expect(failureCode(new AiBudgetError("op"))).toBe("budget");
    expect(failureCode(new Error("The operation was aborted due to timeout"))).toBe("timeout");
    expect(failureCode("raar")).toBe("unknown");
    expect(FAILURE_TEXT.quota).toBe("quotum of limiet bereikt");
    expect(retryable("timeout")).toBe(true);
    expect(retryable("auth")).toBe(false);
  });

  it("leest de mislukte aanbieders uit de uitvoer van een stap", () => {
    const out = { providers: [{ provider: "anthropic", ok: true }, { provider: "gemini", ok: false, reason: "timeout" }, { provider: "openai", ok: false }] };
    expect(failedProviders(out)).toEqual([
      { provider: "gemini", reason: "timeout" },
      { provider: "openai", reason: "unknown" },
    ]);
    expect(failedProviders(null)).toEqual([]);
  });
});

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => state.client, supabaseAnon: () => state.client }));
vi.mock("@/lib/fetch-page", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/fetch-page")>();
  return { ...orig, fetchPageText: vi.fn(async () => Promise.reject(new orig.PageFetchError("geblokkeerd", "Niet bereikbaar."))) };
});

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "gm-test");
  vi.stubEnv("RESEARCH_BUDGET_USD", "3");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("zoeken met twee aanbieders waarvan één faalt", () => {
  it("houdt de bronnen van de ene en legt de reden van de andere vast", async () => {
    const db = seedRun(["Willen kantoren € 249 per maand betalen?"]);
    state.client = fakeSupabase(db, runnerRpcs);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        if (String(url).includes("generativelanguage")) return new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), { status: 429 });
        return new Response(
          JSON.stringify(
            msg([
              s("s1", "prijs makelaarssoftware"),
              r("s1", ["https://bron.nl/a"]),
              f("f1", "https://bron.nl/a"),
              doc("f1", "https://bron.nl/a", { type: "text", media_type: "text/plain", data: `${FILLER}\n${LONG}` }),
              { type: "text", text: "x", citations: [{ type: "web_search_result_location", url: "https://bron.nl/a", title: "A", cited_text: "steeg in 2025 naar 4.100 bedrijven", encrypted_index: "e" }] },
            ]),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const { searchAcrossProviders } = await import("@/lib/research-runner");
    const ctx = { title: "x", decisionQuestion: "x", description: "x", targetAudience: "kantoren", region: "Nederland", projectType: "x", sector: "x", keyUncertainty: null };
    const res = await searchAcrossProviders("idea-1", "research:search", ctx, "Willen kantoren € 249 per maand betalen?", 3, { providers: ["anthropic", "gemini"] });
    expect(res.sources.length).toBeGreaterThan(0);
    const gemini = res.perProvider.find((p) => p.provider === "gemini");
    expect(gemini).toMatchObject({ ok: false, reason: "quota" });
    expect(gemini?.detail).toBe("mislukt (quotum of limiet bereikt)");
    expect(res.summary).toMatch(/Gemini: mislukt \(quotum of limiet bereikt\)/);
  });
});
