import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, runnerRpcs, type FakeDb } from "./helpers/fake-supabase";
import { makePdf } from "./helpers/pdf";

// Een hele onderzoeksrun (advanceRun tot de run klaar is) met een gemockte Claude-API, gemockt ophalen van pagina's
// en een in-memory database: drie vragen met (1) citaten, (2) alleen gelezen pagina's (tekst, PDF, lege pagina) en
// (3) alleen zoekresultaten die ProofLab zelf opent. Na afloop staan er letterlijke passages en een zoeklogboek
// met redenen per URL. Geen echte API, geen echte database.

const state = vi.hoisted(() => ({ client: null as unknown, pages: {} as Record<string, () => Promise<unknown>> }));

vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => state.client, supabaseAnon: () => state.client }));
vi.mock("@/lib/fetch-page", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/fetch-page")>();
  return {
    ...orig,
    fetchPageText: vi.fn(async (url: string) => {
      const page = state.pages[url];
      if (!page) throw new orig.PageFetchError("geblokkeerd", "Niet bereikbaar.");
      return page();
    }),
  };
});

const LONG = "Het aantal evenementenbureaus in Nederland steeg in 2025 naar 4.100 bedrijven, blijkt uit de jaarlijkse telling van de branche.";
const FILLER = "Overige tekst over het weer en het verkeer die niets met de vraag te maken heeft, maar de pagina wel lang genoeg maakt.";
const PDF_LINE = "Uit de telling blijkt dat in 2025 in Nederland 4100 evenementenbureaus actief waren, vooral kleine bedrijven.";

const msg = (content: unknown[], usage = { input_tokens: 2000, output_tokens: 300, server_tool_use: { web_search_requests: 1 } }) => ({
  id: "m",
  type: "message",
  role: "assistant",
  model: "claude-test",
  stop_reason: "end_turn",
  stop_sequence: null,
  content,
  usage,
});
const s = (id: string, query: string) => ({ type: "server_tool_use", id, name: "web_search", input: { query } });
const r = (id: string, urls: string[]) => ({
  type: "web_search_tool_result",
  tool_use_id: id,
  content: urls.map((url) => ({ type: "web_search_result", url, title: `T ${url}`, page_age: null, encrypted_content: "x" })),
});
const f = (id: string, url: string) => ({ type: "server_tool_use", id, name: "web_fetch", input: { url } });
const doc = (id: string, url: string, source: Record<string, unknown>) => ({
  type: "web_fetch_tool_result",
  tool_use_id: id,
  content: { type: "web_fetch_result", url, retrieved_at: null, content: { type: "document", title: `P ${url}`, citations: null, source } },
});

export function seedRun(questions: string[], budget = 1.5): FakeDb {
  const ideaId = "idea-1";
  const runId = "run-1";
  const db: FakeDb = {
    ideas: [
      {
        id: ideaId,
        org_id: "org-1",
        title: "Vergaderzaal-app",
        decision_question: "Investeren we?",
        description: "Een app voor evenementenbureaus",
        target_audience: "evenementenbureaus",
        audience_detail: null,
        region: "Nederland",
        region_detail: null,
        project_type: "new_product",
        sector_template: "events",
        key_uncertainty: null,
      },
    ],
    org_ai_settings: [],
    research_runs: [{ id: runId, idea_id: ideaId, mode: "quick", status: "queued", budget_usd: budget, cost_usd: 0, error: null, created_at: "2026-11-06T09:00:00Z" }],
    research_questions: questions.map((q, i) => ({ id: `q${i + 1}`, idea_id: ideaId, position: i + 1, question: q, status: "open" })),
    research_tasks: questions.map((_, i) => ({
      id: `t${i + 1}`,
      run_id: runId,
      idea_id: ideaId,
      position: i + 1,
      kind: "search",
      question_id: `q${i + 1}`,
      status: "pending",
      attempts: 0,
      label: `Zoeken vraag ${i + 1}`,
      cost_usd: 0,
      started_at: null,
    })),
    sources: [],
    source_excerpts: [],
    ai_runs: [],
    research_search_log: [],
  };
  return db;
}

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
});

describe("een hele onderzoeksrun met gemockte zoekrespons", () => {
  it("bewaart passages voor alle drie de gevallen en legt per zoekterm de redenen vast", async () => {
    const db = seedRun([
      "Hoeveel evenementenbureaus zijn er in Nederland?",
      "Hoeveel evenementenbureaus telde de branche in 2025?",
      "Hoeveel evenementenbureaus zijn er actief?",
    ]);
    state.client = fakeSupabase(db, runnerRpcs);
    state.pages = {
      "https://kvk.nl/tabel": async () => ({ url: "https://kvk.nl/tabel", title: "KVK", text: `${FILLER}\n${LONG}`, kind: "html" }),
      "https://spa.nl/": async () => ({ url: "https://spa.nl/", title: "App", text: "Laden…", kind: "html" }),
    };
    const responses = [
      // (1) citaten
      msg([
        s("s1", "aantal evenementenbureaus nederland"),
        r("s1", ["https://cbs.nl/a"]),
        f("f1", "https://cbs.nl/a"),
        doc("f1", "https://cbs.nl/a", { type: "text", media_type: "text/plain", data: `${FILLER}\n${LONG}` }),
        { type: "text", text: "Er zijn 4.100 bureaus.", citations: [{ type: "web_search_result_location", url: "https://cbs.nl/a", title: "CBS", cited_text: "steeg in 2025 naar 4.100 bedrijven", encrypted_index: "e" }] },
      ]),
      // (2) alleen gelezen pagina's, een PDF en een lege pagina, zonder citaten
      msg([
        s("s2", "evenementenbureaus telling 2025"),
        r("s2", ["https://branche.nl/rapport.pdf", "https://leeg.nl/"]),
        f("f2", "https://branche.nl/rapport.pdf"),
        doc("f2", "https://branche.nl/rapport.pdf", { type: "base64", media_type: "application/pdf", data: makePdf([PDF_LINE]).toString("base64") }),
        f("f3", "https://leeg.nl/"),
        doc("f3", "https://leeg.nl/", { type: "text", media_type: "text/plain", data: "Even geduld" }),
        { type: "text", text: "onbekend" },
      ]),
      // (3) alleen zoekresultaten; ProofLab opent ze zelf
      msg([s("s3", "evenementenbureaus actief"), r("s3", ["https://kvk.nl/tabel", "https://spa.nl/", "https://dicht.nl/"]), { type: "text", text: "onbekend" }]),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(responses.shift()), { status: 200, headers: { "content-type": "application/json" } })),
    );
    const { advanceRun } = await import("@/lib/research-runner");
    let st = await advanceRun("run-1");
    for (let i = 0; i < 10 && st.status !== "done"; i++) st = await advanceRun("run-1");
    expect(st.status).toBe("done");
    expect(db.research_tasks.map((t) => t.status)).toEqual(["done", "done", "done"]);

    // Passages bewaard voor elke vraag.
    const excerptIds = db.research_tasks.map((t) => ((t.output as { excerpt_ids: string[] }).excerpt_ids ?? []).length);
    expect(excerptIds.every((n) => n > 0)).toBe(true);
    expect(db.source_excerpts.some((e) => String(e.text).includes("4100 evenementenbureaus"))).toBe(true);

    // Eén logregel per zoekterm, met de redenen.
    const log = db.research_search_log;
    expect(log.map((l) => l.query)).toEqual(["aantal evenementenbureaus nederland", "evenementenbureaus telling 2025", "evenementenbureaus actief"]);
    const reasons = Object.fromEntries(log.flatMap((l) => (l.urls as { url: string; status: string }[]).map((u) => [u.url, u.status])));
    expect(reasons).toEqual({
      "https://cbs.nl/a": "bewaard",
      "https://branche.nl/rapport.pdf": "bewaard",
      "https://leeg.nl/": "lege_pagina",
      "https://kvk.nl/tabel": "bewaard",
      "https://spa.nl/": "lege_pagina",
      "https://dicht.nl/": "geblokkeerd",
    });
    expect(log.every((l) => l.run_id === "run-1" && l.idea_id === "idea-1" && l.provider === "anthropic")).toBe(true);
    expect(log.map((l) => l.question_id)).toEqual(["q1", "q2", "q3"]);
    expect(Number(db.research_runs[0].cost_usd)).toBeGreaterThan(0);
  });
});
