import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_TOKEN_SECONDS, SLICE_MS, runDoneNote, sliceDecision, tokenSecondsLeft, trustedOrigin } from "@/lib/research-worker-plan";
import { fakeSupabase, runnerRpcs } from "./helpers/fake-supabase";
import { seedRun } from "./helpers/research-fixtures";

// Fase B2, punt 4: de onderzoeksrun draait op de server in porties met een lease, met het token van de consultant.

const jwt = (exp: number) => `x.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.y`;

describe("regels van een serverportie", () => {
  it("leest de resterende geldigheid van het token", () => {
    const now = 1_000_000_000_000;
    expect(tokenSecondsLeft(jwt(now / 1000 + 600), now)).toBe(600);
    expect(tokenSecondsLeft(jwt(now / 1000 - 5), now)).toBe(0);
    expect(tokenSecondsLeft("geen-token", now)).toBe(0);
  });

  it("doet een stap, roept de volgende portie aan, pauzeert bij een kort geldig token of stopt", () => {
    const ok = MIN_TOKEN_SECONDS + 10;
    expect(sliceDecision({ status: "running", elapsedMs: 0, tokenSeconds: ok, hops: 0 })).toBe("run");
    expect(sliceDecision({ status: "running", elapsedMs: SLICE_MS + 1, tokenSeconds: ok, hops: 0 })).toBe("hop");
    expect(sliceDecision({ status: "running", elapsedMs: 0, tokenSeconds: MIN_TOKEN_SECONDS - 1, hops: 0 })).toBe("pause");
    expect(sliceDecision({ status: "running", elapsedMs: SLICE_MS + 1, tokenSeconds: ok, hops: 999 })).toBe("pause");
    expect(sliceDecision({ status: "done", elapsedMs: 0, tokenSeconds: ok, hops: 0 })).toBe("stop");
    expect(sliceDecision({ status: "cancelled", elapsedMs: 0, tokenSeconds: ok, hops: 0 })).toBe("stop");
  });

  it("roept alleen de eigen app aan", () => {
    const known = ["https://prooflab.nl", "prooflab-git-main.vercel.app"];
    expect(trustedOrigin("https://prooflab.nl", known, "https://prooflab.nl")).toBe("https://prooflab.nl");
    expect(trustedOrigin("https://prooflab-git-main.vercel.app", known, "https://prooflab.nl")).toBe("https://prooflab-git-main.vercel.app");
    expect(trustedOrigin("https://evil.example", known, "https://prooflab.nl/")).toBe("https://prooflab.nl");
    expect(trustedOrigin("http://prooflab.nl", known, "https://prooflab.nl")).toBe("https://prooflab.nl");
    expect(trustedOrigin("http://localhost:3000", known, "https://prooflab.nl")).toBe("https://prooflab.nl");
    expect(trustedOrigin("http://localhost:3000", known, "https://prooflab.nl", true)).toBe("http://localhost:3000");
  });

  it("maakt een melding met bevindingen, kosten en wat niet is gedaan", () => {
    const n = runDoneNote({ runId: "12345678-aaaa", ideaId: "i1", mode: "quick", costUsd: 0.734, budgetUsd: 1.5, claims: 7, counterClaims: 2, skipped: 3, failed: 1 });
    expect(n.code).toBe("research_run_done:12345678");
    expect(n.title).toBe("Snelle marktcheck klaar");
    expect(n.body).toMatch(/7 bevindingen met gecontroleerd citaat, waarvan 2 tegenbewijs\. Kosten \$0,73 van max \$1,50\. 3 stappen niet uitgevoerd.*1 stap mislukt/);
    expect(n.href).toBe("/app/ideas/i1/research");
  });
});

const state = vi.hoisted(() => ({ client: null as unknown, advance: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => state.client,
  supabaseAnon: () => state.client,
  supabaseWithToken: () => state.client,
  withSupabaseClient: (_c: unknown, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("RESEARCH_BUDGET_USD", "3");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock("@/lib/research-runner");
});

const token = () => jwt(Date.now() / 1000 + 3600);

describe("een serverportie (in-memory database)", () => {
  it("werkt niet als een andere portie de lease heeft", async () => {
    const db = seedRun(["Willen kantoren € 249 betalen?"]);
    state.client = fakeSupabase(db, { ...runnerRpcs, research_run_lease: () => false, research_run_release: () => null });
    const advance = vi.fn();
    vi.doMock("@/lib/research-runner", () => ({ advanceRun: advance }));
    const { workOnRun } = await import("@/lib/research-worker");
    await workOnRun("run-1", token(), "https://prooflab.nl");
    expect(advance).not.toHaveBeenCalled();
  });

  it("werkt stappen af tot de run klaar is, geeft de lease vrij en roept geen volgende portie aan", async () => {
    const db = seedRun(["Willen kantoren € 249 betalen?"]);
    const leases: string[] = [];
    state.client = fakeSupabase(db, {
      ...runnerRpcs,
      research_run_lease: (a) => (leases.push(`take:${a.p_run}`), true),
      research_run_release: (a) => (leases.push(`release:${a.p_run}`), null),
    });
    const states = [
      { status: "running", done: 1, total: 3, current: "b", cost: 0.1, budget: 1.5, error: null },
      { status: "running", done: 2, total: 3, current: "c", cost: 0.2, budget: 1.5, error: null },
      { status: "done", done: 3, total: 3, current: null, cost: 0.3, budget: 1.5, error: null },
    ];
    const advance = vi.fn(async () => states.shift());
    vi.doMock("@/lib/research-runner", () => ({ advanceRun: advance }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { workOnRun } = await import("@/lib/research-worker");
    await workOnRun("run-1", token(), "https://prooflab.nl");
    expect(advance).toHaveBeenCalledTimes(3);
    expect(leases[0]).toBe("take:run-1");
    expect(leases.at(-1)).toBe("release:run-1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pauzeert zonder stap als het token te kort geldig is", async () => {
    const db = seedRun(["Willen kantoren € 249 betalen?"]);
    state.client = fakeSupabase(db, { ...runnerRpcs, research_run_lease: () => true, research_run_release: () => null });
    const advance = vi.fn();
    vi.doMock("@/lib/research-runner", () => ({ advanceRun: advance }));
    const { workOnRun } = await import("@/lib/research-worker");
    await workOnRun("run-1", jwt(Date.now() / 1000 + 60), "https://prooflab.nl");
    expect(advance).not.toHaveBeenCalled();
  });
});

describe("melding als de run klaar is", () => {
  it("zet een coachnotitie klaar zodra de laatste stap is afgerond", async () => {
    const db = seedRun(["Willen kantoren € 249 betalen?"]);
    db.research_tasks[0].status = "done";
    db.research_tasks[0].output = { excerpt_ids: [] };
    state.client = fakeSupabase(db, runnerRpcs);
    const { advanceRun } = await import("@/lib/research-runner");
    const st = await advanceRun("run-1");
    expect(st.status).toBe("done");
    expect(db.coach_notes).toHaveLength(1);
    expect(db.coach_notes[0]).toMatchObject({ idea_id: "idea-1", code: "research_run_done:run-1", source: "system", audience: "consultant", href: "/app/ideas/idea-1/research" });
    // Een tweede aanroep maakt geen tweede melding.
    await advanceRun("run-1");
    expect(db.coach_notes).toHaveLength(1);
  });
});
