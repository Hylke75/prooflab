import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, runnerRpcs } from "./helpers/fake-supabase";
import { addRun, doc, f, FILLER, LONG, msg, r, s, seedRun } from "./helpers/research-fixtures";
import { RunBudget } from "@/lib/ai/budget";
import { DEFAULT_RESEARCH_MODELS, estimateCostUsd, modelFor, PRICES, priceFor } from "@/lib/ai/providers/config";
import { roundEstimate } from "@/lib/ai/providers/anthropic";

// Budgetbewaking van onderzoeksruns: vóór elke modelaanroep (ook elke zoekronde) een geschatte prijs met 20% marge,
// hard stoppen als het maximum van de run zou worden overschreden, het goedkopere onderzoeksmodel, hergebruik van
// zoekresultaten binnen 7 dagen en vroeg stoppen zonder bruikbare URL's. Alles gemockt.

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
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("ANTHROPIC_RESEARCH_MODEL", "");
  vi.stubEnv("RESEARCH_BUDGET_USD", "3");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Call = { body: { model: string; tools?: { name: string; max_uses: number }[]; messages: unknown[] } };

function api(responses: unknown[] | ((i: number) => unknown)) {
  const calls: Call[] = [];
  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    calls.push({ body: JSON.parse(String(init?.body)) });
    const next = typeof responses === "function" ? responses(calls.length - 1) : responses.shift();
    if (!next) throw new Error("onverwachte aanroep");
    // Like the API: the response names the model that was asked for (its price is what the run pays).
    const body = { ...(next as Record<string, unknown>), model: calls[calls.length - 1].body.model };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

async function runToEnd(runId: string) {
  const { advanceRun } = await import("@/lib/research-runner");
  let st = await advanceRun(runId);
  for (let i = 0; i < 20 && !["done", "failed"].includes(st.status); i++) st = await advanceRun(runId);
  return st;
}

describe("run-budget", () => {
  it("reserveert schattingen, weigert wat niet past en boekt de werkelijke kosten", () => {
    const b = new RunBudget(1, 0.4);
    const a = b.reserve(0.3, "a")!;
    expect(b.remaining).toBeCloseTo(0.3, 6);
    expect(b.reserve(0.31, "b")).toBeNull();
    expect(b.hit).toMatch(/Budget van deze run bereikt/);
    a.settle(0.1);
    a.settle(5); // tweede keer telt niet
    expect(b.spent).toBeCloseTo(0.1, 6);
    expect(b.remaining).toBeCloseTo(0.5, 6);
  });

  it("schat met de prijs uit de prijstabel plus 20% marge", () => {
    const m = DEFAULT_RESEARCH_MODELS.anthropic;
    const p = priceFor("anthropic", m);
    expect(estimateCostUsd("anthropic", m, { inputTokens: 1_000_000, outputTokens: 0, searches: 0 })).toBeCloseTo(p.input * 1.2, 6);
    // Een zoekronde met n toolgebruiken telt de context n+1 keer plus de groeiende toolresultaten.
    expect(roundEstimate(m, 1000, 1, 0, 0)).toBeCloseTo(((2 * 1000 + 10_000) * p.input) / 1e6 * 1.2 + p.perSearch * 1.2, 6);
  });

  it("de run komt nooit boven budget_usd: de zoeklus stopt vóór de ronde die niet meer past", async () => {
    const db = seedRun(["Hoeveel evenementenbureaus zijn er?", "Wat betalen bureaus nu?", "Welke alternatieven zijn er?"], 0.5);
    state.client = fakeSupabase(db, runnerRpcs);
    // Elke ronde pauzeert met een zoekresultaat en kost werkelijk 150k invoertokens (binnen de schatting).
    const calls = api((i) =>
      msg([s(`s${i}`, `zoekterm ${i}`), r(`s${i}`, [`https://bron-${i}.nl/`])], { input_tokens: 150_000, output_tokens: 4000, server_tool_use: { web_search_requests: 1 } }, "pause_turn"),
    );
    const st = await runToEnd("run-1");
    const run = db.research_runs[0];
    expect(Number(run.cost_usd)).toBeGreaterThan(0);
    expect(Number(run.cost_usd)).toBeLessThanOrEqual(0.5);
    expect(st.cost).toBeLessThanOrEqual(st.budget);
    expect(String(run.error)).toMatch(/Budget van deze run bereikt/);
    expect(db.research_tasks.some((t) => String(t.detail).includes("Budget"))).toBe(true);
    expect(db.research_tasks.some((t) => t.status === "skipped")).toBe(true);
    // Alle zoekrondes draaiden op het goedkopere onderzoeksmodel.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.body.model === DEFAULT_RESEARCH_MODELS.anthropic)).toBe(true);
    // Zoek- en ophaaltegoed geldt voor de hele lus, niet per ronde.
    expect(calls[1]?.body.tools?.find((t) => t.name === "web_search")?.max_uses).toBe(2);
  });

  it("met budget 0 gaat er geen enkele aanroep de deur uit", async () => {
    const db = seedRun(["Hoeveel evenementenbureaus zijn er?"], 0.01);
    state.client = fakeSupabase(db, runnerRpcs);
    const calls = api([]);
    await runToEnd("run-1");
    expect(calls).toHaveLength(0);
    expect(Number(db.research_runs[0].cost_usd)).toBe(0);
    expect(String(db.research_runs[0].error)).toMatch(/Budget/);
  });
});

describe("goedkoper model voor zoeken en uitlezen", () => {
  it("heeft per aanbieder een onderzoeksmodel met prijs, te overschrijven per omgeving", () => {
    for (const p of ["anthropic", "openai", "gemini"] as const) {
      expect(PRICES[p][DEFAULT_RESEARCH_MODELS[p]]).toBeDefined();
      expect(priceFor(p, DEFAULT_RESEARCH_MODELS[p]).input).toBeLessThan(priceFor(p).input);
      expect(modelFor(p, {}, "research")).toBe(DEFAULT_RESEARCH_MODELS[p]);
    }
    expect(modelFor("openai", { OPENAI_RESEARCH_MODEL: " gpt-klein " }, "research")).toBe("gpt-klein");
    expect(modelFor("gemini", { GEMINI_RESEARCH_MODEL: "x", GEMINI_MODEL: "y" })).toBe("y");
  });
});

describe("hergebruik en vroeg stoppen", () => {
  it("dezelfde vraag binnen 7 dagen wordt niet opnieuw betaald", async () => {
    const db = seedRun(["Hoeveel evenementenbureaus zijn er in Nederland?"]);
    state.client = fakeSupabase(db, runnerRpcs);
    const calls = api([
      msg([
        s("s1", "aantal evenementenbureaus"),
        r("s1", ["https://cbs.nl/a"]),
        f("f1", "https://cbs.nl/a"),
        doc("f1", "https://cbs.nl/a", { type: "text", media_type: "text/plain", data: `${FILLER}\n${LONG}` }),
        { type: "text", text: "4.100", citations: [{ type: "web_search_result_location", url: "https://cbs.nl/a", title: "CBS", cited_text: "steeg in 2025 naar 4.100 bedrijven", encrypted_index: "e" }] },
      ]),
    ]);
    await runToEnd("run-1");
    expect(calls).toHaveLength(1);
    const firstIds = (db.research_tasks[0].output as { excerpt_ids: string[] }).excerpt_ids;
    expect(firstIds.length).toBeGreaterThan(0);

    addRun(db, "run-2");
    await runToEnd("run-2");
    expect(calls).toHaveLength(1);
    const second = db.research_tasks.find((t) => t.run_id === "run-2")!;
    expect((second.output as { excerpt_ids: string[] }).excerpt_ids).toEqual(firstIds);
    expect(String(second.detail)).toMatch(/niet opnieuw betaald/);
    const reused = db.research_search_log.filter((l) => l.run_id === "run-2");
    expect(reused).toHaveLength(1);
    expect(reused[0]).toMatchObject({ reused: true, query: "aantal evenementenbureaus", provider: "anthropic" });
    expect(Number(db.research_runs[1].cost_usd)).toBe(0);
  });

  it("een eerdere zoekopdracht zonder passages wordt niet hergebruikt", async () => {
    const db = seedRun(["Hoeveel evenementenbureaus zijn er in Nederland?"]);
    state.client = fakeSupabase(db, runnerRpcs);
    const calls = api([msg([s("s1", "niets"), r("s1", [])]), msg([s("s1", "niets"), r("s1", [])])]);
    await runToEnd("run-1");
    addRun(db, "run-2");
    await runToEnd("run-2");
    expect(calls).toHaveLength(2);
  });

  it("stopt een vraag na de eerste ronde als die geen bruikbare URL oplevert", async () => {
    const db = seedRun(["Hoeveel evenementenbureaus zijn er in Nederland?"]);
    state.client = fakeSupabase(db, runnerRpcs);
    const calls = api((i) => msg([s(`s${i}`, "niets te vinden"), r(`s${i}`, ["https://www.youtube.com/watch?v=1"])], undefined, "pause_turn"));
    await runToEnd("run-1");
    expect(calls).toHaveLength(1);
    expect(db.research_search_log[0]).toMatchObject({ query: "niets te vinden", passages: 0 });
  });
});
