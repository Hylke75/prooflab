import { describe, expect, it } from "vitest";
import type { ReportSnapshot } from "@/lib/report";
import { runRealityCheck, noIndependentSourceDetail, type DossierFacts } from "@/lib/domain/reality-check";
import { cleanAiText, sanitizeAiText, sanitizeChallenges } from "@/lib/domain/ai-text";
import { buildReportPdfModel, claimCountsNote, claimStatusText, type Block } from "@/lib/report-pdf-model";
import { strongestEvidence } from "@/lib/report-sheet";
import { audienceExample } from "@/lib/research-questions";

// Gebruikerstest groep D: Realiteitscheck en besluit (D9–D13).

const facts = (over: Partial<DossierFacts> = {}): DossierFacts => ({
  ideaAgeDays: 3,
  ideaRegion: "Nederland",
  clientDeciderInvited: true,
  claims: [],
  competitors: [{ kind: "status_quo" }],
  sizing: null,
  assumptions: [],
  experiments: [],
  interviews: [],
  observations: [],
  learningCards: [],
  decisionsAfterLastLearning: 0,
  isB2B: false,
  ...over,
});

describe("D9: Realiteitscheck noemt de echte brontypes", () => {
  it("noemt de soorten gecontroleerde bronnen die er zijn", () => {
    const r = runRealityCheck(facts({ claims: [{ status: "estimate", section: "market", sourceTypes: ["company_page"] }, { status: "estimate", section: "market", sourceTypes: ["forum", "company_page"] }] }));
    const f = r.findings.find((x) => x.code === "no_independent_source")!;
    expect(f.detail).toContain("bedrijfswebsite en forum / community");
    expect(f.detail).not.toMatch(/nieuws of blogs/);
  });

  it("zonder gecontroleerde bron staat dat er", () => {
    expect(noIndependentSourceDetail([{ sourceTypes: [] }])).toContain("geen gecontroleerde bron");
  });
});

describe("D10: geen interne codes in AI-tekst", () => {
  it("vervangt bekende codes op codeplekken door labels", () => {
    expect(sanitizeAiText("Bevinding [refuted] over het aantal clubs")).toBe("Bevinding (weerlegd) over het aantal clubs");
    expect(sanitizeAiText("Het besluit test_more is te vroeg")).toBe("Het besluit verder testen is te vroeg");
    expect(sanitizeAiText("Experiment met status: live")).toBe("Experiment met status: loopt");
    expect(sanitizeAiText("Gewone tekst zonder codes, live gaan mag.")).toBe("Gewone tekst zonder codes, live gaan mag.");
  });

  it("laat een uitdaging met een resterende code vallen", () => {
    expect(sanitizeAiText("Zie veld outcome_clock_start")).toBeNull();
    const kept = sanitizeChallenges([
      { title: "Geen gedrag", detail: "Alleen meningen (inconclusive).", severity: "warning" },
      { title: "Code", detail: "Het veld primary_experiment_id is leeg.", severity: "info" },
    ]);
    expect(kept).toEqual([{ title: "Geen gedrag", detail: "Alleen meningen (onbeslist).", severity: "warning" }]);
    expect(cleanAiText("Het veld primary_experiment_id is leeg")).toBe("Het veld primary experiment id is leeg");
  });
});

describe("D11: voorbeelden met de eigen doelgroep", () => {
  it("gebruikt de korte doelgroep of niets", () => {
    expect(audienceExample({ audience_short: "amateursportclubs", audience_detail: null })).toBe("Amateursportclubs");
    expect(audienceExample({ audience_detail: "sportclubs met vrijwilligers" })).toBe("Sportclubs");
    expect(audienceExample({ audience_detail: null })).toBeNull();
  });
});

// D12 (stappen vóór het besluit) staat in tests/unit/forecast.test.ts, met de volledige voortgangsfixture.

describe("D13: weerlegde bevindingen in realiteitscheck en rapport", () => {
  it("de realiteitscheck telt weerlegd met het juiste meervoud", () => {
    const one = runRealityCheck(facts({ claims: [{ status: "refuted", section: "market", sourceTypes: ["official_statistic"] }] }));
    expect(one.findings.find((f) => f.code === "refuted_claims")?.title).toBe("1 bevinding weerlegd door gecontroleerde bronnen");
    const two = runRealityCheck(
      facts({ claims: [{ status: "refuted", section: "market", sourceTypes: ["official_statistic"] }, { status: "refuted", section: "market", sourceTypes: [] }, { status: "contested", section: "market", sourceTypes: [] }] }),
    );
    expect(two.findings.find((f) => f.code === "refuted_claims")?.title).toBe("2 bevindingen weerlegd door gecontroleerde bronnen");
    expect(two.findings.find((f) => f.code === "contested_claims")?.title).toBe("1 bevinding met tegenstrijdige bronnen");
  });

  it("geen dubbel label en weerlegd apart geteld", () => {
    expect(claimStatusText({ status: "Weerlegd", statusKey: "refuted", contradicted: true })).toBe("Weerlegd");
    expect(claimStatusText({ status: "Tegenstrijdige bronnen", statusKey: "contested", contradicted: true })).toBe("Tegenstrijdige bronnen");
    expect(claimStatusText({ status: "Onderbouwde schatting", statusKey: "estimate", contradicted: true })).toBe("Onderbouwde schatting, tegengesproken");
    expect(claimCountsNote({ verified: 1, insufficient: 0, contested: 1, refuted: 2 })).toBe("1 geverifieerd · 0 onvoldoende · 1 tegenstrijdig · 2 weerlegd");
    expect(claimCountsNote({ verified: 1, insufficient: 0 })).toBe("1 geverifieerd · 0 onvoldoende");
  });

  it("een weerlegde bevinding is nooit sterkste bewijs", () => {
    const out = strongestEvidence({
      observations: [],
      claims: [{ statement: "Er zijn 24.000 sportclubs.", verified: true, refuted: true, contradicted: true, notes: [1], source: "CBS", url: null, strong: true }],
    });
    expect(out).toEqual([]);
  });

  it("de PDF noemt weerlegde bevindingen als tegenbewijs, zonder '(Weerlegd, tegengesproken)'", () => {
    const r = {
      version: 1,
      generatedAt: "2026-11-04T10:00:00.000Z",
      preparedBy: "Bureau",
      createdBy: "",
      client: null,
      label: "Verkenning",
      labelMissing: [],
      idea: { title: "AI-communicatie voor sportclubs", decisionQuestion: "Gaan we door?", description: "", audience: "", region: "Nederland", budget: null, keyUncertainty: null, isDemo: false },
      questions: [],
      claims: [{ statement: "Clubs hebben een communicatiebudget.", section: "market", status: "Weerlegd", statusKey: "refuted", type: "", doesNotProve: null, limitations: null, notes: [1], contradicted: true }],
      counts: { claims: 1, verified: 0, insufficient: 0, contested: 0, refuted: 1 },
      competitors: [],
      sizing: [],
      unit: null,
      assumptions: [],
      simulation: null,
      signals: [],
      prediction: null,
      experiments: [],
      learningCards: [],
      realityCheck: null,
      decision: null,
      sources: [],
      method: { aiCalls: 0, aiCostUsd: 0, models: [] },
    } as unknown as ReportSnapshot;
    const text = (blocks: Block[]) => blocks.map((b) => (b.t === "list" ? b.items.join("\n") : b.t === "kpis" ? b.items.map((k) => k.note).join("\n") : b.t === "p" ? b.text : "")).join("\n");
    const all = buildReportPdfModel(r, { shared: false, version: 1 }).chapters.map((c) => text(c.blocks)).join("\n");
    expect(all).toContain("(Weerlegd)");
    expect(all).not.toContain("Weerlegd, tegengesproken");
    expect(all).toContain("Weerlegd door gecontroleerde bronnen: Clubs hebben een communicatiebudget.");
    expect(all).not.toContain("Tegengesproken door een bron: Clubs hebben");
    expect(all).toContain("1 weerlegd");
  });
});
