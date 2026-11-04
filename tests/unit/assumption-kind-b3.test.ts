import { describe, expect, it } from "vitest";
import { assumptionKind, ASSUMPTION_KINDS, metricFitsAssumption } from "@/lib/domain/assumption-kind";
import { DESK_CHECK_TEST, OUTREACH_TEST, testsForKind, valueOfInformation } from "@/lib/domain/recommend";
import { EXPERIMENT_TYPES } from "@/lib/domain/labels";

// Gebruikerstest B3: twee nieuwe soorten aannames (kanaal, regelgeving/context), met de zinnen uit het dossier
// "AI-communicatie voor sportclubs".

const k = (statement: string, category = "desirability") => assumptionKind({ statement, category });

describe("assumptionKind: kanaal en regelgeving", () => {
  it.each([
    ["Eerste versie te bouwen binnen € 15.000 en 2 maanden", "technical"],
    ["Clubs zijn te bereiken via een schaalbaar kanaal (bonden, softwareleveranciers) tegen acceptabele kosten per club", "channel"],
    ["De dienst is AVG-conform en clubs vertrouwen ons met ledengegevens", "regulation"],
    // Regressie: betalen blijft prijs.
    ["Makelaars betalen € 249 per maand", "price"],
    ["Makelaars betalen € 49 per maand extra voor de koppeling met Realworks", "price"],
  ])("%s → %s", (statement, kind) => {
    expect(k(statement)).toBe(kind);
  });

  it("de categorie is de terugval als de tekst niets zegt", () => {
    expect(k("Het plan werkt", "feasibility")).toBe("technical");
    expect(k("Het plan werkt", "context")).toBe("regulation");
    expect(k("Het plan werkt", "viability")).toBe("market");
  });

  it("labels in gewone taal", () => {
    expect(ASSUMPTION_KINDS.channel.label).toBe("kanaal");
    expect(ASSUMPTION_KINDS.regulation.label).toBe("regelgeving/context");
  });
});

describe("passende test per soort", () => {
  it("kanaal: outreach-proef en een landingpage per kanaal", () => {
    expect(testsForKind("channel", false).map((t) => t.type)).toEqual(["outreach", "landing"]);
    expect(OUTREACH_TEST.external).toBe(true);
  });
  it("regelgeving: bureauonderzoek of juridische check buiten ProofLab", () => {
    expect(testsForKind("regulation", false)).toEqual([DESK_CHECK_TEST]);
    expect(DESK_CHECK_TEST.external).toBe(true);
  });
  it("geen nieuwe testtypes in ProofLab zelf", () => {
    expect(Object.keys(EXPERIMENT_TYPES).sort()).toEqual(["interview", "landing", "pricing", "survey"]);
  });
  it("de rangorde stelt bij een AVG-aanname de juridische check voor", () => {
    const v = valueOfInformation({ id: "a", statement: "De dienst is AVG-conform", importance: 5, probability: 0.4, category: "context", evidence: 0, hasDiscoveryEvidence: false });
    expect(v.kind).toBe("regulation");
    expect(v.test.type).toBe("desk_check");
  });
});

describe("metricFitsAssumption: kanaal en regelgeving", () => {
  const m = (type: string) => ({ type, metric_label: "Aanvraag", metric_numerator: "bezoekers die een aanvraag doen" });
  it("kanaal: geen prijstest, wel een landingpage of interview", () => {
    expect(metricFitsAssumption("channel", m("pricing")).ok).toBe(false);
    expect(metricFitsAssumption("channel", m("landing")).ok).toBe(true);
    expect(metricFitsAssumption("channel", m("interview")).ok).toBe(true);
  });
  it("regelgeving: geen landingpage of prijstest; vertrouwen uitvragen in een interview of enquête mag", () => {
    expect(metricFitsAssumption("regulation", m("landing")).ok).toBe(false);
    expect(metricFitsAssumption("regulation", m("pricing")).reason).toMatch(/juridische check/);
    expect(metricFitsAssumption("regulation", m("interview")).ok).toBe(true);
    expect(metricFitsAssumption("regulation", m("survey")).ok).toBe(true);
  });
});
