import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { passagesPerRun, twoZeroRunsInARow, zeroSourceRuns } from "@/lib/domain/research-health";
import { fakeSupabase, runnerRpcs } from "./helpers/fake-supabase";
import { addRun, msg, r, s, seedRun } from "./helpers/research-fixtures";

// Melding bij onderzoeksruns zonder bronnen: twee opeenvolgende runs van hetzelfde idee zonder één bewaarde passage
// leveren de fout "research_zero_sources" op (naar Sentry als SENTRY_DSN gezet is); één lege run niet.

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => state.client, supabaseAnon: () => state.client }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("SENTRY_DSN", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("passages per run", () => {
  it("telt alleen zoekstappen en herkent runs zonder bronnen", () => {
    const tasks = [
      { run_id: "a", kind: "search", output: { excerpt_ids: ["1", "2"] } },
      { run_id: "a", kind: "extract", output: { claims: 3 } },
      { run_id: "b", kind: "search", output: { excerpt_ids: [] } },
      { run_id: "b", kind: "search", output: null },
    ];
    expect(passagesPerRun(tasks)).toEqual(new Map([["a", 2], ["b", 0]]));
    expect(zeroSourceRuns(["a", "b", "c"], tasks)).toEqual(["b"]);
    expect(twoZeroRunsInARow(0, 0)).toBe(true);
    expect(twoZeroRunsInARow(0, 3)).toBe(false);
    expect(twoZeroRunsInARow(0, undefined)).toBe(false);
  });
});

describe("research_zero_sources", () => {
  it("meldt een fout na twee opeenvolgende runs zonder bronnen, niet na één", async () => {
    const db = seedRun(["Hoeveel evenementenbureaus zijn er in Nederland?"]);
    db.research_runs[0].created_at = new Date(Date.now() - 3600_000).toISOString();
    state.client = fakeSupabase(db, runnerRpcs);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(msg([s("s1", "niets"), r("s1", [])])), { status: 200, headers: { "content-type": "application/json" } })));
    const { setLogSink } = await import("@/lib/log");
    const records: { level: string; event: string }[] = [];
    setLogSink((rec) => records.push(rec));
    const { advanceRun } = await import("@/lib/research-runner");
    const run = async (id: string) => {
      let st = await advanceRun(id);
      for (let i = 0; i < 5 && st.status !== "done"; i++) st = await advanceRun(id);
      return st;
    };
    await run("run-1");
    expect(records.filter((x) => x.event === "research_zero_sources")).toHaveLength(0);
    addRun(db, "run-2");
    await run("run-2");
    const alerts = records.filter((x) => x.event === "research_zero_sources");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ level: "error", ideaId: "idea-1", runId: "run-2", previousRunId: "run-1" });
    setLogSink(null);
  });
});
