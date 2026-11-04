import { describe, expect, it } from "vitest";
import type { ReportSnapshot } from "@/lib/report";
import { assumptionProbabilityText, buildReportPdfModel, type Block } from "@/lib/report-pdf-model";
import { pdfText } from "@/lib/report-pdf";
import { confirmationAuditLine, decisionParagraph, oneSentence, type ReportDecision } from "@/lib/report-sheet";
import { endSentence, plural } from "@/lib/text";
import { testMoreNextStep } from "@/lib/domain/extension";

// Gebruikerstest groep D: tekst van het rapport (D1–D4).

const base: ReportDecision = { action: "Doorgaan", actionCode: "continue", rationale: "Het bewijs draagt de pilot.", nextStep: "Start de pilot", at: "2026-11-04T09:00:00.000Z", confirmedAt: null, comment: null };
const LABELS: Record<string, string> = { continue: "Doorgaan", stop: "Stoppen", test_more: "Verder testen", extend: "Verder testen", adjust: "Bijsturen", pause: "Pauzeren" };
const dec = (code: string, over: Partial<ReportDecision> = {}): ReportDecision => ({ ...base, action: LABELS[code], actionCode: code, ...over });

function fixture(over: Partial<Record<string, unknown>> = {}): ReportSnapshot {
  const b = {
    version: 1,
    generatedAt: "2026-11-04T10:00:00.000Z",
    preparedBy: "Bureau Bewijs",
    createdBy: "consultant@example.com",
    client: null,
    label: "Verkenning",
    labelMissing: [],
    idea: { title: "AI-communicatie voor sportclubs", decisionQuestion: "Gaan we door?", description: "Communicatie voor clubs.", audience: "Sportclubs", region: "Nederland", budget: null, keyUncertainty: null, isDemo: false },
    questions: [],
    claims: [],
    counts: { claims: 0, verified: 0, insufficient: 0 },
    competitors: [],
    sizing: [],
    unit: null,
    assumptions: [],
    simulation: null,
    signals: [],
    prediction: {
      outcome: { statement: "Tien betalende clubs", target: 10, metric: "clubs", due: "2027-05-01" },
      baseRate: { low: null, high: null, reference: null, own: null, note: null },
      revealed: false,
      moments: [],
      checkins: [],
      result: null,
    },
    experiments: [],
    learningCards: [],
    realityCheck: null,
    decision: null,
    sources: [],
    method: { aiCalls: 0, aiCostUsd: 0, models: [] },
  };
  return { ...b, ...over } as unknown as ReportSnapshot;
}

const text = (blocks: Block[]) =>
  blocks
    .map((b) => (b.t === "list" ? b.items.join("\n") : b.t === "table" ? [b.head, ...b.rows].flat().join("\n") : b.t === "kpis" ? b.items.map((k) => `${k.label} ${k.value} ${k.note}`).join("\n") : b.t === "note" ? `${b.title} ${b.text}` : b.text))
    .join("\n");

const all = (r: ReportSnapshot) =>
  buildReportPdfModel(r, { shared: false, version: 1 })
    .chapters.map((c) => `${c.eyebrow}\n${c.title}\n${text(c.blocks)}`)
    .join("\n");

describe("D1: hoofdstuk 09 per soort besluit", () => {
  it.each(["continue", "stop"])("%s zonder opdrachtgever: direct definitief", (code) => {
    const t = decisionParagraph(dec(code), "2026-11-04", { hasClient: false });
    expect(t).toContain("Dit dossier heeft geen opdrachtgever: het besluit is direct definitief.");
    expect(confirmationAuditLine(dec(code), false)).toBe("Niet nodig: geen opdrachtgever, het besluit is direct definitief");
  });

  it.each(["continue", "stop"])("%s met opdrachtgever: wacht op bevestiging, daarna bevestigd", (code) => {
    expect(decisionParagraph(dec(code), "2026-11-04", { hasClient: true })).toContain("Nog niet bevestigd door de opdrachtgever.");
    expect(confirmationAuditLine(dec(code), true)).toBe("Nog niet bevestigd");
    const confirmed = dec(code, { confirmedAt: "2026-11-05T10:00:00.000Z", comment: "Akkoord" });
    expect(decisionParagraph(confirmed, "2026-11-05", { hasClient: true })).toContain("Bevestigd door de opdrachtgever op 5 november 2026 (“Akkoord”).");
  });

  it.each(["test_more", "extend", "adjust", "pause"])("%s is nooit definitief, met of zonder opdrachtgever", (code) => {
    for (const hasClient of [true, false]) {
      for (const confirmation of [undefined, "not_needed" as const]) {
        const d = dec(code, { confirmation, extendWeeks: code === "extend" ? 4 : null });
        const t = decisionParagraph(d, "2026-11-04", { hasClient });
        expect(t).toContain("tussenbesluit, nog geen definitief besluit");
        expect(t).not.toMatch(/direct definitief|besluit is definitief|Nog niet bevestigd/);
        expect(confirmationAuditLine(d, hasClient)).toBe("Tussenbesluit: nog geen definitief besluit");
      }
    }
  });

  it("de PDF zegt bij een tussenbesluit zonder opdrachtgever niet 'Nog niet bevestigd'", () => {
    const out = all(fixture({ decision: dec("test_more", { confirmation: "not_final" }) }));
    expect(out).not.toContain("Nog niet bevestigd");
    expect(out).not.toContain("direct definitief");
    expect(out).toContain("Tussenbesluit: nog geen definitief besluit");
  });

  it("oudere momentopname zonder actionCode: actie uit het label", () => {
    const t = decisionParagraph({ ...base, action: "Bijsturen", actionCode: undefined, confirmation: "not_needed" }, "2026-11-04");
    expect(t).not.toContain("direct definitief");
  });

  it("geen dubbele punt na de volgende stap", () => {
    const t = decisionParagraph(dec("continue", { nextStep: "Start de pilot." }), "2026-11-04", { hasClient: false });
    expect(t).toContain("Volgende stap: Start de pilot. Vastgelegd");
    expect(t).not.toContain("..");
  });
});

describe("D2: de verlengde testfase met datum", () => {
  it("extend 4 weken, momentopname 4 november 2026: loopt tot 2 december 2026", () => {
    const t = decisionParagraph(dec("extend", { extendWeeks: 4 }), "2026-11-04");
    expect(t).toContain("De verlengde testfase loopt tot 2 december 2026; daarna volgt het definitieve besluit en start de uitkomstklok.");
  });

  it("de periode is voorbij: verleden tijd met datum", () => {
    const t = decisionParagraph(dec("extend", { extendWeeks: 4, extendUntil: "2026-12-02" }), "2026-12-10");
    expect(t).toContain("De verlengde testfase liep tot 2 december 2026");
  });

  it("de PDF noemt het einde in de audittabel en in de tekst", () => {
    const out = all(fixture({ decision: dec("extend", { extendWeeks: 4 }) }));
    expect(out).toContain("4 weken, tot 2 december 2026");
    expect(out).toContain("loopt tot 2 december 2026");
  });

  it("testMoreNextStep zet een ISO-datum om naar een Nederlandse datum", () => {
    expect(testMoreNextStep(3, "2026-11-25", null)).toBe("Verder testen: 3 weken, tot 25 november 2026.");
  });
});

describe("D3: endSentence", () => {
  it("zet alleen een punt als de zin nog niet is afgesloten", () => {
    expect(endSentence("Start de pilot")).toBe("Start de pilot.");
    expect(endSentence("Start de pilot.")).toBe("Start de pilot.");
    expect(endSentence("Klopt dat?")).toBe("Klopt dat?");
    expect(endSentence("Zeker!")).toBe("Zeker!");
    expect(endSentence("En dan…")).toBe("En dan…");
    expect(endSentence("Hij zei “ja.”")).toBe("Hij zei “ja.”");
    expect(endSentence("(zie de bijlage.)")).toBe("(zie de bijlage.)");
    expect(endSentence("Zie bijlage (B)")).toBe("Zie bijlage (B).");
    expect(endSentence("")).toBe("");
  });

  it("oneSentence gebruikt endSentence", () => {
    expect(oneSentence("Een korte maar volledige zin zonder punt")).toBe("Een korte maar volledige zin zonder punt.");
    expect(oneSentence("Is dit een vraag die eindigt op een vraagteken?")).toBe("Is dit een vraag die eindigt op een vraagteken?");
  });

  it("plural kiest enkelvoud of meervoud", () => {
    expect(plural(1, "bevinding", "bevindingen")).toBe("1 bevinding");
    expect(plural(3, "bevinding", "bevindingen")).toBe("3 bevindingen");
  });

  it("de PDF zet geen dubbele punten na volgende stap, beslisregel en uitkomst", () => {
    const r = fixture({
      decision: { ...dec("continue", { nextStep: "Start de pilot." }), rule: { met: true, lines: ["Hoofdtest Prijs: geslaagd."], deviation: null } },
      prediction: { ...(fixture().prediction as object), outcome: { statement: "Tien betalende klanten.", target: null, metric: null, due: null } },
    });
    const out = all(r);
    expect(out).not.toMatch(/[^.]\.\.(?!\.)/);
    expect(out).toContain("Volgende stap: Start de pilot.");
    expect(out).toContain("Toets over zes maanden of het idee slaagde: Tien betalende klanten.");
  });
});

describe("D4: kansen in rapport en PDF als platte tekst", () => {
  const prob = { point: 0.4, low: 0.4, high: 0.4, prior: 0.5 };
  const assumption = { statement: "Clubs betalen 79 euro per maand.", importance: 5, evidence: 30, status: "testing", premortem: false, probability: prob, capReason: null, merged: [] };

  it("geen 'Exacte waarde' en geen '40%–40%' in helper en pdfText", () => {
    for (const calibrated of [true, false]) {
      const t = assumptionProbabilityText(assumption, calibrated);
      expect(t).not.toContain("Exacte waarde");
      expect(t).not.toMatch(/40%–40%|40–40%/);
      const out = pdfText(all(fixture({ assumptions: [assumption], calibration: { resolved: calibrated ? 12 : 1, calibrated } })));
      expect(out).not.toContain("Exacte waarde");
      expect(out).not.toMatch(/40%.40%|40.40%/);
    }
    expect(assumptionProbabilityText(assumption, true)).toBe("40%");
  });

  it("'niet gekalibreerd' staat precies één keer in hoofdstuk 06, zonder tooltip-verwijzing", () => {
    const m = buildReportPdfModel(fixture({ assumptions: [assumption, { ...assumption, statement: "Tweede aanname." }], calibration: { resolved: 1, calibrated: false } }), { shared: false, version: 1 });
    const t = text(m.chapters.find((c) => c.id === "assumptions")!.blocks);
    expect(t.match(/niet gekalibreerd/gi)?.length).toBe(1);
    expect(t).not.toContain("tooltip");
  });
});
