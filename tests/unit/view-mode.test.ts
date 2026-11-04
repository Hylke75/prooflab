import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { asDetailLevel, cleanDefaultedFields, defaultedLabels, explainShowsText, isShown, parseDetailLevel, visibleCount } from "@/lib/view-mode";
import { Detail, ViewModeProvider } from "@/components/shell/ViewMode";

// Fase 1 · punt 1: Snel en Grondig. De stand is alleen weergave; hier de regels voor wat wel en niet in beeld komt.

describe("stand van een dossier", () => {
  it("alleen 'quick' is Snel; al het andere (ook zonder migratie) is Grondig", () => {
    expect(asDetailLevel("quick")).toBe("quick");
    expect(asDetailLevel("thorough")).toBe("thorough");
    expect(asDetailLevel(undefined)).toBe("thorough");
    expect(asDetailLevel(null)).toBe("thorough");
    expect(asDetailLevel("QUICK")).toBe("thorough");
  });

  it("invoer: alleen de twee bekende waarden", () => {
    expect(parseDetailLevel("quick")).toBe("quick");
    expect(parseDetailLevel("thorough")).toBe("thorough");
    expect(parseDetailLevel("fast")).toBeNull();
    expect(parseDetailLevel("")).toBeNull();
    expect(parseDetailLevel(1)).toBeNull();
  });

  it("only en aantallen", () => {
    expect(isShown("quick", "thorough")).toBe(false);
    expect(isShown("thorough", "thorough")).toBe(true);
    expect(isShown("quick", "quick")).toBe(true);
    expect(isShown("quick")).toBe(true);
    expect(visibleCount("quick", 7, 3)).toBe(3);
    expect(visibleCount("quick", 2, 3)).toBe(2);
    expect(visibleCount("thorough", 7, 3)).toBe(7);
  });

  it("uitleg: in Grondig altijd, in Snel alleen de eerste keer", () => {
    expect(explainShowsText("thorough", false)).toBe(true);
    expect(explainShowsText("quick", true)).toBe(true);
    expect(explainShowsText("quick", false)).toBe(false);
  });

  it("standaardwaarden: alleen bekende velden, vaste volgorde, met labels", () => {
    expect(cleanDefaultedFields("hypotheses", ["channels", "min_sample", "onzin", "min_sample", 3])).toEqual(["min_sample", "channels"]);
    expect(cleanDefaultedFields("assumptions", "prior")).toEqual([]);
    expect(defaultedLabels("assumptions", ["prior"])).toEqual(["Startkans (50%)"]);
    expect(defaultedLabels("interviews", ["recruitment_group"])).toEqual(["Wervingsgroep (afgeleid uit het kanaal)"]);
  });
});

describe("<Detail>", () => {
  const page = (level: "quick" | "thorough", canWrite = true) =>
    renderToStaticMarkup(
      h(ViewModeProvider, {
        level,
        canWrite,
        children: h("div", null, h(Detail, null, h("p", null, "Berekening A")), h("p", null, "Kern"), h(Detail, null, h("p", null, "Berekening B"))),
      }),
    );

  it("Grondig: alles zichtbaar, geen hint", () => {
    const html = page("thorough");
    expect(html).toContain("Berekening A");
    expect(html).toContain("Berekening B");
    expect(html).not.toContain("Meer tonen in Grondig");
  });

  it("Snel: verborgen, met één hint per pagina op de eerste verborgen plek", () => {
    const html = page("quick");
    expect(html).not.toContain("Berekening");
    expect(html).toContain("Kern");
    expect(html.match(/Meer tonen in Grondig/g)).toHaveLength(1);
    expect(html.indexOf("Meer tonen in Grondig")).toBeLessThan(html.indexOf("Kern"));
  });

  it("opdrachtgever: geen knop, wel de stand", () => {
    const html = page("quick", false);
    expect(html).not.toContain("<button");
    expect(html).toContain("Dit dossier staat op Snel");
  });

  it("zonder provider geldt Grondig", () => {
    expect(renderToStaticMarkup(h(Detail, null, h("p", null, "Alles")))).toContain("Alles");
  });
});
