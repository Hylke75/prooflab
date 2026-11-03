import { afterEach, describe, expect, it, vi } from "vitest";

// searchQuestion end to end for a fetch-based provider: the provider's answer names pages and quotes, ProofLab
// fetches the pages itself and keeps only quotes that are literally there. Mocked fetch, no real API.

const idea = {
  title: "Vergaderzaal-app",
  decisionQuestion: "Investeren we?",
  description: "d",
  targetAudience: "eventmanagers",
  region: "Nederland",
  projectType: "new_product",
  sector: "events",
  keyUncertainty: null,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]) vi.stubEnv(k, env[k] ?? "");
  return {
    research: await import("@/lib/ai/research"),
    env: await import("@/lib/env"),
  };
}

describe("web research on ChatGPT", () => {
  it("keeps only literally verified quotes and books the provider's usage", async () => {
    const { research, env } = await load({ OPENAI_API_KEY: "sk-test" });
    expect(env.configuredProviders()).toEqual(["openai"]);
    expect(env.aiConfigured()).toBe(true);
    const api = vi.fn(async () =>
      new Response(
        JSON.stringify({
          model: "gpt-x",
          output: [
            { type: "web_search_call", action: { type: "search", query: "q" } },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "BRON: https://cbs.nl/a\nCITAAT: Er zijn 4.100 evenementenbureaus actief.\nCITAAT: Het aantal bureaus verdubbelde.",
                  annotations: [{ type: "url_citation", url: "https://cbs.nl/a", title: "CBS" }],
                },
              ],
            },
          ],
          usage: { input_tokens: 2000, output_tokens: 500 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", api);
    const fetchPage = vi.fn(async (url: string) => ({ url, title: "CBS Statline", text: "Kop\nEr zijn 4.100 evenementenbureaus actief in 2025.\nVoet" }));
    const r = await research.searchQuestion(idea, "Hoeveel bureaus?", 3, "openai", { fetchPage });
    expect(api).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith("https://cbs.nl/a");
    expect(r.sources).toEqual([
      { url: "https://cbs.nl/a", title: "CBS Statline", pageAge: null, excerpts: ["Er zijn 4.100 evenementenbureaus actief in 2025."], foundBy: ["openai"] },
    ]);
    expect(r.detail).toContain("1 van 2 citaten letterlijk teruggevonden");
    expect(r.usage).toMatchObject({ provider: "openai", model: "gpt-x", searches: 1, inputTokens: 2000, outputTokens: 500 });
    expect(r.usage.cost).toBeGreaterThan(0);
  });

  it("refuses to run a provider without a key", async () => {
    const { research } = await load({ GEMINI_API_KEY: "g" });
    await expect(research.searchQuestion(idea, "q", 3, "openai")).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it("reports no AI when no key is set", async () => {
    const { env } = await load({});
    expect(env.aiConfigured()).toBe(false);
    expect(env.configuredProviders()).toEqual([]);
  });
});
