import { describe, expect, it } from "vitest";
import {
  BUSINESS_BLOCKS,
  VALUE_BLOCKS,
  asReportCanvas,
  asVersionItems,
  blockCategory,
  validateAssumptionStatement,
  diffLine,
  diffVersions,
  draftsFromSources,
  itemStanding,
  moveItem,
  nextPosition,
  originLabel,
  reportCanvas,
  sortByPosition,
  standingSummary,
  summaryLine,
  validateItem,
  validateNote,
  type AssumptionEvidence,
  type VersionItem,
} from "@/lib/domain/canvas";
import type { EvidenceLevel } from "@/lib/domain/evidence";
import { STEPS, stepForPath } from "@/lib/steps";
import { noteStepForSection } from "@/lib/domain/step-files";

type Reg = AssumptionEvidence["register"][number];
const obs = (level: EvidenceLevel, extra: Partial<Reg> = {}): Reg => ({ itemType: "observation", fate: "counted", direction: "supports", level, notes: [], ...extra });
const claim = (extra: Partial<Reg> = {}): Reg => ({ itemType: "claim", fate: "counted", direction: "supports", level: "opinion", notes: [], ...extra });
const assumption = (status: string, register: Reg[] = []): AssumptionEvidence => ({ id: "a1", statement: "Clubs betalen € 20 per maand", status, register });
const linked = { origin: "manual", accepted: false, assumptionId: "a1" };

describe("bouwstenen", () => {
  it("negen bouwstenen voor het businessmodel en zes voor de waardepropositie, met unieke sleutels", () => {
    expect(BUSINESS_BLOCKS).toHaveLength(9);
    expect(VALUE_BLOCKS).toHaveLength(6);
    const keys = [...BUSINESS_BLOCKS, ...VALUE_BLOCKS].map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
    // Zelfde sleutels als de check-constraint in de migratie.
    expect(BUSINESS_BLOCKS.map((b) => b.key).sort()).toEqual(
      ["key_partners", "key_activities", "key_resources", "value_propositions", "customer_relationships", "channels", "customer_segments", "cost_structure", "revenue_streams"].sort(),
    );
    expect(VALUE_BLOCKS.map((b) => b.key).sort()).toEqual(["customer_jobs", "pains", "gains", "products_services", "pain_relievers", "gain_creators"].sort());
  });
});

describe("validatie", () => {
  it("een nieuwe aanname uit een onderdeel: soort volgt de bouwsteen, tekst 10 tot 400 tekens", () => {
    expect(blockCategory("customer_segments")).toBe("desirability");
    expect(blockCategory("pains")).toBe("desirability");
    expect(blockCategory("key_partners")).toBe("feasibility");
    expect(blockCategory("cost_structure")).toBe("viability");
    expect(validateAssumptionStatement("Te kort").ok).toBe(false);
    expect(validateAssumptionStatement("  Clubs   betalen € 20 per maand ")).toEqual({ ok: true, value: "Clubs betalen € 20 per maand" });
    expect(validateAssumptionStatement("x".repeat(401)).ok).toBe(false);
  });
  it("accepteert een korte tekst en voegt witruimte samen", () => {
    expect(validateItem({ canvas: "business", block: "channels", body: "  Via   de   sportbonden \n" })).toEqual({ ok: true, value: { canvas: "business", block: "channels", body: "Via de sportbonden" } });
  });
  it("weigert een onbekend canvas, een bouwsteen van het andere canvas, lege en te lange tekst", () => {
    expect(validateItem({ canvas: "lean", block: "channels", body: "x y" })).toMatchObject({ ok: false, field: "canvas" });
    expect(validateItem({ canvas: "value", block: "channels", body: "x y" })).toMatchObject({ ok: false, field: "block" });
    expect(validateItem({ canvas: "business", block: "channels", body: "   " })).toMatchObject({ ok: false, field: "body" });
    expect(validateItem({ canvas: "business", block: "channels", body: "x".repeat(501) })).toMatchObject({ ok: false, field: "body" });
    expect(validateItem({ canvas: "business", block: "channels", body: "x".repeat(500) }).ok).toBe(true);
  });
  it("notitie bij een versie mag leeg zijn, maar niet langer dan 1000 tekens", () => {
    expect(validateNote(undefined)).toEqual({ ok: true, value: "" });
    expect(validateNote(" Na besluit bijsturen ")).toEqual({ ok: true, value: "Na besluit bijsturen" });
    expect(validateNote("x".repeat(1001)).ok).toBe(false);
  });
});

describe("volgorde", () => {
  const items = [
    { id: "a", position: 0 },
    { id: "b", position: 1 },
    { id: "c", position: 2 },
  ];
  it("verschuift één plek en geeft alleen de gewijzigde posities", () => {
    expect(moveItem(items, "b", "up")).toEqual([
      { id: "b", position: 0 },
      { id: "a", position: 1 },
    ]);
    expect(moveItem(items, "b", "down")).toEqual([
      { id: "c", position: 1 },
      { id: "b", position: 2 },
    ]);
  });
  it("bovenaan omhoog, onderaan omlaag of een onbekend onderdeel: niets", () => {
    expect(moveItem(items, "a", "up")).toEqual([]);
    expect(moveItem(items, "c", "down")).toEqual([]);
    expect(moveItem(items, "x", "up")).toEqual([]);
  });
  it("hernummert gaten en dubbele posities", () => {
    const messy = [
      { id: "a", position: 5, createdAt: "2026-01-01" },
      { id: "b", position: 5, createdAt: "2026-01-02" },
      { id: "c", position: 9, createdAt: "2026-01-03" },
    ];
    expect(sortByPosition(messy).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(moveItem(messy, "c", "up")).toEqual([
      { id: "a", position: 0 },
      { id: "c", position: 1 },
      { id: "b", position: 2 },
    ]);
    expect(nextPosition(messy)).toBe(10);
    expect(nextPosition([])).toBe(0);
  });
});

describe("bewijsstand per onderdeel", () => {
  it("een open AI-voorstel telt nergens mee, ook niet als er (onterecht) een aanname aan hangt", () => {
    const s = itemStanding({ origin: "ai", accepted: false, assumptionId: "a1" }, assumption("supported", [obs("deposit")]));
    expect(s.group).toBe("proposal");
    expect(s.key).toBe("proposal");
  });
  it("niet gekoppeld of aanname niet gevonden: nog geloof", () => {
    expect(itemStanding({ origin: "manual", accepted: false, assumptionId: null }, null)).toMatchObject({ key: "unlinked", group: "belief" });
    expect(itemStanding(linked, null)).toMatchObject({ key: "unlinked", group: "belief" });
  });
  it("aanname zonder meetellend bewijs: nog geloof; alleen bureauonderzoek: onderbouwd", () => {
    expect(itemStanding(linked, assumption("untested"))).toMatchObject({ key: "belief", group: "belief" });
    expect(itemStanding(linked, assumption("untested", [claim({ fate: "not_counted" })]))).toMatchObject({ key: "belief" });
    expect(itemStanding(linked, assumption("untested", [claim(), claim()]))).toMatchObject({ key: "sourced", group: "sourced", label: "Onderbouwd met bronnen" });
  });
  it("klantbewijs zet het onderdeel op getoetst, met de trede op de bewijsschaal", () => {
    const s = itemStanding(linked, assumption("untested", [claim(), obs("small_action")]));
    expect(s).toMatchObject({ key: "customer", group: "tested", step: "behaviour", label: "Klantbewijs · gedrag" });
    // AI-codering voor half gewicht telt niet voor de trede (zoals de Stand van het bewijs).
    expect(itemStanding(linked, assumption("untested", [obs("deposit", { notes: ["ai_half"] })])).key).toBe("belief");
    // Tegenbewijs alleen tilt het niet naar getoetst, maar staat wel in de toelichting.
    const against = itemStanding(linked, assumption("untested", [claim(), obs("problem", { direction: "contradicts" })]));
    expect(against.key).toBe("sourced");
    expect(against.detail).toContain("tegenbewijs (1)");
  });
  it("uitslag van de hoofdtest gaat voor: ondersteund, weerlegd, onbeslist; lopende test zonder bewijs is nog geloof", () => {
    expect(itemStanding(linked, assumption("supported", [obs("deposit")]))).toMatchObject({ key: "supported", group: "tested", pill: "green", step: "payment" });
    expect(itemStanding(linked, assumption("refuted"))).toMatchObject({ key: "refuted", group: "tested", pill: "coral" });
    expect(itemStanding(linked, assumption("inconclusive"))).toMatchObject({ key: "inconclusive", group: "tested", pill: "orange" });
    expect(itemStanding(linked, assumption("testing"))).toMatchObject({ key: "testing", group: "belief" });
  });
  it("een geaccepteerd AI-voorstel krijgt de stand van zijn aanname, maar blijft als AI-voorstel herkenbaar", () => {
    const item = { origin: "ai", accepted: true, assumptionId: "a1" };
    expect(itemStanding(item, assumption("untested", [claim()])).key).toBe("sourced");
    expect(originLabel(item)).toBe("AI-voorstel, geaccepteerd");
    expect(originLabel({ origin: "ai", accepted: false })).toBe("AI-voorstel · nog niet geaccepteerd");
    expect(originLabel({ origin: "intake", accepted: false })).toBe("Uit de intake");
  });
  it("samenvatting telt per groep, zonder vullingspercentage", () => {
    const s = standingSummary([{ group: "tested" }, { group: "belief" }, { group: "belief" }, { group: "sourced" }, { group: "proposal" }]);
    expect(s).toEqual({ tested: 1, sourced: 1, belief: 2, proposal: 1, total: 5 });
    expect(summaryLine(s)).toBe("4 onderdelen: 1 getoetst, 1 onderbouwd met bronnen, 2 nog geloof · 1 AI-voorstel nog niet geaccepteerd.");
    expect(summaryLine(standingSummary([]))).toBe("Nog geen onderdelen.");
    expect(summaryLine(standingSummary([{ group: "proposal" }, { group: "proposal" }]))).toContain("2 AI-voorstellen wachten");
    expect(summaryLine(s)).not.toMatch(/%/);
  });
});

describe("overnemen uit intake en onderzoek", () => {
  it("maakt voorstellen met bron, slaat lege velden en bezwaren over", () => {
    const drafts = draftsFromSources({
      idea: { target_audience: "Sportclubs", audience_detail: "amateurvoetbal, 200+ leden", description: "Een assistent die clubberichten schrijft.", offer_price: "€ 20 per maand" },
      segments: [{ id: "s1", label: "Bestuurders", role: "buyer", job_to_be_done: "Leden op de hoogte houden", pain: null }],
      signals: [
        { id: "g1", kind: "pain", label: "Geen tijd voor nieuwsbrieven" },
        { id: "g2", kind: "objection", label: "Te duur" },
        { id: "g3", kind: "gain", label: "Meer vrijwilligers" },
      ],
    });
    expect(drafts.map((d) => d.sourceRef)).toEqual(["intake:audience", "intake:description", "intake:offer", "intake:price", "segment:s1", "segment-job:s1", "signal:g1", "signal:g3"]);
    expect(drafts[0]).toEqual({ canvas: "business", block: "customer_segments", body: "Sportclubs — amateurvoetbal, 200+ leden", origin: "intake", sourceRef: "intake:audience" });
    expect(drafts.find((d) => d.sourceRef === "segment:s1")?.body).toBe("Bestuurders (betaler / beslisser)");
    expect(drafts.find((d) => d.sourceRef === "signal:g1")).toMatchObject({ canvas: "value", block: "pains", origin: "research" });
    expect(drafts.find((d) => d.sourceRef === "intake:price")?.body).toBe("Prijs uit de intake: € 20 per maand");
  });
  it("korte lange teksten in tot de maximale lengte en voegt zonder bron niets toe", () => {
    const drafts = draftsFromSources({ idea: { description: "x ".repeat(600) }, segments: [], signals: [] });
    expect(drafts.every((d) => d.body.length <= 500)).toBe(true);
    expect(draftsFromSources({ idea: {}, segments: [], signals: [] })).toEqual([]);
  });
});

describe("versies vergelijken", () => {
  const v1: VersionItem[] = [
    { id: "1", canvas: "business", block: "customer_segments", body: "Sportclubs" },
    { id: "2", canvas: "business", block: "channels", body: "Sportbonden", assumption_id: null },
    { id: "3", canvas: "business", block: "revenue_streams", body: "€ 20 per maand", assumption_id: "a1", assumption_status: "untested" },
    { id: "4", canvas: "value", block: "pains", body: "Geen tijd" },
    { id: "5", canvas: "business", block: "key_partners", body: "KNVB", position: 0 },
  ];
  const v2: VersionItem[] = [
    { id: "1", canvas: "business", block: "customer_segments", body: "Amateurvoetbalclubs" },
    { id: "2", canvas: "business", block: "channels", body: "Sportbonden", assumption_id: "a2" },
    { id: "3", canvas: "business", block: "revenue_streams", body: "€ 20 per maand", assumption_id: "a1", assumption_status: "refuted" },
    { id: "5", canvas: "business", block: "key_partners", body: "KNVB", position: 4 },
    { id: "6", canvas: "business", block: "cost_structure", body: "Hosting" },
    { id: "7", canvas: "business", block: "channels", body: "Instagram", origin: "ai", accepted: false },
  ];
  it("toegevoegd, verwijderd en gewijzigd per bouwsteen, in de volgorde van het canvas", () => {
    const d = diffVersions(v1, v2);
    expect({ added: d.added, removed: d.removed, changed: d.changed }).toEqual({ added: 2, removed: 1, changed: 3 });
    expect(d.blocks.map((b) => b.block.key)).toEqual(["customer_segments", "channels", "revenue_streams", "cost_structure", "pains"]);
    const seg = d.blocks[0].changes[0];
    expect(seg).toMatchObject({ kind: "changed", body: "Amateurvoetbalclubs", before: "Sportclubs", what: ["tekst"] });
    expect(d.blocks[1].changes.map((c) => [c.kind, c.what])).toEqual([
      ["changed", ["aan aanname gekoppeld"]],
      ["added", []],
    ]);
    expect(d.blocks[2].changes[0].what).toEqual(["status van de aanname veranderd"]);
    expect(diffLine(d)).toBe("2 toegevoegd · 1 verwijderd · 3 gewijzigd");
  });
  it("alleen een andere volgorde is geen wijziging; filteren op canvas; verplaatsen en accepteren", () => {
    expect(diffVersions(v1, v1).blocks).toEqual([]);
    expect(diffLine(diffVersions(v1, v1))).toBe("Geen verschillen.");
    expect(diffVersions(v1, v2, "value")).toMatchObject({ removed: 1, added: 0, changed: 0 });
    const moved = diffVersions([{ id: "x", canvas: "business", block: "channels", body: "A" }], [{ id: "x", canvas: "business", block: "customer_relationships", body: "A" }]);
    expect(moved.blocks[0]).toMatchObject({ block: { key: "customer_relationships" } });
    expect(moved.blocks[0].changes[0].what).toEqual(["verplaatst van Kanalen"]);
    const accepted = diffVersions([{ id: "x", canvas: "business", block: "channels", body: "A", origin: "ai", accepted: false }], [{ id: "x", canvas: "business", block: "channels", body: "A", origin: "ai", accepted: true }]);
    expect(accepted.blocks[0].changes[0].what).toEqual(["AI-voorstel geaccepteerd"]);
  });
  it("leest alleen geldige onderdelen uit een opgeslagen versie", () => {
    expect(asVersionItems(null)).toEqual([]);
    expect(asVersionItems([{ id: "1", canvas: "business", block: "channels", body: "A" }, { id: 2 }, { id: "3", canvas: "lean", block: "x", body: "y" }])).toHaveLength(1);
  });
});

describe("rapport", () => {
  const st = (group: "tested" | "belief" | "proposal", label: string) => ({ key: "belief" as const, group, label, pill: "gray", detail: "", step: "exploration" as const, counts: { deskFor: 0, deskAgainst: 0, customerFor: 0, customerAgainst: 0 } });
  it("toont geen open AI-voorstellen maar telt ze; lege bouwstenen en canvassen blijven weg", () => {
    const r = reportCanvas(
      [
        { canvas: "business", block: "channels", body: "B", position: 1, origin: "manual", accepted: false, standing: st("belief", "Nog geloof") },
        { canvas: "business", block: "channels", body: "A", position: 0, origin: "intake", accepted: false, standing: st("tested", "Getoetst · ondersteund") },
        { canvas: "business", block: "pains", body: "AI", position: 0, origin: "ai", accepted: false, standing: st("proposal", "AI-voorstel") },
      ],
      null,
    )!;
    expect(r.openProposals).toBe(1);
    expect(r.canvases).toHaveLength(1);
    expect(r.canvases[0].blocks).toEqual([
      {
        label: "Kanalen",
        items: [
          { body: "A", origin: "Uit de intake", standing: "Getoetst · ondersteund", group: "tested" },
          { body: "B", origin: "Eigen invoer", standing: "Nog geloof", group: "belief" },
        ],
      },
    ]);
    expect(asReportCanvas(r)).toBe(r);
    expect(asReportCanvas({ version: 2 })).toBeNull();
    expect(reportCanvas([], null)).toBeNull();
  });
});

describe("plaats in de app", () => {
  it("/model is een tabblad onder stap 2 Aannames, met notities van die stap", () => {
    expect(stepForPath("/model")).toBe("assumptions");
    expect(STEPS.find((s) => s.key === "assumptions")?.tabs?.map((t) => t.path)).toEqual(["/assumptions", "/model"]);
    // Ook opdrachtgevers zien het tabblad (alleen-lezen).
    expect(STEPS.find((s) => s.key === "assumptions")?.tabs?.some((t) => t.consultantOnly)).toBe(false);
    expect(noteStepForSection("/model")).toBe("assumptions");
  });
});
