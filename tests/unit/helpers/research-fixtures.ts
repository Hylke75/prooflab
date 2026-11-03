import type { FakeDb } from "./fake-supabase";

// Bouwstenen voor tests van de onderzoeksrunner: Claude-berichten met zoek- en ophaalblokken en een gevulde
// in-memory database met één run en een zoektaak per vraag.

export const LONG = "Het aantal evenementenbureaus in Nederland steeg in 2025 naar 4.100 bedrijven, blijkt uit de jaarlijkse telling van de branche.";
export const FILLER = "Overige tekst over het weer en het verkeer die niets met de vraag te maken heeft, maar de pagina wel lang genoeg maakt.";
export const PDF_LINE = "Uit de telling blijkt dat in 2025 in Nederland 4100 evenementenbureaus actief waren, vooral kleine bedrijven.";

type Usage = { input_tokens: number; output_tokens: number; server_tool_use?: { web_search_requests: number } };

export const msg = (content: unknown[], usage: Usage = { input_tokens: 2000, output_tokens: 300, server_tool_use: { web_search_requests: 1 } }, stop = "end_turn") => ({
  id: "m",
  type: "message",
  role: "assistant",
  model: "claude-test",
  stop_reason: stop,
  stop_sequence: null,
  content,
  usage,
});
export const s = (id: string, query: string) => ({ type: "server_tool_use", id, name: "web_search", input: { query } });
export const r = (id: string, urls: string[]) => ({
  type: "web_search_tool_result",
  tool_use_id: id,
  content: urls.map((url) => ({ type: "web_search_result", url, title: `T ${url}`, page_age: null, encrypted_content: "x" })),
});
export const f = (id: string, url: string) => ({ type: "server_tool_use", id, name: "web_fetch", input: { url } });
export const doc = (id: string, url: string, source: Record<string, unknown>) => ({
  type: "web_fetch_tool_result",
  tool_use_id: id,
  content: { type: "web_fetch_result", url, retrieved_at: null, content: { type: "document", title: `P ${url}`, citations: null, source } },
});

export function seedRun(questions: string[], budget = 1.5): FakeDb {
  const ideaId = "idea-1";
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
    research_runs: [],
    research_questions: questions.map((q, i) => ({ id: `q${i + 1}`, idea_id: ideaId, position: i + 1, question: q, status: "open" })),
    research_tasks: [],
    sources: [],
    source_excerpts: [],
    ai_runs: [],
    research_search_log: [],
  };
  addRun(db, "run-1", budget);
  return db;
}

// A further run of the same idea with a search task for every question.
export function addRun(db: FakeDb, runId: string, budget = 1.5) {
  db.research_runs.push({ id: runId, idea_id: "idea-1", mode: "quick", status: "queued", budget_usd: budget, cost_usd: 0, error: null, created_at: new Date().toISOString() });
  for (const q of db.research_questions) {
    const i = Number(q.position);
    db.research_tasks.push({
      id: `${runId}-t${i}`,
      run_id: runId,
      idea_id: "idea-1",
      position: i,
      kind: "search",
      question_id: q.id,
      status: "pending",
      attempts: 0,
      label: `Zoeken vraag ${i}`,
      cost_usd: 0,
      started_at: null,
    });
  }
}
