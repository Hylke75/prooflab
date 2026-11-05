import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { assumptionProbabilityV5 } from "@/lib/domain/evidence";
import { evidenceStanding } from "@/lib/domain/evidence-standing";
import { EvidenceStanding } from "@/components/evidence/EvidenceStanding";
import { EvidenceScale } from "@/components/evidence/EvidenceScale";

// Fase 1, punt 2: het blok Stand van het bewijs zoals het op Overzicht en Besluit staat.
const p = assumptionProbabilityV5(
  [],
  [
    { id: "o1", kind: "opinion", relation: "supports", isSynthetic: false, origin: "manual", sourceKey: "interview:1", sourceLabel: "Interview 1" },
    { id: "o2", kind: "objection", relation: "contradicts", isSynthetic: true, origin: "manual", sourceKey: "interview:2", sourceLabel: "Interview 2" },
  ],
);
const standing = evidenceStanding({
  ideaId: "idee",
  assumptions: [{ id: "a1", statement: "Clubs willen AI-hulp", importance: 5, selectedForTest: true, probability: p, register: p.items, primaryExperimentId: null }],
  tests: [],
  next: { title: "7 interviews (aanname 1)", detail: "Test deze eerst.", href: "/app/ideas/idee/experiments?assumption=a1" },
  calibrated: false,
});

describe("EvidenceStanding (weergave)", () => {
  const html = renderToStaticMarkup(createElement(EvidenceStanding, { standing, ideaId: "idee" }));

  it("één samenvattende regel, de schaal en de details per kritieke aanname", () => {
    expect(html).toContain("Stand van het bewijs");
    expect(html).toContain("Zekerheid: laag · 0 van 1 kritieke aanname getest · sterkste bewijs: uitgesproken intentie (1 persoon) · volgende stap: 7 interviews (aanname 1)");
    expect(html).toContain('data-testid="bewijsschaal"');
    expect(html).toContain("Aanname 1: Clubs willen AI-hulp");
    expect(html).toContain("1 voor · 1 tegen (0 tellen mee)");
    expect(html).toContain("oefengesprek of synthetische data: telt nooit als bewijs");
  });

  it('"niet gekalibreerd" precies één keer, de bandbreedte in de tooltip', () => {
    // Zichtbaar één keer; de schermlezer hoort het label bij de kans zelf (zoals overal, components/ui/Probability).
    const visible = html.replace(/<span class="sr-only">[^<]*<\/span>/g, "");
    expect(visible.match(/niet gekalibreerd/g)).toHaveLength(1);
    expect(html).toMatch(/title="Exacte waarde: [^"]+ · bandbreedte [^"]+"/);
  });

  it("de schaal markeert de huidige trede voor schermlezers", () => {
    const scale = renderToStaticMarkup(createElement(EvidenceScale, { step: "behaviour" }));
    expect(scale).toContain('aria-label="Bewijsschaal: Gedrag, trede 3 van 5"');
    expect(scale.match(/aria-current="step"/g)).toHaveLength(1);
  });
});
