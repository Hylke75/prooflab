import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeDb } from "./helpers/fake-supabase";
import { fixtureFetcher } from "./helpers/cbs-fixtures";
import { checkQuote, computeClaimStatus, type EvidenceForStatus } from "@/lib/domain/verify";
import { dossierLabel } from "@/lib/domain/dossier-label";
import type { EvidenceType, SourceType } from "@/lib/domain/labels";

// Fase 2, punt 6: opslaan van een CBS-waarde bij een factor en het koppelen van een sectorregister, op een nagebootste
// database. recomputeClaim wordt nagebootst met dezelfde regels (checkQuote en computeClaimStatus): de nagebootste
// client kent geen joins. Daarna: telt de bevinding mee voor "een officiële statistiek of primaire bron" in het
// dossierlabel?

const state = vi.hoisted(() => ({ db: null as unknown as Record<string, Record<string, unknown>[]> }));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => fakeSupabase(state.db), supabaseAnon: () => fakeSupabase(state.db) }));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn(async () => {}), error: vi.fn(async () => {}), info: vi.fn(async () => {}) } }));
vi.mock("@/lib/claims", async (orig) => {
  const real = await orig<typeof import("@/lib/claims")>();
  return {
    ...real,
    recomputeClaim: vi.fn(async (claimId: string) => {
      const db = state.db;
      const claim = db.claims.find((c) => c.id === claimId)!;
      const evidence: EvidenceForStatus[] = db.claim_sources
        .filter((l) => l.claim_id === claimId)
        .map((l) => {
          const ex = db.source_excerpts.find((e) => e.id === l.excerpt_id);
          const src = db.sources.find((s) => s.id === l.source_id)!;
          const check = ex ? checkQuote(String(l.quote), String(ex.text), l.stance === "supports" ? String(claim.statement) : undefined) : "not_found";
          l.quote_check = check;
          return {
            sourceType: src.source_type as SourceType,
            isPrimary: src.is_primary === true,
            domain: (src.domain as string) ?? null,
            publisher: (src.publisher as string) ?? null,
            publishedOn: (src.published_on as string) ?? null,
            contentHash: (src.content_hash as string) ?? null,
            quoteCheck: check,
            stance: l.stance as "supports" | "contradicts",
          };
        });
      const res = computeClaimStatus({ evidenceType: claim.evidence_type as EvidenceType, freshness: "statistic" }, evidence);
      claim.status = res.status;
      claim.status_reason = res.reason;
      return res;
    }),
  };
});

const IDEA = "11111111-1111-4111-8111-111111111111";
const SCEN = "22222222-2222-4222-8222-222222222222";

function seed(): FakeDb {
  return {
    ideas: [{ id: IDEA, target_audience: "sportclubs", audience_detail: null, region: "Nederland", region_detail: null, decision_deadline: null }],
    sizing_scenarios: [{ id: SCEN, idea_id: IDEA, kind: "realistic", model: "b2b_accounts" }],
    sizing_factors: [
      { id: "f-base", scenario_id: SCEN, idea_id: IDEA, key: "base_count", label: "Relevante organisaties in het gebied", unit: "count", value: 0, claim_id: null },
      { id: "f-fit", scenario_id: SCEN, idea_id: IDEA, key: "fit_pct", label: "Deel met het probleem en budget", unit: "percent", value: 0, claim_id: null },
    ],
    sources: [],
    source_excerpts: [],
    claims: [],
    claim_sources: [],
  };
}

// Het dossierlabel met alleen deze bevindingen; de rest van de marktvoorwaarden is vervuld.
function strongMissing(db: FakeDb): boolean {
  const claims = db.claims.map((c) => {
    const link = db.claim_sources.find((l) => l.claim_id === c.id)!;
    const src = db.sources.find((s) => s.id === link.source_id)!;
    return { status: String(c.status), domain: (src.domain as string) ?? null, sourceType: String(src.source_type) };
  });
  const filler = [
    { status: "verified", domain: "a.nl", sourceType: "research_report" },
    { status: "verified", domain: "b.nl", sourceType: "news" },
    { status: "estimate", domain: "c.nl", sourceType: "blog" },
  ];
  const { missing } = dossierLabel({ claims: [...filler, ...claims], competitorKinds: ["direct", "indirect", "status_quo"], sizingComputed: true, behaviourCards: [] });
  return missing.includes("een officiële statistiek of primaire bron");
}

beforeEach(() => {
  vi.resetModules();
  state.db = seed();
});

describe("Haal uit CBS: waarde aan een factor koppelen", () => {
  it("maakt bron, fragment en gecontroleerde bevinding, zet de factor, en telt als officiële statistiek", async () => {
    const { saveCbsToFactor } = await import("@/lib/cbs-factor");
    const sel = { measure: "WP19079", period: "2026JJ00", filters: { RegioS: "PV26", BedrijfstakkenBranchesSBI2008: "T001081" } };
    const res = await saveCbsToFactor(IDEA, { scenarioId: SCEN, factorKey: "base_count" }, "81644NED", sel, { fetchJson: fixtureFetcher() });
    expect(res.error).toBeNull();
    const db = state.db;
    expect(db.sources).toHaveLength(1);
    expect(db.sources[0]).toMatchObject({ source_type: "official_statistic", publisher: "CBS", is_primary: true, domain: "cbs.nl", url: "https://opendata.cbs.nl/statline/#/CBS/nl/dataset/81644NED/table" });
    expect(db.source_excerpts).toHaveLength(1);
    expect(String(db.source_excerpts[0].text)).toContain("Regio: Utrecht (PV); Periode: 2026 (voorlopig); Onderwerp: 1 werkzame persoon; Waarde: 177440 aantal");
    expect(db.claims[0]).toMatchObject({ status: "verified", evidence_type: "official_statistic", numeric_value: 177440, region: "Utrecht", reference_date: "2026", period: "2026", section: "sizing" });
    expect(db.claim_sources[0]).toMatchObject({ quote_check: "exact", excerpt_id: db.source_excerpts[0].id });
    expect(db.sizing_factors[0]).toMatchObject({ value: 177440, claim_id: db.claims[0].id, year: 2026, region: "Utrecht" });
    expect(strongMissing(db)).toBe(false);

    // Dezelfde regel opnieuw: dezelfde bron, hetzelfde fragment en dezelfde bevinding.
    const again = await saveCbsToFactor(IDEA, { scenarioId: SCEN, factorKey: "base_count" }, "81644NED", sel, { fetchJson: fixtureFetcher() });
    expect(again).toMatchObject({ error: null, reused: true });
    expect([db.sources.length, db.source_excerpts.length, db.claims.length, db.claim_sources.length]).toEqual([1, 1, 1, 1]);
  });

  it("zonder waarde, met een andere eenheid of zonder CBS: niets opslaan en een eerlijke melding", async () => {
    const { saveCbsToFactor } = await import("@/lib/cbs-factor");
    const missing = await saveCbsToFactor(IDEA, { scenarioId: SCEN, factorKey: "base_count" }, "81644NED", { measure: "M000200", period: "2025JJ00", filters: { RegioS: "CR17" } }, { fetchJson: fixtureFetcher() });
    expect(missing.error).toContain("onbekend");
    const unit = await saveCbsToFactor(IDEA, { scenarioId: SCEN, factorKey: "fit_pct" }, "03759ned", { measure: "M000352", period: "2026JJ00", filters: { RegioS: "GM0363" } }, { fetchJson: fixtureFetcher() });
    expect(unit.error).toContain("percentage");
    const down = await saveCbsToFactor(IDEA, { scenarioId: SCEN, factorKey: "base_count" }, "03759ned", { measure: "M000352", period: "2026JJ00", filters: {} }, {
      fetchJson: async () => {
        const { CbsError } = await import("@/lib/integrations/cbs");
        throw new CbsError("onbereikbaar", "time-out");
      },
    });
    expect(down.error).toContain("niet bereikbaar");
    expect(down.error).toContain("vul de waarde zelf in");
    expect([state.db.sources.length, state.db.claims.length]).toEqual([0, 0]);
    expect(state.db.sizing_factors[0]).toMatchObject({ value: 0, claim_id: null });
  });
});

const CSV = [
  "uitgever;bron_url;peildatum;categorie;grootteklasse;regio;aantal;opmerking",
  "Sportbond Voorbeeld;https://bond.example.nl/clubs;2025-12-31;Hockeyclubs;totaal;Nederland;318;",
  "Sportbond Voorbeeld;https://bond.example.nl/clubs;2025-12-31;Korfbalclubs;totaal;Nederland;452;",
].join("\n");
const ORIGINAL = "Ledenregister 2025\nHockeyclubs 318 verenigingen\nOverige sporten volgen later.";

describe("Sectorregister koppelen aan een factor", () => {
  it("zonder origineel: schatting, telt niet als officieel of primair", async () => {
    const data = await import("@/lib/sector-register-data");
    const imp = await data.importRegisterCsv(IDEA, CSV, "clubs.csv");
    expect(imp.error).toBeNull();
    const [reg] = await data.loadRegisters(IDEA);
    expect(reg.rows).toHaveLength(2);
    expect(reg.original).toBeNull();
    const hockey = reg.rows.find((r) => r.row.category === "Hockeyclubs")!;
    const res = await data.linkRegisterToFactor(IDEA, reg.sourceId, [hockey.excerptId], { scenarioId: SCEN, factorKey: "base_count" });
    expect(res).toMatchObject({ error: null, kind: "estimate", status: "estimate" });
    expect(state.db.claims[0]).toMatchObject({ evidence_type: "third_party_estimate", numeric_value: 318 });
    expect(state.db.sizing_factors[0]).toMatchObject({ value: 318, year: 2025, region: "Nederland" });
    expect(strongMissing(state.db)).toBe(true);
  });

  it("met origineel waarin categorie en aantal staan: primaire bron, gecontroleerd en telt mee", async () => {
    const data = await import("@/lib/sector-register-data");
    await data.importRegisterCsv(IDEA, CSV, "clubs.csv");
    let [reg] = await data.loadRegisters(IDEA);
    const att = await data.attachRegisterOriginal(IDEA, reg.sourceId, { text: ORIGINAL, label: "register.pdf", kind: "bestand" });
    expect(att).toMatchObject({ error: null, found: 1, total: 2 });
    [reg] = await data.loadRegisters(IDEA);
    expect(reg.original).toMatchObject({ found: 1, total: 2 });
    const hockey = reg.rows.find((r) => r.row.category === "Hockeyclubs")!;
    const korfbal = reg.rows.find((r) => r.row.category === "Korfbalclubs")!;
    expect([hockey.foundInOriginal, korfbal.foundInOriginal]).toEqual([true, false]);
    const res = await data.linkRegisterToFactor(IDEA, reg.sourceId, [hockey.excerptId], { scenarioId: SCEN, factorKey: "base_count" });
    expect(res).toMatchObject({ error: null, kind: "primary", status: "verified" });
    const link = state.db.claim_sources[0];
    const src = state.db.sources.find((s) => s.id === link.source_id)!;
    expect(src).toMatchObject({ source_type: "primary_document", is_primary: true });
    expect(link.quote).toBe("Hockeyclubs 318 verenigingen");
    expect(strongMissing(state.db)).toBe(false);
  });

  it("een aantal dat niet in het origineel staat, en een optelling, blijven een schatting", async () => {
    const data = await import("@/lib/sector-register-data");
    await data.importRegisterCsv(IDEA, CSV, "clubs.csv");
    let [reg] = await data.loadRegisters(IDEA);
    await data.attachRegisterOriginal(IDEA, reg.sourceId, { text: ORIGINAL, label: "register.pdf", kind: "bestand" });
    [reg] = await data.loadRegisters(IDEA);
    const korfbal = reg.rows.find((r) => r.row.category === "Korfbalclubs")!;
    const one = await data.linkRegisterToFactor(IDEA, reg.sourceId, [korfbal.excerptId], { scenarioId: SCEN, factorKey: "base_count" });
    expect(one).toMatchObject({ kind: "estimate", status: "estimate" });
    const sum = await data.linkRegisterToFactor(IDEA, reg.sourceId, reg.rows.map((r) => r.excerptId), { scenarioId: SCEN, factorKey: "base_count" });
    expect(sum).toMatchObject({ kind: "estimate", status: "estimate" });
    expect(state.db.claims.at(-1)).toMatchObject({ evidence_type: "internal_assumption", numeric_value: 770 });
    expect(state.db.sizing_factors[0]).toMatchObject({ value: 770 });
    expect(String(state.db.source_excerpts.find((e) => e.location === "Optelling door ProofLab")?.text)).toContain("Optelling door ProofLab (geen tekst van de uitgever) van 2 regels");
    expect(strongMissing(state.db)).toBe(true);
    // Een register levert geen percentage.
    const pct = await data.linkRegisterToFactor(IDEA, reg.sourceId, [korfbal.excerptId], { scenarioId: SCEN, factorKey: "fit_pct" });
    expect(pct.error).toContain("geen aantal");
  });

  it("hetzelfde register opnieuw importeren hergebruikt de bron; een fout in één regel importeert niets", async () => {
    const data = await import("@/lib/sector-register-data");
    await data.importRegisterCsv(IDEA, CSV, "clubs.csv");
    const again = await data.importRegisterCsv(IDEA, CSV, "clubs-kopie.csv");
    expect(again.error).toBeNull();
    expect(state.db.sources).toHaveLength(1);
    const bad = await data.importRegisterCsv(IDEA, `${CSV}\nSportbond Voorbeeld;https://bond.example.nl/clubs;2025-12-31;Tennisclubs;totaal;Nederland;veel;`, "clubs.csv");
    expect(bad.error).toContain("regel 4");
    expect(state.db.sources).toHaveLength(1);
  });
});
