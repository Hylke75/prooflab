import { describe, expect, it } from "vitest";
import type { ReportSnapshot } from "@/lib/report";
import { buildReportPdfModel, type Block } from "@/lib/report-pdf-model";

// Golf A in het rapport (PDF-model). Dezelfde momentopname als tests/unit/report-pdf.test.ts.

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

const all = (r: ReportSnapshot) =>
  buildReportPdfModel(r, { shared: false, version: 1 })
    .chapters.map((c) => `${c.eyebrow}\n${c.title}\n${text(c.blocks)}`)
    .join("\n");
const prob = { point: 0.432, low: 0.33, high: 0.58, prior: 0.5 };
const assumption = { statement: "Bureaus betalen 49 euro per maand.", importance: 5, evidence: 30, status: "testing", premortem: false, probability: prob, capReason: null, merged: [] };

describe("rapport: kansen (punt 3)", () => {
  it("toont kansen in banden met 'niet gekalibreerd' zolang er geen kalibratie is", () => {
    const out = all(fixture({ assumptions: [assumption], calibration: { resolved: 3, calibrated: false } }));
    expect(out).toContain("Geschatte kans (niet gekalibreerd)");
    expect(out).toContain("40–50% (30–60%)");
    expect(out).toMatch(/minder dan 10 opgeloste dossiers/);
  });

  it("oudere rapporten zonder kalibratie: ook in banden", () => {
    expect(all(fixture({ assumptions: [assumption] }))).toContain("40–50% (30–60%)");
  });

  it("gekalibreerd: hele procenten", () => {
    const out = all(fixture({ assumptions: [assumption], calibration: { resolved: 12, calibrated: true } }));
    expect(out).toContain("43% (33–58%)");
    expect(out).not.toContain("niet gekalibreerd");
  });
});

describe("rapport: bewijsniveau naast de uitkomst (punt 14)", () => {
  it("toont het niveau bij de test en op de Learning Card", () => {
    const base = fixture();
    const out = all(
      fixture({
        experiments: base.experiments.map((e) => ({ ...e, label: "geslaagd", level: "opinion" })),
        learningCards: [{ believed: "b", observed: "o", learned: "l", therefore: "t", verdict: "pass", reliability: "medium", level: "opinion", title: "Enquête" }],
      }),
    );
    expect(out).toContain("Oordeel: Geslaagd · niveau: mening");
    expect(out).toContain("Learning Card: Enquête · Geslaagd · niveau: mening");
  });
});

describe("rapport: alle tests (punt 12)", () => {
  it("de lijst staat in de PDF, met rol, status, uitkomst en het aantal per aanname", () => {
    const out = all(
      fixture({
        allTests: {
          rows: [
            { title: "Landing", type: "Landingpage-test", assumption: "A1", role: "Hoofdtest", status: "afgerond", outcome: "niet geslaagd · niveau: kleine handeling", result: "2 van 40", aborted: false, failed: true },
            { title: "Enquête", type: "Enquête", assumption: "A1", role: "Verkennend", status: "afgebroken · afgerond", outcome: "geslaagd · niveau: mening", result: "14 van 40", aborted: true, failed: false },
          ],
          perAssumption: [{ assumption: "A1", total: 2, primary: 1, exploratory: 1 }],
        },
      }),
    );
    expect(out).toContain("Alle tests");
    expect(out).toContain("2 tests vooraf vastgelegd: 1 niet geslaagd, 1 afgebroken, 1 verkennend.");
    expect(out).toContain("niet geslaagd · niveau: kleine handeling");
    expect(out).toContain("A1: 2 tests (1 hoofdtest, 1 verkennend)");
  });

  it("oudere rapporten zeggen eerlijk dat de lijst ontbreekt", () => {
    expect(all(fixture())).toContain('Dit rapport is gemaakt vóór de lijst "Alle tests" bestond.');
  });
});
