import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, runnerRpcs } from "./helpers/fake-supabase";
import { makePdf } from "./helpers/pdf";
import { doc, f, FILLER, LONG, msg, PDF_LINE, r, s, seedRun } from "./helpers/research-fixtures";

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
