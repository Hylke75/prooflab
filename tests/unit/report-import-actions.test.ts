import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeDb } from "./helpers/fake-supabase";
import { makePdf } from "./helpers/pdf";
import { EXTRACT_ERRORS, isImportedReport } from "@/lib/domain/report-import";

// De server actions van "Bestaand onderzoek importeren" met een nagebootste database en opslag: importeren, AI-voorstellen
// filteren en een bevinding vastleggen. RLS zelf testen de DB-tests; hier gaat het om de regels van de app.

const IDEA = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";
const PATH = `${IDEA}/market/33333333-3333-4333-8333-333333333333-rapport.txt`;

const state: { client: ReturnType<typeof fakeSupabase> & { storage: unknown }; canWrite: boolean; files: Record<string, Uint8Array>; findings: unknown[] } = {
  client: null as never,
  canWrite: true,
  files: {},
  findings: [],
};

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => state.client }));
vi.mock("@/lib/data", () => ({
  getIdea: async () => ({
    canWrite: state.canWrite,
    idea: { id: IDEA, title: "Boekingsplatform", decision_question: "Bouwen?", description: "", target_audience: "Bureaus", region: "Nederland", project_type: "b2b", sector: "events", key_uncertainty: null },
  }),
}));
vi.mock("@/lib/claims", async (orig) => ({ ...(await orig<typeof import("@/lib/claims")>()), recomputeClaim: async () => ({ status: "estimate", reason: "Eén secundaire bron." }) }));
vi.mock("@/lib/env", async (orig) => ({ ...(await orig<typeof import("@/lib/env")>()), aiConfigured: () => true }));
vi.mock("@/lib/log", () => ({ log: { warn: async () => undefined, error: async () => undefined, info: async () => undefined } }));
vi.mock("@/lib/ai/guard", () => ({
  runAi: async (_idea: string, _purpose: string, call: (p: string) => Promise<unknown>) => call("anthropic"),
  aiErrorMessage: (_e: unknown, fallback: string) => fallback,
}));
vi.mock("@/lib/ai/report-findings", () => ({
  proposeReportFindings: async () => ({ data: { findings: state.findings }, usage: { cost: 0 } }),
}));

const { importReport, proposeFindingsFromReport, saveReportFinding } = await import("@/app/app/ideas/[id]/research/import-actions");

const REPORT = [
  "Marktmonitor evenementenbureaus 2025.",
  "In 2025 waren in Nederland 4.100 evenementenbureaus actief, een stijging van 3% ten opzichte van 2024.",
  "Bureaus noemen de prijs van locaties het grootste bezwaar bij het organiseren van zakelijke evenementen.",
].join("\n\n");

function setup(files: Record<string, Uint8Array> = { [PATH]: new Uint8Array(Buffer.from(REPORT)) }, fileName = "rapport.txt") {
  const db: FakeDb = {
    step_documents: [{ id: DOC, idea_id: IDEA, step: "market", file_name: fileName, size_bytes: 2000, storage_path: PATH }],
    sources: [],
    source_excerpts: [],
    claims: [],
    claim_sources: [],
    research_questions: [{ id: "44444444-4444-4444-8444-444444444444", idea_id: IDEA, position: 1, question: "Hoeveel evenementenbureaus zijn er in Nederland?" }],
  };
  state.files = files;
  state.client = Object.assign(fakeSupabase(db), {
    storage: {
      from: () => ({
        download: async (path: string) => (state.files[path] ? { data: new Blob([Buffer.from(state.files[path])]), error: null } : { data: null, error: { message: "not found" } }),
      }),
    },
  });
  return db;
}

const meta = { documentId: DOC, title: "Marktmonitor 2025", publisher: "Branchevereniging", published: "2025", sourceType: "research_report" as const };

beforeEach(() => {
  state.canWrite = true;
  state.findings = [];
});

describe("importReport", () => {
  it("bewaart het rapport als bron met letterlijke blokken en weigert een tweede import", async () => {
    const db = setup();
    const res = await importReport(IDEA, meta);
    expect(res.error).toBeNull();
    expect(db.sources).toHaveLength(1);
    const src = db.sources[0];
    expect(src).toMatchObject({ title: "Marktmonitor 2025", publisher: "Branchevereniging", published_on: "2025-01-01", source_type: "research_report", origin: "manual" });
    expect(isImportedReport(src.access_note as string)).toBe(true);
    expect(db.source_excerpts).toHaveLength(1);
    expect(db.source_excerpts[0]).toMatchObject({ source_id: src.id, idea_id: IDEA, text: REPORT, location: "Rapport, blok 1 van 1" });

    const again = await importReport(IDEA, { ...meta, title: "Nog eens" });
    expect(again.error).toContain("staat al bij de bronnen");
    expect(db.sources).toHaveLength(1);
  });

  it("alleen voor wie het idee mag bewerken", async () => {
    const db = setup();
    state.canWrite = false;
    const res = await importReport(IDEA, meta);
    expect(res.error).toContain("opdrachtgever");
    expect(db.sources).toHaveLength(0);
  });

  it("meldt een gescande PDF zonder tekst en slaat niets op", async () => {
    const pdfPath = PATH.replace("rapport.txt", "scan.pdf");
    const db = setup({ [pdfPath]: new Uint8Array(makePdf([])) }, "scan.pdf");
    db.step_documents[0].storage_path = pdfPath;
    const res = await importReport(IDEA, meta);
    expect(res.error).toBe(EXTRACT_ERRORS.no_text);
    expect(db.sources).toHaveLength(0);
  });

  it("controleert datum en webadres", async () => {
    setup();
    const res = await importReport(IDEA, { ...meta, published: "ooit", url: "javascript:alert(1)" });
    expect(res.error).not.toBeNull();
    expect(res.error !== null && "fieldErrors" in res ? Object.keys(res.fieldErrors ?? {}) : []).toEqual(["published", "url"]);
  });
});

describe("AI-voorstellen en bevindingen", () => {
  async function imported() {
    const db = setup();
    const res = await importReport(IDEA, meta);
    if (res.error !== null) throw new Error(res.error);
    return { db, sourceId: res.sourceId };
  }

  const finding = (x: Record<string, unknown>) => ({
    block_ref: "B1",
    stance: "supports",
    question_ref: "V1",
    section: "market",
    evidence_type: "third_party_estimate",
    population: "evenementenbureaus",
    region: "Nederland",
    reference_date: "2025",
    numeric_value: null,
    unit: null,
    does_not_prove: "Dat bureaus willen betalen.",
    freshness_kind: "statistic",
    ...x,
  });

  it("toont alleen voorstellen met een letterlijk citaat", async () => {
    const { sourceId } = await imported();
    state.findings = [
      finding({ quote: "waren in Nederland 4.100 evenementenbureaus actief", statement: "In 2025 waren er 4.100 evenementenbureaus actief." }),
      finding({ quote: "er zijn ruim vierduizend bureaus", statement: "Ruim vierduizend bureaus." }),
      finding({ quote: "waren in Nederland 4.100 evenementenbureaus actief", statement: "Er zijn 5.000 bureaus." }),
      finding({ block_ref: "B9", stance: "contradicts", quote: "noemen de prijs van locaties het grootste bezwaar", statement: "Prijs is een bezwaar.", question_ref: null }),
    ];
    const res = await proposeFindingsFromReport(IDEA, sourceId, 0);
    if (res.error !== null) throw new Error(res.error);
    expect(res.proposals.map((p) => p.statement)).toEqual(["In 2025 waren er 4.100 evenementenbureaus actief.", "Prijs is een bezwaar."]);
    expect(res.proposals[0].questionId).toBe("44444444-4444-4444-8444-444444444444");
    expect(res.proposals[1].questionId).toBeNull();
    expect(res.dropped).toEqual({ notFound: 1, numbersMismatch: 1 });
    expect(res.read).toEqual({ from: 0, to: 1, total: 1 });
  });

  const form = (x: Record<string, string>) => {
    const f = new FormData();
    const base: Record<string, string> = {
      statement: "In 2025 waren er 4.100 evenementenbureaus actief.",
      quote: "waren in Nederland 4.100 evenementenbureaus actief",
      stance: "supports",
      evidence_type: "third_party_estimate",
      section: "market",
      freshness_kind: "statistic",
      question_id: "44444444-4444-4444-8444-444444444444",
      population: "evenementenbureaus",
      region: "Nederland",
      reference_date: "2025",
      does_not_prove: "Dat bureaus willen betalen.",
      ...x,
    };
    for (const [k, v] of Object.entries(base)) f.set(k, v);
    return f;
  };

  it("legt een geaccepteerd voorstel vast als bevinding met citaat uit het juiste blok", async () => {
    const { db, sourceId } = await imported();
    const res = await saveReportFinding(IDEA, sourceId, { error: null }, form({ from_ai: "1", numeric_value: "4.100", unit: "bureaus" }));
    expect(res.error).toBeNull();
    expect(db.claims).toHaveLength(1);
    expect(db.claims[0]).toMatchObject({ origin: "ai", numeric_value: 4100, question_id: "44444444-4444-4444-8444-444444444444" });
    expect(db.claim_sources[0]).toMatchObject({ source_id: sourceId, excerpt_id: db.source_excerpts[0].id, quote_check: "exact" });
  });

  it("weigert een citaat dat niet letterlijk in het rapport staat, of getallen die er niet in staan", async () => {
    const { db, sourceId } = await imported();
    const notFound = await saveReportFinding(IDEA, sourceId, { error: null }, form({ quote: "ongeveer vierduizend bureaus waren actief" }));
    expect(notFound.error).toContain("niet letterlijk");
    const numbers = await saveReportFinding(IDEA, sourceId, { error: null }, form({ statement: "Er waren 5.000 bureaus actief." }));
    expect(numbers.error).toContain("getallen");
    expect(db.claims).toHaveLength(0);
  });

  it("werkt alleen voor geïmporteerde rapporten van dit idee", async () => {
    const { db } = await imported();
    db.sources.push({ id: "55555555-5555-4555-8555-555555555555", idea_id: IDEA, title: "Gewone bron", access_note: "Fragment handmatig ingevoerd." });
    const res = await saveReportFinding(IDEA, "55555555-5555-4555-8555-555555555555", { error: null }, form({}));
    expect(res.error).toContain("staat niet");
    const ai = await proposeFindingsFromReport(IDEA, "55555555-5555-4555-8555-555555555555", 0);
    expect(ai.error).toContain("geen geïmporteerd rapport");
  });
});
