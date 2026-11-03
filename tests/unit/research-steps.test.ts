import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  coreEstimateUsd,
  estimateRun,
  estimateText,
  fitsBudget,
  notStartedText,
  planSteps,
  providersForRun,
  runBudgetUsd,
  searchEstimateUsd,
  stepEstimateUsd,
} from "@/lib/research-steps";
import { decisiveFirst } from "@/lib/research-questions";
import { DEFAULT_RESEARCH_MODELS, estimateCostUsd, priceFor } from "@/lib/ai/providers/config";
import { fakeSupabase, runnerRpcs } from "./helpers/fake-supabase";
import { seedRun } from "./helpers/research-fixtures";

// Fase B2, punten 2 en 3: de beslissende vraag eerst, en een hard kostenplafond per stap.

const QS = [1, 2, 3, 4, 5].map((i) => ({ id: `q${i}`, position: i, is_decisive: i === 4 }));

describe("volgorde van een run", () => {
  it("snelle check: eerst de beslissende vraag met tegenbewijs, dan de andere vragen, hun tegenbewijs als laatste", () => {
    const steps = planSteps(decisiveFirst(QS), "quick");
    expect(steps.slice(0, 3).map((s) => [s.kind, s.questionId, s.core])).toEqual([
      ["search", "q4", true],
      ["extract", "q4", true],
      ["counter", "q4", true],
    ]);
    expect(steps[0].label).toBe("Bronnen zoeken: beslissende vraag (vraag 4)");
    expect(steps.slice(3, 11).map((s) => `${s.kind}:${s.questionId}`)).toEqual([
      "search:q1", "extract:q1", "search:q2", "extract:q2", "search:q3", "extract:q3", "search:q5", "extract:q5",
    ]);
    expect(steps.slice(11, -1).every((s) => s.kind === "counter" && !s.core)).toBe(true);
    // Tot slot: wat dit betekent voor de grootste onzekerheid.
    expect(steps.at(-1)).toMatchObject({ kind: "uncertainty", questionId: null, core: true });
    expect(steps.some((s) => s.kind === "reality_check")).toBe(false);
  });

  it("diep onderzoek: per vraag zoeken, uitlezen en tegenbewijs, en tot slot de reality-check", () => {
    const steps = planSteps(decisiveFirst(QS), "deep");
    expect(steps[0]).toMatchObject({ kind: "search", questionId: "q4", core: true });
    expect(steps.filter((s) => s.kind === "counter")).toHaveLength(5);
    expect(steps.at(-2)?.kind).toBe("reality_check");
    expect(steps.at(-1)?.kind).toBe("uncertainty");
  });

  it("zonder beslissende vraag gaat de eerste vraag voor", () => {
    const steps = planSteps(decisiveFirst(QS.map(({ id, position }) => ({ id, position }))), "quick");
    expect(steps[0]).toMatchObject({ questionId: "q1", label: "Bronnen zoeken: vraag 1" });
    expect(planSteps([], "quick")).toEqual([]);
  });
});

describe("kostenplafond", () => {
  it("start een stap alleen als uitgegeven + bovengrens binnen het plafond blijft", () => {
    expect(fitsBudget(1.2, 0.3, 1.5)).toBe(true);
    expect(fitsBudget(1.21, 0.3, 1.5)).toBe(false);
    expect(notStartedText(0.3, 1.21, 1.5)).toMatch(/^Budget van deze run reikt niet.*\$0,30.*\$0,29.*\$1,50.*Niet gestart\.$/);
  });

  it("de bovengrens groeit met het aantal aanbieders en rekent Gemini ruimer", () => {
    const one = stepEstimateUsd("search", ["anthropic"], "quick");
    const two = stepEstimateUsd("search", ["anthropic", "openai"], "quick");
    expect(two).toBeGreaterThan(one);
    // Gemini kent geen maximum aantal zoekopdrachten: dubbele ruimte.
    expect(searchEstimateUsd("gemini", 3)).toBeCloseTo(
      estimateCostUsd("gemini", DEFAULT_RESEARCH_MODELS.gemini, { inputTokens: 2500 + 6 * 10_000, outputTokens: 16_000, searches: 6 }),
      6,
    );
    expect(stepEstimateUsd("counter", ["anthropic"], "quick")).toBeGreaterThan(stepEstimateUsd("extract", ["anthropic"], "quick"));
    expect(stepEstimateUsd("search", [], "quick")).toBe(0);
  });

  it("de snelle check zoekt met zoveel aanbieders als er passen terwijl de kern binnen het plafond blijft", () => {
    const all = ["anthropic", "openai", "gemini"] as const;
    const cap = runBudgetUsd("quick", 3);
    expect(cap).toBe(1.5);
    const used = providersForRun([...all], "quick", cap);
    expect(used.length).toBeGreaterThanOrEqual(1);
    expect(coreEstimateUsd(used, "quick")).toBeLessThanOrEqual(cap);
    expect(used[0]).toBe("anthropic");
    // Diep onderzoek gebruikt elke verbonden aanbieder.
    expect(providersForRun([...all], "deep", 3)).toEqual([...all]);
  });

  it("prijst een gedateerde modelvariant als het gevraagde model, niet als het zware model", () => {
    const research = DEFAULT_RESEARCH_MODELS.anthropic;
    expect(priceFor("anthropic", `${research}-20261101`)).toEqual(priceFor("anthropic", research));
    expect(priceFor("anthropic", "iets-onbekends")).toEqual(priceFor("anthropic"));
  });

  it("toont vóór de start een schatting die nooit boven het plafond uitkomt", () => {
    const e = estimateRun(planSteps(decisiveFirst(QS), "quick"), ["anthropic"], "quick", 1.5);
    expect(e.lowUsd).toBeGreaterThan(0);
    expect(e.lowUsd).toBeLessThanOrEqual(e.highUsd);
    expect(e.highUsd).toBeLessThanOrEqual(1.5);
    expect(estimateText(e)).toMatch(/^geschat: \$\d+,\d{2}–\$1,50 van max \$1,50$/);
  });
});

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => state.client, supabaseAnon: () => state.client }));

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

describe("runner met hard plafond (in-memory database, geen API)", () => {
  it("start geen stap die niet past, slaat de uitleesstap van een overgeslagen zoekstap over en doet geen aanroep", async () => {
    const db = seedRun(["Willen kantoren € 249 per maand betalen?"], 0.2);
    db.research_tasks.push(
      { id: "run-1-t2", run_id: "run-1", idea_id: "idea-1", position: 2, kind: "extract", question_id: "q1", status: "pending", attempts: 0, label: "Citaten", cost_usd: 0, started_at: null },
      { id: "run-1-t3", run_id: "run-1", idea_id: "idea-1", position: 3, kind: "counter", question_id: "q1", status: "pending", attempts: 0, label: "Tegenbewijs", cost_usd: 0, started_at: null },
    );
    state.client = fakeSupabase(db, runnerRpcs);
    const fetchMock = vi.fn(async () => {
      throw new Error("onverwachte aanroep");
    });
    vi.stubGlobal("fetch", fetchMock);
    const { advanceRun } = await import("@/lib/research-runner");
    const st = await advanceRun("run-1");
    expect(st.status).toBe("done");
    expect(fetchMock).not.toHaveBeenCalled();
    const [search, extract, counter] = db.research_tasks;
    expect(search.status).toBe("skipped");
    expect(String(search.detail)).toMatch(/Budget van deze run reikt niet/);
    expect(extract.status).toBe("skipped");
    expect(String(extract.detail)).toMatch(/zoekstap van deze vraag is niet uitgevoerd/);
    expect(counter.status).toBe("skipped");
    expect(Number(db.research_runs[0].cost_usd)).toBe(0);
    expect(String(db.research_runs[0].error)).toMatch(/Budget van deze run bereikt/);
  });
});
