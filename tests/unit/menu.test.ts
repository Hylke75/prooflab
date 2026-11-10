import { describe, expect, it } from "vitest";
import { menuItems, STEPS, stepForPath, stepMark } from "@/lib/steps";
import { STEP_LABELS } from "@/lib/domain/dossier-status";

const ID = "00000000-0000-0000-0000-000000000001";

describe("menu (fase 3)", () => {
  it("heeft voor een consultant op een ideepagina hooguit 9 zichtbare items (ideekiezer meegeteld)", () => {
    const { idea, workspace } = menuItems({ ideaId: ID, isConsultant: true });
    expect(idea.map((i) => i.label)).toEqual(["Wat nu?", "Markt", "Aannames", "Testen", "Besluit", "Rapport"]);
    expect(workspace.map((i) => i.label)).toEqual(["Alle ideeën", "Klanten"]);
    expect(1 + idea.length + workspace.length).toBeLessThanOrEqual(9);
  });

  it("heeft geen dubbele namen, iconen of adressen", () => {
    for (const isConsultant of [true, false]) {
      const { idea, workspace } = menuItems({ ideaId: ID, isConsultant });
      const all = [...idea, ...workspace];
      for (const field of ["label", "icon", "href"] as const) {
        const values = all.map((i) => i[field]);
        expect(new Set(values).size, field).toBe(values.length);
      }
    }
  });

  it("gebruikt de iconen uit het plan", () => {
    const { idea, workspace } = menuItems({ ideaId: ID, isConsultant: true });
    expect(Object.fromEntries([...idea, ...workspace].map((i) => [i.label, i.icon]))).toEqual({
      "Wat nu?": "layout-dashboard",
      Markt: "compass",
      Aannames: "layers",
      Testen: "flask",
      Besluit: "scale",
      Rapport: "file",
      "Alle ideeën": "lightbulb",
      Klanten: "users",
    });
  });

  it("toont opdrachtgevers geen overzicht van het idee en geen klanten", () => {
    const { idea, workspace } = menuItems({ ideaId: ID, isConsultant: false });
    expect(idea.map((i) => i.label)).toEqual(["Markt", "Aannames", "Testen", "Besluit", "Rapport"]);
    expect(workspace.map((i) => i.label)).toEqual(["Alle ideeën"]);
  });

  it("toont zonder open idee alleen de werkruimte-items", () => {
    expect(menuItems({ ideaId: null, isConsultant: true }).idea).toEqual([]);
  });

  it("stappenbalk en menu delen namen en nummers met getDossierStatus", () => {
    expect(STEPS.map((s) => s.label)).toEqual([STEP_LABELS.market, STEP_LABELS.assumptions, STEP_LABELS.test, STEP_LABELS.decide]);
    expect(STEPS.map((s) => s.number)).toEqual([1, 2, 3, 4]);
    const stepItems = menuItems({ ideaId: ID, isConsultant: true }).idea.filter((i) => i.step);
    expect(stepItems.map((i) => [i.step, i.label, i.number])).toEqual(STEPS.map((s) => [s.key, s.label, s.number]));
  });

  it("koppelt tabbladen en subpagina's aan hun stap", () => {
    expect(stepForPath("/research")).toBe("market");
    expect(stepForPath("/integrations")).toBe("market");
    // Naslag (Hulp en methode) hoort bij geen stap.
    expect(stepForPath("/method")).toBeNull();
    expect(stepForPath("/hulp")).toBeNull();
    expect(stepForPath("/experiments/catalogus")).toBeNull();
    expect(stepForPath("/experiments/abc")).toBe("test");
    expect(stepForPath("/experiments/abc")).toBe("test");
    expect(stepForPath("/evidence")).toBe("decide");
    expect(stepForPath("/outcome")).toBe("decide");
    expect(stepForPath("/report")).toBeNull();
    expect(stepForPath("")).toBeNull();
  });

  it("markeert klaar met ✓, lopend met • en leeg met niets", () => {
    expect(stepMark("done")?.mark).toBe("✓");
    expect(stepMark("running")?.mark).toBe("•");
    expect(stepMark("empty")).toBeNull();
  });
});
