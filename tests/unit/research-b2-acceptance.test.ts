import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { templatePlan } from "@/lib/domain/research-plan";
import { decisiveFirst } from "@/lib/research-questions";
import { planSteps, runBudgetUsd } from "@/lib/research-steps";
import { fakeSupabase, runnerRpcs, type FakeDb } from "./helpers/fake-supabase";
import { msg, r, s } from "./helpers/research-fixtures";

// Fase B2, "klaar als": een snelle check op het testdossier onderzoekt de prijsvraag (eerst) en blijft binnen het
// plafond. Het testdossier heeft nog de oude sjabloonvragen met de brede doelgroep. Gemockte API (elke zoekronde
// kost werkelijk geld), in-memory database; het doorlopen zonder tabblad zit in research-worker.test.ts.

const state = vi.hoisted(() => ({ client: null as unknown, bodies: [] as string[] }));
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
  state.bodies = [];
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const IDEA = {
  id: "idea-1",
  org_id: "org-1",
  title: "Makelaarsassistent",
  decision_question: "Investeren we € 40.000 in een eerste versie?",
  description: "Een AI-assistent die makelaars helpt woningteksten en bezichtigingsverslagen te maken.",
  target_audience: "Zakelijke klanten (B2B)",
  audience_detail: "zelfstandige NVM-kantoren met 2–15 medewerkers",
  region: "Nederland",
  region_detail: null,
  project_type: "new_product",
  sector_template: "smb",
  key_uncertainty: "Willen ze € 249 per maand betalen?",
  outcome_min_value_per_customer: null,
};

function testDossier(): FakeDb {
  const plan = templatePlan("new_product", "smb", { audience: IDEA.target_audience, region: IDEA.region });
  return {
    ideas: [{ ...IDEA }],
    org_ai_settings: [],
    research_questions: plan.map((q, i) => ({ ...q, id: `q${i + 1}`, idea_id: IDEA.id, position: i + 1, origin: "template", status: "open", is_decisive: false })),
    research_runs: [],
    research_tasks: [],
    sources: [],
    source_excerpts: [],
    claims: [],
    claim_sources: [],
    ai_runs: [],
    research_search_log: [],
    uncertainty_findings: [],
    coach_notes: [],
  };
}

describe("snelle check op het testdossier", () => {
  it("leidt de vragen af, onderzoekt de prijsvraag eerst en blijft binnen $1,50", async () => {
    const db = testDossier();
    state.client = fakeSupabase(db, runnerRpcs);
    // Elke zoekronde kost werkelijk ~$0,15 (250k invoertokens) en levert alleen zoekresultaten die niet te openen zijn.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: unknown, init?: { body?: unknown }) => {
        // Alleen de AI-aanbieder antwoordt; andere adressen (zoals CBS) zijn in deze test niet bereikbaar.
        if (!String(u).includes("anthropic")) return new Response("niet gevonden", { status: 404 });
        const body = typeof init?.body === "string" ? init.body : "";
        state.bodies.push(body);
        const n = state.bodies.length;
        // Zoals de API: het antwoord noemt een gedateerde variant van het gevraagde model.
        const model = `${(JSON.parse(body || "{}") as { model?: string }).model ?? "onbekend"}-20261101`;
        return new Response(
          JSON.stringify({ ...msg([s(`s${n}`, `zoekterm ${n}`), r(`s${n}`, [`https://bron-${n}.nl/`])], { input_tokens: 250_000, output_tokens: 4000, server_tool_use: { web_search_requests: 1 } }), model }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    // Wat startResearchRun doet: beslissende vraag bepalen en de stappen in onderzoeksvolgorde plannen.
    const { ensureDecisiveQuestion, loadRunQuestions } = await import("@/lib/research-questions-data");
    const decisiveId = await ensureDecisiveQuestion(IDEA.id, IDEA);
    const decisive = db.research_questions.find((q) => q.id === decisiveId)!;
    expect(decisive.is_decisive).toBe(true);
    expect(decisive.question).toBe("Willen zelfstandige NVM-kantoren met 2–15 medewerkers in Nederland € 249 per maand betalen voor Makelaarsassistent?");
    // De sjabloonvragen noemen nu de specifieke doelgroep; dezelfde rijen (ids) blijven.
    expect(db.research_questions.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4", "q5"]);
    expect(db.research_questions.every((q) => !String(q.question).includes("Zakelijke klanten (B2B)"))).toBe(true);

    const budget = runBudgetUsd("quick", 3);
    db.research_runs.push({ id: "run-1", idea_id: IDEA.id, mode: "quick", status: "queued", budget_usd: budget, cost_usd: 0, error: null, created_at: new Date().toISOString() });
    const qs = decisiveFirst((await loadRunQuestions(state.client as never, IDEA.id)).map((q) => ({ ...q, is_decisive: q.id === decisiveId })));
    planSteps(qs, "quick").forEach((t, i) =>
      db.research_tasks.push({ id: `t${i + 1}`, run_id: "run-1", idea_id: IDEA.id, position: i + 1, kind: t.kind, question_id: t.questionId, label: t.label, status: "pending", attempts: 0, cost_usd: 0, started_at: null, output: null }),
    );

    const { advanceRun } = await import("@/lib/research-runner");
    let st = await advanceRun("run-1");
    for (let i = 0; i < 40 && st.status !== "done"; i++) st = await advanceRun("run-1");
    expect(st.status).toBe("done");

    // De eerste zoekopdracht ging over de prijsvraag, met de specifieke doelgroep en de prijs.
    expect(state.bodies[0]).toContain("€ 249 per maand");
    expect(state.bodies[0]).toContain("NVM-kantoren");
    const [first, , counter] = db.research_tasks;
    expect(first).toMatchObject({ kind: "search", question_id: decisiveId, status: "done" });
    expect(counter).toMatchObject({ kind: "counter", question_id: decisiveId, status: "done" });

    // Het plafond is hard: nooit boven $1,50, en wat niet paste, staat er met de reden bij.
    const run = db.research_runs[0];
    expect(Number(run.cost_usd)).toBeGreaterThan(0);
    expect(Number(run.cost_usd)).toBeLessThanOrEqual(budget);
    const skipped = db.research_tasks.filter((t) => t.status === "skipped");
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped.every((t) => /Budget van deze run reikt niet|zoekstap van deze vraag is niet uitgevoerd|niets om uit te lezen/.test(String(t.detail)))).toBe(true);
    // Melding in de app.
    expect(db.coach_notes.some((n) => String(n.code).startsWith("research_run_done:"))).toBe(true);
  });

  it("zonder de B2-migratie (geen kolom is_decisive) gaat de prijsvraag toch eerst", async () => {
    const db = testDossier();
    for (const q of db.research_questions) delete q.is_decisive;
    const fake = fakeSupabase(db, runnerRpcs);
    // Zoals Postgres: een select of update met de onbekende kolom geeft een fout.
    const failing = () => {
      const p: Record<string, unknown> = {};
      const self = new Proxy(p, { get: (_t, k) => (k === "then" ? (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: "42703", message: "column is_decisive does not exist" } }).then(ok) : () => self) });
      return self;
    };
    state.client = {
      ...fake,
      from: (t: string) => {
        const q = fake.from(t);
        const select = q.select.bind(q);
        const update = q.update.bind(q);
        return Object.assign(q, {
          select: (cols?: string, o?: { count?: string; head?: boolean }) => (cols?.includes("is_decisive") ? failing() : select(cols, o)),
          update: (row: Record<string, unknown>) => ("is_decisive" in row ? failing() : update(row)),
        });
      },
    };
    const { ensureDecisiveQuestion, loadRunQuestions } = await import("@/lib/research-questions-data");
    const decisiveId = await ensureDecisiveQuestion(IDEA.id, IDEA);
    const decisive = db.research_questions.find((q) => q.id === decisiveId)!;
    expect(decisive.question).toMatch(/€ 249 per maand betalen/);
    expect(db.research_questions.some((q) => "is_decisive" in q)).toBe(false);
    const qs = decisiveFirst((await loadRunQuestions(state.client as never, IDEA.id)).map((q) => ({ ...q, is_decisive: q.id === decisiveId })));
    expect(planSteps(qs, "quick")[0]).toMatchObject({ kind: "search", questionId: decisiveId });
  });
});
