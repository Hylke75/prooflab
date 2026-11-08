import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CanvasBoard, type BoardActions, type BoardItem } from "@/components/canvas/CanvasBoard";
import { ReportCanvasSection } from "@/components/canvas/ReportCanvasSection";
import { itemStanding, reportCanvas, type AssumptionEvidence } from "@/lib/domain/canvas";

// Weergave van het canvas (zonder browser): opbouw, bewijsstand per onderdeel, alleen-lezen voor de opdrachtgever.
const a: AssumptionEvidence = { id: "a1", statement: "Clubs betalen € 20 per maand", status: "supported", register: [] };
const item = (id: string, block: string, body: string, extra: Partial<BoardItem> = {}): BoardItem => {
  const base = { id, canvas: "business" as const, block, body, position: 0, createdAt: "2026-11-18T10:00:00Z", origin: "manual", accepted: false, assumption: null, ...extra };
  return { ...base, standing: itemStanding({ origin: base.origin, accepted: base.accepted, assumptionId: base.assumption?.id ?? null }, base.assumption ? a : null) };
};
const items: BoardItem[] = [
  item("1", "customer_segments", "Amateurvoetbalclubs"),
  item("2", "revenue_streams", "€ 20 per maand", { assumption: { id: "a1", statement: a.statement, status: "supported", statusLabel: "Ondersteund", tally: "1 voor" } }),
  item("3", "channels", "Instagram", { origin: "ai" }),
];
const noop = async () => ({ error: null });
const actions: BoardActions = { add: noop, update: noop, remove: noop, move: noop, accept: noop, link: noop, createAssumption: noop };

describe("CanvasBoard", () => {
  it("businessmodel: negen bouwstenen, elk onderdeel met zijn bewijsstand, lege bouwsteen is onbekend", () => {
    const html = renderToStaticMarkup(createElement(CanvasBoard, { ideaId: "i", canvas: "business", view: "canvas", items, assumptions: [], canWrite: true, actions }));
    expect(html.match(/class="canvas-block /g)).toHaveLength(9);
    expect(html).toContain("Getoetst · ondersteund");
    expect(html).toContain("st-supported");
    expect(html).toContain("Nog geloof");
    expect(html).toContain("AI-voorstel");
    expect(html).toContain("st-proposal");
    expect(html).toContain("Nog leeg: onbekend.");
    expect(html).toContain('aria-label="Onderdeel toevoegen aan Kanalen"');
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it("opdrachtgever: geen bewerkknoppen", () => {
    const html = renderToStaticMarkup(createElement(CanvasBoard, { ideaId: "i", canvas: "business", view: "canvas", items, assumptions: [], canWrite: false, actions: null }));
    expect(html).not.toContain("Toevoegen");
  });

  it("simpele weergave met de vragen in gewone taal; waardepropositie met klantprofiel en waardekaart", () => {
    const list = renderToStaticMarkup(createElement(CanvasBoard, { ideaId: "i", canvas: "business", view: "list", items, assumptions: [], canWrite: false, actions: null }));
    expect(list).toContain("canvas-list");
    expect(list).toContain("Voor wie?");
    expect(list).toContain("Waar verdienen we aan?");
    expect(list).toContain("Wat kost het?");
    const value = renderToStaticMarkup(createElement(CanvasBoard, { ideaId: "i", canvas: "value", view: "canvas", items: [], assumptions: [], canWrite: false, actions: null }));
    expect(value).toContain("Klantprofiel");
    expect(value).toContain("Waardekaart");
    expect(value.match(/class="canvas-block /g)).toHaveLength(6);
  });
});

describe("ReportCanvasSection", () => {
  it("compacte tabel met bouwsteen, onderdeel en bewijsstand; open AI-voorstel alleen geteld", () => {
    const rc = reportCanvas(items, { number: 2, at: "2026-11-18T10:00:00Z", author: "Eva" })!;
    const html = renderToStaticMarkup(createElement(ReportCanvasSection, { canvas: rc }));
    expect(html).toContain("Businessmodel en propositie");
    expect(html).toContain("Amateurvoetbalclubs");
    expect(html).toContain("Getoetst · ondersteund");
    expect(html).not.toContain("Instagram");
    expect(html).toContain("1 AI-voorstel nog niet beoordeeld");
    expect(html).toContain("versie 2");
  });
});
