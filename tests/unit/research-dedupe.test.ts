import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideMerge, knownSupportVerdict, statementKey, type KnownFinding } from "@/lib/research-dedupe";
import { fakeSupabase, runnerRpcs } from "./helpers/fake-supabase";
import { seedRun } from "./helpers/research-fixtures";

// Fase B2, punt 7: dezelfde bewering of hetzelfde cijfer uit dezelfde bron wordt één bevinding met meerdere
// vindplaatsen.

const KOLIBRI: KnownFinding = {
  id: "c1",
  statement: "Kolibri biedt makelaars een gratis ChatGPT-app aan.",
  numericValue: null,
  unit: null,
  links: [{ sourceId: "s1", excerptId: "e1", quote: "gratis ChatGPT-app voor makelaars", supportCheck: "supports" }],
};
const AANTAL: KnownFinding = {
  id: "c2",
  statement: "Er zijn 4.100 NVM-kantoren.",
  numericValue: 4100,
  unit: "kantoren",
  links: [{ sourceId: "s2", excerptId: "e2", quote: "telde 4.100 kantoren", supportCheck: "supports" }],
};

describe("dubbele bevindingen samenvoegen", () => {
  it("normaliseert de bewering (hoofdletters, aanhalingstekens, slotleesteken, spaties)", () => {
    expect(statementKey("  Kolibri biedt makelaars een “gratis” ChatGPT-app aan. ")).toBe(statementKey("kolibri biedt makelaars een gratis ChatGPT-app aan"));
  });

  it("dezelfde bewering uit een andere bron wordt een extra vindplaats", () => {
    const d = decideMerge({ statement: "kolibri biedt makelaars een gratis ChatGPT-app aan", numericValue: null, unit: null, sourceId: "s9", excerptId: "e9", quote: "Kolibri lanceert gratis app" }, [KOLIBRI, AANTAL]);
    expect(d).toMatchObject({ action: "merge", into: { id: "c1" } });
  });

  it("hetzelfde cijfer met dezelfde eenheid uit dezelfde bron wordt samengevoegd, ook anders verwoord", () => {
    const d = decideMerge({ statement: "Nederland telt 4100 makelaarskantoren met NVM-lidmaatschap.", numericValue: 4100, unit: "Kantoren", sourceId: "s2", excerptId: "e7", quote: "in totaal 4.100 kantoren" }, [KOLIBRI, AANTAL]);
    expect(d).toMatchObject({ action: "merge", into: { id: "c2" } });
  });

  it("hetzelfde cijfer uit een andere bron is een eigen bevinding (onafhankelijk bewijs)", () => {
    expect(decideMerge({ statement: "Er zijn ruim 4100 kantoren.", numericValue: 4100, unit: "kantoren", sourceId: "s3", excerptId: "e3", quote: "4100 kantoren" }, [AANTAL]).action).toBe("new");
    expect(decideMerge({ statement: "Er zijn 3.900 kantoren.", numericValue: 3900, unit: "kantoren", sourceId: "s2", excerptId: "e2", quote: "3.900" }, [AANTAL]).action).toBe("new");
  });

  it("dezelfde vindplaats voegt niets toe", () => {
    expect(decideMerge({ statement: KOLIBRI.statement, numericValue: null, unit: null, sourceId: "s1", excerptId: "e1", quote: "iets anders" }, [KOLIBRI]).action).toBe("same_location");
    expect(decideMerge({ statement: KOLIBRI.statement, numericValue: null, unit: null, sourceId: "s1", excerptId: "e5", quote: "Gratis ChatGPT-app voor makelaars." }, [KOLIBRI]).action).toBe("same_location");
  });

  it("hergebruikt het oordeel van de steuncontrole voor precies hetzelfde citaat", () => {
    expect(knownSupportVerdict(KOLIBRI, "gratis ChatGPT-app voor makelaars")).toBe("supports");
    expect(knownSupportVerdict(KOLIBRI, "ander citaat")).toBeNull();
  });
});

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => state.client, supabaseAnon: () => state.client }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const extracted = (over: Record<string, unknown>) => ({
  statement: "Kolibri biedt makelaars een gratis ChatGPT-app aan.",
  section: "competition",
  evidence_type: "primary_document",
  excerpt_ref: "F1",
  quote: "Kolibri biedt makelaars een gratis ChatGPT-app aan",
  stance: "contradicts",
  population: "onbekend",
  region: "onbekend",
  reference_date: "onbekend",
  period: null,
  numeric_value: null,
  unit: null,
  definition: null,
  supports: "Er is een gratis alternatief.",
  does_not_prove: "Dat makelaars het gebruiken.",
  limitations: null,
  freshness_kind: "product",
  ...over,
});

describe("bij het importeren (in-memory database)", () => {
  it("maakt van twee vondsten van dezelfde bewering één bevinding met twee vindplaatsen", async () => {
    const db = seedRun(["Willen kantoren € 249 per maand betalen?"]);
    db.claims = [];
    db.claim_sources = [];
    state.client = fakeSupabase(db, runnerRpcs);
    // Eén steuncontrole (de tweede vindplaats heeft een ander citaat: ook gecontroleerd).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "m", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ verdict: "supports", reason: "ok" }) }], usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200, headers: { "content-type": "application/json" } })),
    );
    const { storeExtractedClaims } = await import("@/lib/research-runner");
    const byRef = new Map([
      ["F1", { id: "e1", text: "Nieuws: Kolibri biedt makelaars een gratis ChatGPT-app aan, meldt de site.", source_id: "s1" }],
      ["F2", { id: "e2", text: "Ook Vakblad meldt: Kolibri biedt makelaars een gratis ChatGPT-app aan vanaf maart.", source_id: "s2" }],
    ]);
    const first = await storeExtractedClaims("idea-1", "q1", byRef, [extracted({})] as never, {});
    expect(first.claimIds).toHaveLength(1);
    const second = await storeExtractedClaims(
      "idea-1",
      "q1",
      byRef,
      [extracted({ excerpt_ref: "F2", statement: "kolibri biedt makelaars een gratis ChatGPT-app aan" }), extracted({})] as never,
      {},
    );
    expect(second.claimIds).toHaveLength(0);
    expect(second.merged).toBe(1);
    expect(second.duplicates).toBe(2);
    expect(second.mergedIds).toEqual(first.claimIds);
    expect(db.claims).toHaveLength(1);
    expect(db.claim_sources.map((l) => l.source_id).sort()).toEqual(["s1", "s2"]);
    expect(db.claim_sources.every((l) => l.claim_id === first.claimIds[0])).toBe(true);
  });
});
