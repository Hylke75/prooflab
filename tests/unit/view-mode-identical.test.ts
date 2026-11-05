import { describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeDb } from "./helpers/fake-supabase";

// Fase 1 · punt 1: de stand (Snel of Grondig) is alleen weergave. Dezelfde dossierdata met alleen een andere
// detail_level moet bit voor bit dezelfde uitkomsten geven: het dossier (rapport en Reality Check), de kansen en het
// bewijsregister per aanname, de dossierstand (coach, statussen) en de Stand van het bewijs.
// Zie ook tests/unit/view-mode-isolation.test.ts: de rekenmodules lezen de stand niet eens.

const IDEA = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const A1 = "a1111111-1111-4111-8111-111111111111";
const A2 = "a2222222-2222-4222-8222-222222222222";
const A3 = "a3333333-3333-4333-8333-333333333333";
const C1 = "c1111111-1111-4111-8111-111111111111";
const C2 = "c2222222-2222-4222-8222-222222222222";
const T0 = "2026-11-01T10:00:00.000Z";

function seed(level: "quick" | "thorough"): FakeDb {
  return {
    ideas: [
      {
        id: IDEA,
        org_id: ORG,
        title: "AI-communicatie voor sportclubs",
        decision_question: "Investeren we € 25.000 in een AI-communicatieassistent voor amateursportclubs?",
        description: "Een assistent die nieuwsbrieven en berichten voor sportclubs schrijft. € 79 per maand.",
        target_audience: "Amateursportclubs",
        audience_detail: "Besturen van amateursportclubs met 200-1000 leden",
        audience_short: "amateursportclubs",
        region: "Nederland",
        project_type: "new_product",
        sector_template: "associations",
        method_version: "2026-11-e",
        status: "active",
        is_demo: false,
        client_id: null,
        sprint_start: "2026-10-20",
        sprint_weeks: 6,
        decision_deadline: "2026-12-15",
        key_uncertainty: "Betalen clubs € 79 per maand?",
        outcome_question: "success",
        created_at: T0,
        updated_at: T0,
        detail_level: level,
      },
    ],
    assumptions: [
      { id: A1, idea_id: IDEA, statement: "Clubbesturen besteden te veel tijd aan communicatie", category: "desirability", importance: 5, status: "testing", origin: "manual", prior: null, selected_for_test: true, kind: "behaviour", primary_experiment_id: null, created_at: T0, defaulted_fields: ["prior"] },
      { id: A2, idea_id: IDEA, statement: "Clubs betalen € 79 per maand voor een AI-assistent", category: "viability", importance: 5, status: "untested", origin: "manual", prior: 0.35, prior_rationale: "Basispercentage vergelijkbare tools", selected_for_test: true, kind: "price", primary_experiment_id: null, created_at: "2026-11-01T10:01:00.000Z", defaulted_fields: [] },
      { id: A3, idea_id: IDEA, statement: "Bonden willen de assistent aanbevelen", category: "context", importance: 3, status: "untested", origin: "template", prior: null, selected_for_test: false, kind: null, primary_experiment_id: null, created_at: "2026-11-01T10:02:00.000Z", defaulted_fields: ["prior"] },
    ],
    claims: [
      { id: C1, idea_id: IDEA, statement: "Er zijn ruim 24.000 sportverenigingen in Nederland", status: "verified", relevance: "direct", question_id: null, origin: "manual", created_at: T0, updated_at: T0 },
      { id: C2, idea_id: IDEA, statement: "Vrijwilligers besteden gemiddeld 3 uur per week aan communicatie", status: "estimate", relevance: "indirect", question_id: null, origin: "ai", created_at: T0, updated_at: T0 },
    ],
    assumption_claims: [
      { assumption_id: A1, claim_id: C2, idea_id: IDEA, relation: "supports", claims: { status: "estimate", relevance: "indirect" } },
      { assumption_id: A3, claim_id: C1, idea_id: IDEA, relation: "supports", claims: { status: "verified", relevance: "direct" } },
    ],
    research_questions: [
      { id: "q1111111-1111-4111-8111-111111111111", idea_id: IDEA, position: 1, question: "Hoeveel tijd besteden clubbesturen aan communicatie?", status: "open", method: "both", done_criterion: "Twee bronnen", origin: "template", is_decisive: true },
    ],
    competitors: [{ id: "k1", idea_id: IDEA, name: "Niets doen", kind: "status_quo", origin: "manual" }],
    observations: [],
    experiments: [],
    learning_cards: [],
    reality_checks: [],
    decisions: [],
    interviews: [],
  };
}

const state: { db: FakeDb } = { db: seed("quick") };
const client = () =>
  fakeSupabase(state.db, {
    observations_for_idea: () => [],
    real_interview_ids: () => [],
  });

vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => client() }));
vi.mock("@/lib/data", () => ({
  getUser: async () => ({ id: "u1", email: "consultant@example.com" }),
  requireUser: async () => ({ id: "u1", email: "consultant@example.com" }),
  getIdea: async () => ({ idea: state.db.ideas[0], canWrite: true, clientName: null, isClientDecider: false }),
  getWorkspace: async () => ({ user: { id: "u1", email: "consultant@example.com" }, org: { id: ORG, name: "Bureau", role: "owner" }, clientIdeaIds: [] }),
}));
vi.mock("@/lib/log", () => ({ log: { warn: async () => undefined, error: async () => undefined, info: async () => undefined } }));

const { loadDossier } = await import("@/lib/dossier");
const { loadInformationValue, loadProgress, loadAssumptions } = await import("@/lib/progress");
const { loadEvidenceStanding } = await import("@/lib/standing-data");

async function everything(level: "quick" | "thorough") {
  state.db = seed(level);
  const idea = state.db.ideas[0] as unknown as Parameters<typeof loadDossier>[0];
  const dossier = await loadDossier(idea);
  const assumptions = await loadAssumptions(IDEA);
  const ranked = await loadInformationValue(IDEA);
  const progress = await loadProgress(IDEA);
  const standing = await loadEvidenceStanding(IDEA, "evidence");
  // Het idee zelf zit in het dossier; alleen de weergavekolom mag verschillen.
  const strip = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === "detail_level" ? undefined : v)));
  return strip({ dossier, assumptions, ranked, progress, standing });
}

describe("Snel en Grondig rekenen hetzelfde", () => {
  it("dossier, kansen, bewijsregister, statussen en Stand van het bewijs zijn identiek", async () => {
    const quick = await everything("quick");
    const thorough = await everything("thorough");
    expect(quick.assumptions).toHaveLength(3);
    // Geen lege vergelijking: er telt echt bewijs mee en de startkans van A2 (35%) is gebruikt.
    const byId = Object.fromEntries((quick.assumptions as { id: string; probability: { probability: number; prior: number }; register: unknown[] }[]).map((a) => [a.id, a]));
    expect(byId[A3].register.length).toBeGreaterThan(0);
    expect(byId[A3].probability.probability).not.toBe(0.5);
    expect(byId[A2].probability.prior).toBe(0.35);
    expect(quick.standing.assumptions.length).toBeGreaterThan(0);
    expect(quick).toEqual(thorough);
  });
});
