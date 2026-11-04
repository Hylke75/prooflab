import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ReportSnapshot } from "@/lib/report";
import { buildReportPdfModel, type Block } from "@/lib/report-pdf-model";
import { pdfText, renderReportPdf } from "@/lib/report-pdf";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { assumptionProbabilityV5 } from "@/lib/domain/evidence";
import { evidenceStanding, standingFromSnapshot } from "@/lib/domain/evidence-standing";
import { EvidenceStanding } from "@/components/evidence/EvidenceStanding";

// A report snapshot as lib/report.ts stores it (only the fields the PDF reads).
function fixture(over: Partial<Record<string, unknown>> = {}): ReportSnapshot {
  const base = {
    version: 1,
    generatedAt: "2026-11-03T10:00:00.000Z",
    preparedBy: "Bureau Bewijs",
    createdBy: "consultant@example.com",
    client: "Evenementen BV",
    label: "Gedeeltelijk gevalideerd",
    labelMissing: ["een betalingstest"],
    idea: {
      title: "Eventplanner Pro",
      decisionQuestion: "Investeren we 25.000 euro in een pilot?",
      description: "Planningssoftware voor kleine eventbureaus.",
      audience: "Eventmanagers",
      region: "Nederland",
      budget: 25000,
      keyUncertainty: null,
      isDemo: false,
    },
    questions: [{ position: 1, question: "Hoe plannen eventbureaus nu?", status: "answered", doneCriterion: "Vijf interviews" }],
    claims: [
      { statement: "Er zijn 4.200 eventbureaus in Nederland.", section: "market", status: "Geverifieerd", statusKey: "verified", type: "Officiële statistiek", doesNotProve: "Dat ze willen betalen.", limitations: "Telling van 2025.", notes: [1], contradicted: false },
      { statement: "Bureaus plannen vooral in Excel.", section: "customers", status: "Onderbouwde schatting", statusKey: "estimate", type: "Forum", doesNotProve: null, limitations: null, notes: [], contradicted: true },
    ],
    counts: { claims: 2, verified: 1, insufficient: 0 },
    competitors: [{ name: "Excel", kind: "Huidig alternatief", positioning: "Gratis en bekend", price: "Niet publiek", differentiation: null }],
    sizing: [
      { label: "Voorzichtig", somRevenue: 50000, somCount: 20, samCount: 1000, tamCount: 4200, formula: "4200 × 0,25 × 0,02", provenance: { sourced: 2, total: 3 }, status: "Schatting", factors: [] },
      { label: "Realistisch", somRevenue: 120000, somCount: 50, samCount: 1500, tamCount: 4200, formula: "4200 × 0,35 × 0,033", provenance: { sourced: 2, total: 3 }, status: "Schatting met bron", factors: [] },
    ],
    unit: null,
    assumptions: [{ statement: "Bureaus betalen 49 euro per maand.", importance: 5, evidence: 30, status: "testing", premortem: false, probability: null }],
    simulation: null,
    signals: [{ kind: "objection", label: "Te duur voor kleine bureaus", mentions: 3 }],
    prediction: {
      outcome: { statement: "Tien betalende klanten", target: 10, metric: "klanten", due: "2027-05-01" },
      baseRate: { low: 0.2, high: 0.4, reference: null, own: null, note: null },
      revealed: false,
      moments: [{ moment: "Na het onderzoek", count: 2, people: null, ai: null, forecasts: [] }],
      checkins: [],
      result: null,
    },
    experiments: [
      {
        title: "Enquête eventmanagers",
        type: "Enquête",
        state: "ended",
        hypothesis: "Eventmanagers zoeken actief een tool.",
        metric: "zocht / respondenten",
        threshold: "≥ 30% succes, n ≥ 20",
        lockedAt: "2026-10-01T09:00:00.000Z",
        n: 40,
        successes: 14,
        interval: { point: 0.35, low: 0.22, high: 0.5 },
        verdict: "pass",
        verdictReason: "Boven de drempel.",
        byChannel: [
          { channel: "email", visitors: 25, actions: 10 },
          { channel: "linkedin", visitors: 15, actions: 4 },
        ],
        byVariant: [],
        warnings: [],
        endedEarly: false,
        selfReported: true,
        bySource: { invitation: { n: 25, successes: 10 }, openLink: { n: 15, successes: 4 } },
      },
    ],
    learningCards: [],
    realityCheck: { at: "2026-10-20T09:00:00.000Z", advice: "Doorgaan", reason: "Voldoende signaal.", findings: [{ title: "Kleine steekproef", detail: "n = 40", severity: "medium", source: "regels" }], aiUsed: false },
    decision: { action: "Doorgaan", rationale: "De vraag is aangetoond.", nextStep: "Start een betaalde pilot", at: "2026-10-25T09:00:00.000Z", confirmedAt: null, comment: null },
    sources: [{ n: 1, title: "Bedrijven naar branche", url: "https://www.cbs.nl/voorbeeld", publisher: "CBS", published_on: "2026-01-15", retrieved_at: "2026-09-10T09:00:00.000Z", type: "Officiële statistiek", primary: true }],
    method: { aiCalls: 0, aiCostUsd: 0, models: [] },
  };
  return { ...base, ...over } as unknown as ReportSnapshot;
}

const text = (blocks: Block[]) =>
  blocks
    .map((b) => (b.t === "list" ? b.items.join("\n") : b.t === "table" ? [b.head, ...b.rows].flat().join("\n") : b.t === "kpis" ? b.items.map((k) => `${k.label} ${k.value} ${k.note}`).join("\n") : b.t === "note" ? `${b.title} ${b.text}` : b.text))
    .join("\n");

describe("report PDF content", () => {
  const model = buildReportPdfModel(fixture(), { shared: true, version: 3 });
  const all = model.chapters.map((c) => `${c.eyebrow}\n${c.title}\n${text(c.blocks)}`).join("\n");

  it("has the cover with status, project and research period", () => {
    expect(model.cover.title).toBe("Eventplanner Pro");
    expect(model.cover.eyebrow).toContain("VERSIE 3");
    expect(model.cover.facts.find((f) => f.label === "Rapportstatus")?.value).toContain("Gedeeld met opdrachtgever");
    expect(model.cover.facts.find((f) => f.label === "Onderzoeksperiode")?.value).toMatch(/10 september 2026/);
  });

  it("contains every chapter of the report, footnotes and the appendix", () => {
    for (const id of ["summary", "question", "market", "competition", "sizing", "assumptions", "experiments", "reality", "decision", "advice", "prediction", "sources", "appendix"]) {
      expect(model.chapters.map((c) => c.id)).toContain(id);
    }
    expect(all).toContain("Er zijn 4.200 eventbureaus in Nederland. [1]");
    expect(all).toContain("Bureaus plannen vooral in Excel. [geen bron]");
    expect(all).toContain("https://www.cbs.nl/voorbeeld");
    expect(all).toContain("Officiële statistiek · primaire bron");
    expect(all).toContain("Tegengesproken door een bron: Bureaus plannen vooral in Excel.");
    expect(all).toContain("Bezwaar van klanten: Te duur voor kleine bureaus");
    expect(all).toContain("Volgende stap: Start een betaalde pilot.");
    expect(all).toContain("Nog niet bevestigd");
    // Raw data: n, successes, channel split and the key metric per survey source.
    expect(all).toContain("Persoonlijke e-mailuitnodiging 10/25");
    expect(all).toContain("Open link (herkomst niet te controleren)");
  });

  it("labels survey results as self-report", () => {
    expect(all).toContain("Zelfrapportage, geen waargenomen gedrag");
    expect(all).toContain("kernvraag per herkomst (zelfrapportage)");
  });

  it("keeps forecasts hidden until the outcome is known", () => {
    const prediction = model.chapters.find((c) => c.id === "prediction")!;
    expect(prediction.blocks.some((b) => b.t === "table")).toBe(false);
    expect(text(prediction.blocks)).toContain("blijven verborgen tot de uitkomst bekend is");

    const known = buildReportPdfModel(
      fixture({
        prediction: {
          outcome: { statement: "Tien betalende klanten", target: 10, metric: "klanten", due: "2027-05-01" },
          baseRate: { low: null, high: null, reference: null, own: null, note: null },
          revealed: true,
          moments: [{ moment: "Na het onderzoek", count: 1, people: { mean: 0.6, min: 0.6, max: 0.6, n: 1 }, ai: 0.4, forecasts: [{ who: "Consultant", probability: 0.6, rationale: "", brier: 0.16 }] }],
          checkins: [],
          result: { achieved: "Gehaald", value: 12, evidence: "Facturen", at: "2027-05-02T09:00:00.000Z" },
        },
      }),
      { shared: true, version: 4 },
    );
    const table = known.chapters.find((c) => c.id === "prediction")!.blocks.find((b) => b.t === "table");
    expect(table && text([table])).toContain("60%");
  });

  it("maps characters outside the standard PDF fonts", () => {
    expect(pdfText("≥ 30% · € 5 – “ja”")).toBe(">= 30% · € 5 – “ja”");
    expect(pdfText("✓ klaar 🚀")).toBe("v klaar ?");
  });
});

describe("beslisblad in de PDF (B6)", () => {
  it("zet het beslisblad vóór het dossier, met besluit, bewijs, open punten en volgende stap", () => {
    const m = buildReportPdfModel(fixture(), { shared: false, version: 2 });
    expect(m.sheetEyebrow).toContain("BESLISBLAD · VERSIE 2");
    expect(m.cover.eyebrow).toContain("BIJLAGE · VOLLEDIG VALIDATIEDOSSIER");
    // Oud rapport zonder opgeslagen beslisblad: afgeleid. Doorgaan zonder afgeronde test met uitslag is nog niet beslisbaar.
    expect(m.sheet.derived).toBe(true);
    expect(m.sheet.verdictLabel).toBe("Nog niet beslisbaar");
    expect(m.sheet.strongest.length).toBeLessThanOrEqual(3);
    expect(m.sheet.strongest.some((e) => e.source.startsWith("CBS") && e.note === 1)).toBe(true);
    expect(m.sheet.notProven.length).toBeLessThanOrEqual(3);
    expect(m.sheet.nextStep.text).toBe("Start een betaalde pilot.");
  });

  it("toont 'Niet vastgesteld' in plaats van € 0 als de marktomvang niet is vastgesteld", () => {
    const m = buildReportPdfModel(
      fixture({
        sizing: [{ label: "Realistisch", somRevenue: 0, somCount: 0, samCount: 0, tamCount: 0, formula: "0 × 0", provenance: { sourced: 0, total: 5 }, status: "Verkennend scenario; marktomvang niet vastgesteld", factors: [], established: false }],
      }),
      { shared: false, version: 1 },
    );
    const kpis = m.chapters.find((c) => c.id === "summary")!.blocks.find((b) => b.t === "kpis");
    const revenue = kpis && kpis.t === "kpis" ? kpis.items.find((k) => k.label.startsWith("Bereikbare jaaromzet")) : null;
    expect(revenue?.value).toBe("Niet vastgesteld");
    expect(revenue?.note).toMatch(/basisomvang/);
    const table = m.chapters.find((c) => c.id === "sizing")!.blocks.find((b) => b.t === "table");
    expect(table && table.t === "table" ? table.rows[0][4] : "").toBe("Niet vastgesteld");
  });
});

describe("report PDF rendering", () => {
  it("renders a real PDF document server-side", async () => {
    const buf = await renderReportPdf(fixture(), { shared: false, version: 2 });
    // PDF_DUMP=/path/report.pdf keeps the file for a visual check.
    if (process.env.PDF_DUMP) writeFileSync(process.env.PDF_DUMP, buf);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const raw = buf.toString("latin1");
    // Object dictionaries are not compressed (only content streams): count the pages and read the title.
    const pages = raw.match(/\/Type \/Page\b/g)?.length ?? 0;
    // Beslisblad, cover van het dossier en minstens één pagina met hoofdstukken.
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(raw).toContain("Eventplanner Pro");
    expect(raw.trimEnd().endsWith("%%EOF")).toBe(true);
  }, 30_000);
});

// Fase 1, punt 2: de Stand van het bewijs in het rapport (momentopname, scherm en PDF).
describe("Stand van het bewijs in het rapport", () => {
  const p = assumptionProbabilityV5([], [{ id: "o1", kind: "demo_request", relation: "supports", isSynthetic: false, origin: "manual", sourceKey: "interview:1", sourceLabel: "Interview 1" }]);
  const standing = evidenceStanding({
    ideaId: "idee",
    assumptions: [{ id: "a1", statement: "Bureaus betalen 49 euro per maand.", importance: 5, selectedForTest: true, probability: p, register: p.items, primaryExperimentId: null }],
    tests: [],
    next: { title: "Ontwerp de volgende test", detail: "Het bewijs is nog te zwak.", href: "/app/ideas/idee/experiments" },
    calibrated: false,
  });

  it("de momentopname bewaart het blok; scherm en PDF tonen het bovenaan", () => {
    const r = fixture({ standing: JSON.parse(JSON.stringify(standing)) });
    expect(standingFromSnapshot(r)).toEqual(standing);
    const m = buildReportPdfModel(r, { shared: true, version: 4 });
    expect(m.standing.summary).toBe("Zekerheid: midden · 0 van 1 kritieke aanname getest · sterkste bewijs: kleine handeling (1 persoon) · volgende stap: ontwerp de volgende test");
    expect(m.standing.scale).toBe("Bewijsschaal (sterkste bewijs): Verkenning · Mening · [Gedrag] · Betaling · Herhaling");
    expect(m.standing.lines).toEqual(["Aanname 1: Bureaus betalen 49 euro per maand. Kans 55–65% · 1 voor · 0 tegen · Hoofdtest: nog niet aangewezen."]);
    expect(m.standing.notes).toEqual(["Volgende stap: Ontwerp de volgende test. Het bewijs is nog te zwak.", "Kansen: niet gekalibreerd, in banden van 10 procentpunt."]);
    const html = renderToStaticMarkup(createElement(EvidenceStanding, { standing: standingFromSnapshot(r), ideaId: "idee", links: false, className: "report-section" }));
    expect(html).toContain("Stand van het bewijs");
    expect(html).toContain(standing.summary);
    expect(html).not.toContain("<a ");
  });

  it("oudere rapporten zonder blok krijgen een afgeleid blok", () => {
    const legacy = fixture({
      assumptions: [
        { statement: "Bureaus betalen 49 euro per maand.", importance: 5, evidence: 30, status: "supported", premortem: false, probability: { point: 0.62, low: 0.55, high: 0.7, prior: 0.5 } },
        { statement: "Bureaus plannen in Excel.", importance: 4, evidence: 10, status: "testing", premortem: false, probability: { point: 0.42, low: 0.4, high: 0.45, prior: 0.5 } },
        { statement: "Onbelangrijk.", importance: 2, evidence: 0, status: "untested", premortem: false, probability: { point: 0.3, low: 0.3, high: 0.3, prior: 0.5 } },
      ],
      observationCounts: { rungs: [], highest: { label: "Concrete aanvraag of keuze bij prijs", count: 2 }, paymentShown: false, counted: 2, quotes: 2, people: 2 },
    });
    const st = standingFromSnapshot(legacy);
    expect(st.derived).toBe(true);
    expect(st.summary).toBe("Zekerheid: laag · 1 van 2 kritieke aannames getest · sterkste bewijs: keuze bij een prijs");
    expect(st.certaintyReason).toBe("laagste kans onder de kritieke aannames 35–45% (aanname 2); sterkste klantbewijs van het dossier: gedrag");
    const m = buildReportPdfModel(legacy, { shared: true, version: 1 });
    expect(m.standing.lines[0]).toBe("Aanname 1: Bureaus betalen 49 euro per maand. Kans 55–65% · telling niet vastgelegd in deze versie · Status: ondersteund.");
    expect(m.standing.notes.some((n) => n.startsWith("Afgeleid uit een rapportversie"))).toBe(true);
    // Zonder kansen en zonder ladder (de oudste rapporten): laag, en dat staat erbij.
    expect(standingFromSnapshot(fixture()).certaintyReason).toBe("nog geen kritieke aanname (belangrijkheid 4 of 5) met een kans in deze versie");
  });

  it("de PDF met het blok rendert", async () => {
    const buf = await renderReportPdf(fixture({ standing }), { shared: false, version: 4 });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30_000);
});
