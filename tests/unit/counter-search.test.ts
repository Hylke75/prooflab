import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, runnerRpcs } from "./helpers/fake-supabase";
import { doc, f, FILLER, msg, r, s, seedRun } from "./helpers/research-fixtures";

// Golf C, punt 10: per onderzoeksvraag een aparte zoekopdracht naar tegenbewijs. Met een gemockte Claude-API en een
// in-memory database: de stap zoekt met de tegenbewijs-instructie, logt elke zoekterm met kind 'counter', bewaart de
// passages als fragmenten en legt alleen tegenbevindingen met een letterlijk citaat vast (relatie 'contradicts').

const state = vi.hoisted(() => ({ client: null as unknown, bodies: [] as string[] }));

vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => state.client, supabaseAnon: () => state.client }));
// De statusberekening leest joins die de nep-database niet kent; die is hier niet het onderwerp.
vi.mock("@/lib/claims", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/claims")>()), recomputeClaim: vi.fn(async () => null) }));
vi.mock("@/lib/fetch-page", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/fetch-page")>();
  return { ...orig, fetchPageText: vi.fn(async () => Promise.reject(new orig.PageFetchError("geblokkeerd", "Niet bereikbaar."))) };
});

const AGAINST = "Het aantal evenementenbureaus in Nederland daalde in 2025 met 12 procent, meldt de brancheorganisatie.";
const CITED = "daalde in 2025 met 12 procent";

const json = (data: unknown) => msg([{ type: "text", text: JSON.stringify(data) }], { input_tokens: 800, output_tokens: 200 });
const claim = (over: Record<string, unknown>) => ({
  statement: "Het aantal evenementenbureaus in Nederland daalde in 2025 met 12 procent.",
  section: "market",
  evidence_type: "third_party_estimate",
  excerpt_ref: "F1",
  quote: CITED,
  stance: "contradicts",
  population: "evenementenbureaus",
  region: "Nederland",
  reference_date: "2025",
  period: "2025",
  numeric_value: 12,
  unit: "procent",
  definition: null,
  supports: "Een krimpende markt",
  does_not_prove: "Dat bureaus geen behoefte hebben",
  limitations: null,
  freshness_kind: "statistic",
  ...over,
});

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("RESEARCH_BUDGET_USD", "3");
  state.bodies = [];
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function counterRun() {
  const db = seedRun(["Hoeveel evenementenbureaus zijn er in Nederland?"]);
  db.research_tasks[0].kind = "counter";
  db.research_tasks[0].label = "Tegenbewijs zoeken: vraag 1";
  return db;
}

function mockApi(responses: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      state.bodies.push(typeof init?.body === "string" ? init.body : "");
      return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
}

describe("zoekopdracht naar tegenbewijs (gemockte zoekrespons)", () => {
  it("logt als 'counter' en legt alleen tegenbevindingen met letterlijk citaat vast als 'contradicts'", async () => {
    const db = counterRun();
    state.client = fakeSupabase(db, runnerRpcs);
    mockApi([
      // 1. Zoeken naar tegenbewijs: één zoekterm, één geopende pagina met citaat.
      msg([
        s("s1", "evenementenbureaus krimp nederland"),
        r("s1", ["https://branche.nl/krimp"]),
        f("f1", "https://branche.nl/krimp"),
        doc("f1", "https://branche.nl/krimp", { type: "text", media_type: "text/plain", data: `${FILLER}\n${AGAINST}` }),
        { type: "text", text: "De markt krimpt.", citations: [{ type: "web_search_result_location", url: "https://branche.nl/krimp", title: "Branche", cited_text: CITED, encrypted_index: "e" }] },
      ]),
      // 2. Uitlezen: één tegenbevinding, één bevestigende bewering en één verzonnen citaat.
      json({
        sources: [],
        claims: [
          claim({}),
          claim({ statement: "Er zijn veel evenementenbureaus in Nederland.", quote: "evenementenbureaus in Nederland", stance: "supports", numeric_value: null }),
          claim({ statement: "Het aantal bureaus halveerde.", quote: "het aantal bureaus halveerde", numeric_value: null }),
        ],
        competitors: [],
      }),
      // 3. Steuncontrole van de tegenbevinding.
      json({ verdict: "supports", reason: "Het citaat noemt de daling." }),
    ]);
    const { advanceRun } = await import("@/lib/research-runner");
    let st = await advanceRun("run-1");
    for (let i = 0; i < 5 && st.status !== "done"; i++) st = await advanceRun("run-1");
    expect(st.status).toBe("done");
    const task = db.research_tasks[0];
    expect(task.status).toBe("done");

    // De zoekopdracht vroeg om tegenbewijs (niet om bevestiging) en ging naar het goedkope onderzoeksmodel.
    expect(state.bodies[0]).toContain("TEGENBEWIJS");
    expect(state.bodies[1]).toContain("zoekopdracht naar tegenbewijs");
    const { modelFor } = await import("@/lib/ai/providers/config");
    const research = modelFor("anthropic", process.env, "research");
    expect(state.bodies.slice(0, 2).map((b) => JSON.parse(b).model)).toEqual([research, research]);

    // Zoeklogboek: elke zoekterm met kind 'counter'.
    expect(db.research_search_log).toHaveLength(1);
    expect(db.research_search_log[0]).toMatchObject({ kind: "counter", query: "evenementenbureaus krimp nederland", question_id: "q1", passages: 1 });

    // De passage is een fragment in de bronnenbibliotheek.
    expect(db.source_excerpts.some((e) => String(e.text).includes(CITED))).toBe(true);

    // Alleen de tegenbevinding met letterlijk citaat is vastgelegd, met relatie 'contradicts'.
    expect(db.claims).toHaveLength(1);
    expect(db.claims[0]).toMatchObject({ question_id: "q1", origin: "ai", population: "evenementenbureaus", region: "Nederland", reference_date: "2025" });
    expect(db.claim_sources).toHaveLength(1);
    expect(db.claim_sources[0]).toMatchObject({ stance: "contradicts", quote_check: "exact", quote: CITED, support_check: "supports" });
    expect(task.output).toMatchObject({ claims: 1, rejected: 1, not_counter: 1 });
    expect(String(task.detail)).toContain("1 tegenbevinding met gecontroleerd citaat");
    expect(Number(db.research_runs[0].cost_usd)).toBeGreaterThan(0);
  });

  it("meldt eerlijk dat niets is gevonden en hergebruikt een gewone zoekopdracht niet als tegenbewijs", async () => {
    const db = counterRun();
    // Een eerdere gewone zoekopdracht voor dezelfde vraag (kind 'search') telt niet als zoeken naar tegenbewijs.
    db.research_search_log.push({ id: "l0", idea_id: "idea-1", task_id: "oud", provider: "anthropic", query: "oud", question: "Hoeveel evenementenbureaus zijn er in Nederland?", urls: [], passages: 3, reused: false, kind: "search", created_at: new Date().toISOString() });
    db.research_tasks.push({ id: "oud", run_id: "run-0", idea_id: "idea-1", kind: "search", status: "done", output: { excerpt_ids: ["x1"] } });
    db.source_excerpts.push({ id: "x1", idea_id: "idea-1", source_id: "s1", text: "Oude passage" });
    state.client = fakeSupabase(db, runnerRpcs);
    mockApi([msg([s("s1", "evenementenbureaus faillissementen"), r("s1", []), { type: "text", text: "onbekend" }])]);
    const { advanceRun } = await import("@/lib/research-runner");
    let st = await advanceRun("run-1");
    for (let i = 0; i < 5 && st.status !== "done"; i++) st = await advanceRun("run-1");
    const task = db.research_tasks.find((t) => t.id === "run-1-t1")!;
    expect(task.status).toBe("done");
    expect(task.output).toMatchObject({ excerpt_ids: [], claims: 0, reused_from: [] });
    expect(String(task.detail)).toContain("Dat bewijst niet");
    expect(db.research_search_log.filter((l) => l.kind === "counter")).toHaveLength(1);
    expect(db.claims ?? []).toHaveLength(0);
  });

  it("stopt binnen het runbudget: zonder budget start de stap niet", async () => {
    const db = counterRun();
    db.research_runs[0].cost_usd = 1.5; // budget van de run (1,5) is op
    state.client = fakeSupabase(db, runnerRpcs);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { advanceRun } = await import("@/lib/research-runner");
    await advanceRun("run-1");
    expect(db.research_tasks[0]).toMatchObject({ status: "skipped", detail: "Budget van deze run bereikt." });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
