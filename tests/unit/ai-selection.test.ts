import { afterEach, describe, expect, it, vi } from "vitest";
import { costUsd, DEFAULT_MODELS, modelFor, priceFor, PRICES, providerOfModel } from "@/lib/ai/providers/config";
import { DEFAULT_AI_SETTINGS, ensembleMean, ensembleProviders, pickProvider, settingsFromRow, taskForPurpose, type AiSettings } from "@/lib/ai/providers/select";
import { mergeFoundSources, parseQuotedSources, passageFor, verifyQuotedSources } from "@/lib/ai/web-evidence";

describe("provider selection and fallback", () => {
  const s: AiSettings = { defaultProvider: "openai", tasks: { coach: "gemini", forecast: null }, ensemble: true };

  it("uses the task choice, else the default", () => {
    expect(pickProvider(s, "coach", ["anthropic", "openai", "gemini"])).toEqual({ provider: "gemini", chosen: "gemini", fallback: false });
    expect(pickProvider(s, "forecast", ["anthropic", "openai", "gemini"])).toEqual({ provider: "openai", chosen: "openai", fallback: false });
    expect(pickProvider(s, "research", ["openai"])?.provider).toBe("openai");
  });

  it("falls back to the default, then to any configured provider, when the chosen one has no key", () => {
    expect(pickProvider(s, "coach", ["anthropic", "openai"])).toEqual({ provider: "openai", chosen: "gemini", fallback: true });
    expect(pickProvider(s, "coach", ["anthropic"])).toEqual({ provider: "anthropic", chosen: "gemini", fallback: true });
    expect(pickProvider(DEFAULT_AI_SETTINGS, "research", ["gemini"])).toEqual({ provider: "gemini", chosen: "anthropic", fallback: true });
  });

  it("returns null without any key", () => {
    expect(pickProvider(s, "coach", [])).toBeNull();
    expect(ensembleProviders(s, "research", [])).toEqual([]);
  });

  it("puts the picked provider first in an ensemble, and only uses one provider when the ensemble is off", () => {
    expect(ensembleProviders(s, "research", ["anthropic", "openai", "gemini"])).toEqual(["openai", "anthropic", "gemini"]);
    expect(ensembleProviders(s, "coach", ["anthropic", "gemini"])).toEqual(["gemini", "anthropic"]);
    expect(ensembleProviders({ ...s, ensemble: false }, "research", ["anthropic", "openai", "gemini"])).toEqual(["openai"]);
  });

  it("maps logged purposes to tasks", () => {
    expect(taskForPurpose("coach")).toBe("coach");
    expect(taskForPurpose("coach_review")).toBe("coach");
    expect(taskForPurpose("survey_draft")).toBe("survey");
    expect(taskForPurpose("promo_posts")).toBe("promo");
    expect(taskForPurpose("forecast")).toBe("forecast");
    expect(taskForPurpose("research:search")).toBe("research");
    expect(taskForPurpose("interview_analysis")).toBe("research");
  });

  it("reads a settings row defensively", () => {
    expect(settingsFromRow(null)).toEqual(DEFAULT_AI_SETTINGS);
    const r = settingsFromRow({
      default_provider: "gemini",
      research_provider: "bogus",
      coach_provider: "openai",
      survey_provider: null,
      promo_provider: null,
      forecast_provider: "anthropic",
      ensemble: false,
    });
    expect(r.defaultProvider).toBe("gemini");
    expect(r.tasks).toMatchObject({ research: null, coach: "openai", forecast: "anthropic" });
    expect(r.ensemble).toBe(false);
  });
});

describe("model config", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lets the environment override a model and recognises providers from model IDs", () => {
    expect(modelFor("openai", {})).toBe(DEFAULT_MODELS.openai);
    expect(modelFor("openai", { OPENAI_MODEL: " gpt-other " })).toBe("gpt-other");
    expect(modelFor("gemini", { GEMINI_MODEL: "" })).toBe(DEFAULT_MODELS.gemini);
    expect(providerOfModel(DEFAULT_MODELS.anthropic)).toBe("anthropic");
    expect(providerOfModel("gemini-x-pro-001")).toBe("gemini");
    expect(providerOfModel("gpt-9")).toBe("openai");
    expect(providerOfModel("o7-mini")).toBe("openai");
    expect(providerOfModel(null)).toBeNull();
    expect(providerOfModel("model")).toBeNull();
  });

  it("has a price for every default model", () => {
    for (const p of ["anthropic", "openai", "gemini"] as const) expect(PRICES[p][DEFAULT_MODELS[p]]).toBeDefined();
  });
});

describe("price calculation", () => {
  it("prices input, cache, output and searches per provider", () => {
    const u = { inputTokens: 1_000_000, outputTokens: 1_000_000, searches: 10, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 };
    for (const p of ["anthropic", "openai", "gemini"] as const) {
      const pr = priceFor(p);
      expect(costUsd(p, DEFAULT_MODELS[p], u)).toBeCloseTo(pr.input + pr.output + pr.cacheRead + 10 * pr.perSearch, 6);
    }
    // Claude: $4 in, $20 out per MTok and $10 per 1000 searches (the existing ledger behaviour).
    expect(costUsd("anthropic", DEFAULT_MODELS.anthropic, { inputTokens: 1000, outputTokens: 500, searches: 2 })).toBeCloseTo((1000 * 4 + 500 * 20) / 1e6 + 0.02, 8);
  });

  it("prices an unknown model at its provider's default model", () => {
    const u = { inputTokens: 500, outputTokens: 500, searches: 1 };
    expect(costUsd("gemini", "gemini-unknown", u)).toBe(costUsd("gemini", DEFAULT_MODELS.gemini, u));
  });
});

describe("ensemble mean", () => {
  it("averages the AI forecasts, ignoring nothing but non-numbers", () => {
    expect(ensembleMean([0.2, 0.3, 0.4])).toBeCloseTo(0.3, 10);
    expect(ensembleMean([0.25])).toBe(0.25);
    expect(ensembleMean([])).toBeNull();
    expect(ensembleMean([Number.NaN, 0.5])).toBe(0.5);
  });
});

describe("web evidence (provider-independent)", () => {
  const page = "Titel\nIn 2025 waren er in Nederland 1.200 evenementen met meer dan 500 bezoekers.\nAndere alinea over iets anders.";

  it("parses BRON/CITAAT blocks, also with markdown and quote marks", () => {
    const parsed = parseQuotedSources(`Inleiding.
**BRON:** https://cbs.nl/a.
CITAAT: "In 2025 waren er in Nederland 1.200 evenementen"
- BRON: <https://example.nl/b>
- CITAAT: kort
BRON: https://example.nl/c
CITAAT: “Een citaat met typografische aanhalingstekens”`);
    expect(parsed).toEqual([
      { url: "https://cbs.nl/a", quotes: ["In 2025 waren er in Nederland 1.200 evenementen"] },
      { url: "https://example.nl/c", quotes: ["Een citaat met typografische aanhalingstekens"] },
    ]);
  });

  it("returns the verbatim paragraph that contains a quote, or null", () => {
    expect(passageFor(page, "waren er  in Nederland 1.200 EVENEMENTEN")).toBe("In 2025 waren er in Nederland 1.200 evenementen met meer dan 500 bezoekers.");
    expect(passageFor(page, "In 2025 waren er in Nederland 1.300 evenementen")).toBeNull();
    expect(passageFor(page, "kort")).toBeNull();
  });

  it("keeps only quotes literally on a fetched page, under the page's final URL", async () => {
    const fetchPage = vi.fn(async (url: string) => {
      if (url.includes("redirect")) return { url: "https://cbs.nl/final", title: "CBS", text: page };
      if (url.includes("broken")) throw new Error("404");
      return { url, title: null, text: "Niets relevants hier." };
    });
    const r = await verifyQuotedSources(
      "gemini",
      [
        { url: "https://example.nl/claimed", quotes: ["In 2025 waren er in Nederland 1.200 evenementen", "Een verzonnen zin die nergens staat"] },
        { url: "https://broken.nl/x", quotes: ["Andere alinea over iets anders"] },
      ],
      ["https://vertexaisearch.cloud.google.com/grounding-api-redirect/1"],
      fetchPage,
    );
    expect(r.quotes).toBe(3);
    expect(r.rejected).toBe(1);
    expect(r.pagesFailed).toBe(1);
    expect(r.sources).toEqual([
      {
        url: "https://cbs.nl/final",
        title: "CBS",
        pageAge: null,
        excerpts: ["In 2025 waren er in Nederland 1.200 evenementen met meer dan 500 bezoekers.", "Andere alinea over iets anders."],
        foundBy: ["gemini"],
      },
    ]);
  });

  it("merges sources by URL and records every provider, without duplicating passages", () => {
    const merged = mergeFoundSources([
      [{ url: "https://cbs.nl/a/", title: "A", pageAge: null, excerpts: ["x", "y"], foundBy: ["openai"] }],
      [
        { url: "https://cbs.nl/a#deel", title: "A2", pageAge: "2026-01-01", excerpts: ["y", "z"], foundBy: ["anthropic"] },
        { url: "https://other.nl", title: "B", pageAge: null, excerpts: ["q"], foundBy: ["anthropic"] },
      ],
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ url: "https://cbs.nl/a/", excerpts: ["x", "y", "z"], foundBy: ["anthropic", "openai"], pageAge: "2026-01-01" });
  });
});
