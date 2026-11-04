import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { asDetailLevel, cleanDefaultedFields, defaultedLabels, explainShowsText, isShown, parseDetailLevel, visibleCount } from "@/lib/view-mode";
import { Detail, ViewModeProvider } from "@/components/shell/ViewMode";
import { DetailLevelSwitch } from "@/components/shell/DetailLevelSwitch";
import { Explain } from "@/components/ui/Explain";
import { ReportAppendix } from "@/components/report/ReportAppendix";

describe("rapport: bijlage", () => {
  const page = (level: "quick" | "thorough") =>
    renderToStaticMarkup(h(ViewModeProvider, { level, canWrite: false, children: h(ReportAppendix, { children: h("section", null, "01 / Managementsamenvatting") }) }));

  it("Snel: ingeklapt achter 'Volledig dossier tonen', maar in de pagina (printen is volledig)", () => {
    const html = page("quick");
    expect(html).toContain("Volledig dossier tonen");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/class="report-appendix collapsed"[^>]*>.*01 \/ Managementsamenvatting/);
  });

  it("Grondig: geen knop, het dossier staat er gewoon", () => {
    const html = page("thorough");
    expect(html).not.toContain("Volledig dossier tonen");
    expect(html).toBe("<section>01 / Managementsamenvatting</section>");
  });
});

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

describe("<Explain>", () => {
  const page = (level: "quick" | "thorough") =>
    renderToStaticMarkup(
      h(ViewModeProvider, {
        level,
        canWrite: true,
        children: h(
          "div",
          null,
          h(Explain, { k: "kalibratie", as: "p", term: "Niet gekalibreerd", children: "Uitleg A over kalibratie." }),
          h(Explain, { k: "kalibratie", as: "p", term: "Niet gekalibreerd", children: "Uitleg B over kalibratie." }),
          h(Explain, { k: "ai-drempel", children: "Drempeluitleg." }),
        ),
      }),
    );

  it("Snel: de eerste keer per pagina de uitleg, daarna alleen de term met tooltip", () => {
    const html = page("quick");
    expect(html).toContain("Uitleg A over kalibratie.");
    expect(html).not.toContain("Uitleg B over kalibratie.");
    expect(html).toContain('class="term"');
    expect(html).toContain("Niet gekalibreerd");
    // Een andere term telt los: ook die krijgt de eerste keer de uitleg.
    expect(html).toContain("Drempeluitleg.");
  });

  it("Grondig: overal de uitleg", () => {
    const html = page("thorough");
    expect(html).toContain("Uitleg A over kalibratie.");
    expect(html).toContain("Uitleg B over kalibratie.");
    expect(html).not.toContain('class="term"');
  });
});

describe("schakelaar Snel | Grondig", () => {
  const sw = (level: "quick" | "thorough", canWrite: boolean) => renderToStaticMarkup(h(ViewModeProvider, { level, canWrite, children: h(DetailLevelSwitch) }));

  it("schrijvers: een radiogroep met twee keuzes, de huidige gekozen en als enige in de tabvolgorde", () => {
    const html = sw("quick", true);
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-checked="true" tabindex="0"[^>]*>Snel</);
    expect(html).toMatch(/aria-checked="false" tabindex="-1"[^>]*>Grondig</);
    expect(html).toContain("Weergave van dit dossier");
  });

  it("opdrachtgevers: alleen de stand, geen knoppen", () => {
    const html = sw("thorough", false);
    expect(html).not.toContain("<button");
    expect(html).toContain("Weergave: Grondig");
  });
});
