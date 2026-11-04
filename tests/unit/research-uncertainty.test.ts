import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EFFECT_LABEL, rulePicks, uncertaintyCandidates, uncertaintyText, validateAiPicks, type Candidate } from "@/lib/research-uncertainty";
import { fakeSupabase, runnerRpcs } from "./helpers/fake-supabase";
import { msg, seedRun } from "./helpers/research-fixtures";

// Fase B2, punt 6: "Wat dit betekent voor je grootste onzekerheid": hooguit drie bevindingen, een ondermijnende
// bevinding (zoals een gratis alternatief) krijgt het label "Risico". AI stelt voor; de regel is de terugval.

const C = (over: Partial<Candidate> & { id: string }): Candidate => ({
  statement: "Iets over de markt.",
  status: "verified",
  section: "market",
  questionId: null,
  counter: false,
  ...over,
});

const CLAIMS: Candidate[] = [
  C({ id: "kolibri", statement: "Kolibri geeft makelaars een gratis ChatGPT-app.", section: "competition", questionId: "q4" }),
  C({ id: "prijs", statement: "Concurrent X vraagt € 199 per maand per kantoor.", section: "pricing", questionId: "q4" }),
  C({ id: "aantal", statement: "Er zijn 4.100 NVM-kantoren.", section: "sizing", questionId: "q1" }),
  C({ id: "zwak", statement: "Makelaars zouden € 249 betalen.", section: "pricing", status: "insufficient", questionId: "q4" }),
  C({ id: "krimp", statement: "Het aantal transacties daalde in 2025.", section: "market", counter: true, questionId: "q2", status: "estimate" }),
];

describe("selectie bij de grootste onzekerheid", () => {
  it("weegt alleen bevindingen met een gecontroleerd citaat", () => {
    expect(uncertaintyCandidates(CLAIMS).map((c) => c.id)).not.toContain("zwak");
  });

  it("regel: bij een prijsvraag komt een gratis alternatief bovenaan als Risico", () => {
    const picks = rulePicks(CLAIMS, "Willen ze € 249 per maand betalen?", "q4");
    expect(picks.length).toBeLessThanOrEqual(3);
    expect(picks[0]).toMatchObject({ claimId: "kolibri", effect: "undermines", rank: 1 });
    expect(picks[0].reason).toMatch(/gratis alternatief/);
    expect(picks.some((p) => p.claimId === "prijs" && p.effect === "supports")).toBe(true);
    expect(picks.some((p) => p.claimId === "zwak")).toBe(false);
    expect(EFFECT_LABEL.undermines.label).toBe("Risico");
    expect(EFFECT_LABEL.undermines.pill).toBe("coral");
  });

  it("controleert het AI-voorstel: alleen bekende bevindingen, geen dubbele, hooguit drie", () => {
    const refs = new Map([
      ["B1", "kolibri"],
      ["B2", "prijs"],
      ["B3", "aantal"],
      ["B4", "krimp"],
    ]);
    const picks = validateAiPicks(
      [
        { ref: "B1", effect: "undermines", reason: " Gratis   alternatief. " },
        { ref: "B9", effect: "supports", reason: "verzonnen" },
        { ref: "B1", effect: "supports", reason: "dubbel" },
        { ref: "B2", effect: "anders", reason: "fout effect" },
        { ref: "B2", effect: "supports", reason: "Prijsanker." },
        { ref: "B3", effect: "supports", reason: "" },
        { ref: "B4", effect: "undermines", reason: "vierde" },
      ],
      refs,
    );
    expect(picks.map((p) => [p.claimId, p.effect, p.rank])).toEqual([
      ["kolibri", "undermines", 1],
      ["prijs", "supports", 2],
      ["aantal", "supports", 3],
    ]);
    expect(picks[0].reason).toBe("Gratis alternatief.");
    expect(picks[2].reason).toBe("Raakt de grootste onzekerheid.");
  });

  it("neemt de onzekerheid uit de intake, anders de beslissende vraag", () => {
    expect(uncertaintyText(" Willen ze betalen? ", "Vraag")).toBe("Willen ze betalen?");
    expect(uncertaintyText(null, "Hoeveel kantoren zijn er?")).toBe("Hoeveel kantoren zijn er?");
    expect(uncertaintyText("", null)).toBeNull();
  });
});

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => state.client, supabaseAnon: () => state.client }));

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

function dossier() {
  const db = seedRun(["Willen kantoren € 249 per maand betalen?"]);
  db.ideas[0].key_uncertainty = "Willen ze € 249 per maand betalen?";
  db.research_questions[0].is_decisive = true;
  db.research_tasks[0].kind = "uncertainty";
  db.research_tasks[0].question_id = null;
  db.claims = [
    { id: "c1", idea_id: "idea-1", statement: "Kolibri geeft makelaars een gratis ChatGPT-app.", status: "verified", section: "competition", question_id: "q1" },
    { id: "c2", idea_id: "idea-1", statement: "Er zijn 4.100 NVM-kantoren.", status: "verified", section: "sizing", question_id: null },
  ];
  db.claim_sources = [
    { id: "l1", idea_id: "idea-1", claim_id: "c1", stance: "supports" },
    { id: "l2", idea_id: "idea-1", claim_id: "c2", stance: "supports" },
  ];
  db.uncertainty_findings = [];
  return db;
}

describe("de slotstap van een run", () => {
  it("slaat het AI-voorstel op, met het gratis alternatief als risico", async () => {
    const db = dossier();
    state.client = fakeSupabase(db, runnerRpcs);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(msg([{ type: "text", text: JSON.stringify({ picks: [{ ref: "B1", effect: "undermines", reason: "Gratis alternatief." }] }) }], { input_tokens: 500, output_tokens: 50 })), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const { advanceRun } = await import("@/lib/research-runner");
    let st = await advanceRun("run-1");
    if (st.status !== "done") st = await advanceRun("run-1");
    expect(db.research_tasks[0].status).toBe("done");
    expect(db.uncertainty_findings).toHaveLength(1);
    expect(db.uncertainty_findings[0]).toMatchObject({ idea_id: "idea-1", claim_id: "c1", effect: "undermines", origin: "ai", rank: 1 });
    expect(String(db.research_tasks[0].detail)).toMatch(/1 bevinding geselecteerd, waarvan 1 risico \(AI-voorstel\)/);
  });

  it("valt zonder bruikbaar AI-antwoord terug op de regel", async () => {
    const db = dossier();
    state.client = fakeSupabase(db, runnerRpcs);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const { advanceRun } = await import("@/lib/research-runner");
    await advanceRun("run-1");
    expect(db.uncertainty_findings[0]).toMatchObject({ claim_id: "c1", effect: "undermines", origin: "rules" });
  });

  it("laat een selectie van de consultant staan", async () => {
    const db = dossier();
    db.uncertainty_findings = [{ id: "u1", idea_id: "idea-1", claim_id: "c2", effect: "supports", rank: 1, reason: "Eigen keuze.", origin: "consultant" }];
    state.client = fakeSupabase(db, runnerRpcs);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { advanceRun } = await import("@/lib/research-runner");
    await advanceRun("run-1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.uncertainty_findings).toEqual([expect.objectContaining({ claim_id: "c2", origin: "consultant" })]);
  });
});
