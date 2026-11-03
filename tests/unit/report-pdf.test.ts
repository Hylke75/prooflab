import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ReportSnapshot } from "@/lib/report";
import { buildReportPdfModel, type Block } from "@/lib/report-pdf-model";
import { pdfText, renderReportPdf } from "@/lib/report-pdf";

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
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(raw).toContain("Eventplanner Pro");
    expect(raw.trimEnd().endsWith("%%EOF")).toBe(true);
  }, 30_000);
});
