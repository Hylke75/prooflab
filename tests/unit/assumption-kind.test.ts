import { describe, expect, it } from "vitest";
import { assumptionKind, interviewGuideFor, metricFitsAssumption, PRICE_INTERVIEW_QUESTIONS } from "@/lib/domain/assumption-kind";
import { NEUTRAL_INTERVIEW_GUIDE } from "@/lib/domain/labels";
import { TEMPLATE_ASSUMPTIONS } from "@/lib/domain/recommend";
import { auditGuide, guideSummary } from "@/lib/domain/interview-audit";

const k = (statement: string, kind: string | null = null, category = "desirability") => assumptionKind({ kind, statement, category });

describe("assumptionKind (B0 punt 3)", () => {
  it("leidt een prijsaanname af uit de tekst", () => {
    expect(k("Makelaars willen € 249 per maand betalen")).toBe("price");
    expect(k("Klanten zijn bereid een prijs te betalen die het model rendabel maakt.")).toBe("price");
    expect(k("Kantoren hebben budget voor een abonnement")).toBe("price");
    expect(k("De willingness to pay ligt boven de kostprijs")).toBe("price");
    expect(k("Het tarief per woning is acceptabel")).toBe("price");
  });
  it("leidt een technische aanname af", () => {
    expect(k("De koppeling met Realworks is te bouwen")).toBe("technical");
    expect(k("De integratie met het CRM-systeem werkt binnen twee weken")).toBe("technical");
    expect(k("We kunnen de oplossing leveren met de beschikbare mensen, data en techniek.")).toBe("technical");
  });
  it("leidt een gedragsaanname af", () => {
    expect(k("Makelaars gebruiken de assistent wekelijks")).toBe("behaviour");
    expect(k("De doelgroep wil overstappen van de huidige werkwijze naar onze oplossing.")).toBe("behaviour");
  });
  it("valt anders terug op markt", () => {
    expect(k("Er zijn in Nederland genoeg zelfstandige makelaarskantoren")).toBe("market");
    // Wervingskosten gaan over bereik, niet over wat de klant betaalt.
    expect(k("We kunnen klanten bereiken tegen acceptabele wervingskosten.")).toBe("market");
  });
  it("prijs gaat voor techniek", () => {
    expect(k("Makelaars betalen € 49 per maand extra voor de koppeling met Realworks")).toBe("price");
  });
  it("gebruikt het vastgelegde veld als dat gezet is", () => {
    expect(k("Makelaars willen € 249 per maand betalen", "market")).toBe("market");
    expect(k("Er zijn genoeg kantoren", "technical")).toBe("technical");
    // Een onbekende waarde telt als niet gezet.
    expect(k("Makelaars willen € 249 per maand betalen", "onzin")).toBe("price");
  });
});

describe("metricFitsAssumption (B0 punt 3)", () => {
  const landing = { type: "landing", metric_label: "Demo-aanvraag", metric_numerator: "unieke bezoekers die een demo aanvragen" };
  it("prijsaanname met een landingpage die demo-aanvragen meet: niet goed, stel een prijstest voor", () => {
    const r = metricFitsAssumption("price", landing);
    expect(r.ok).toBe(false);
    expect(r.suggestedType).toBe("pricing");
    expect(r.reason).toContain("Deze aanname gaat over betalen");
    expect(r.reason).toContain("Demo-aanvraag");
    expect(r.reason).toContain("geen geld of toezegging");
  });
  it("prijsaanname met een interview over herkend probleem: niet goed", () => {
    const r = metricFitsAssumption("price", { type: "interview", metric_label: "Probleem herkend in eigen recent gedrag", metric_numerator: "geïnterviewden die het probleem beschrijven" });
    expect(r.ok).toBe(false);
    expect(r.suggestedType).toBe("pricing");
  });
  it("prijsaanname met een prijstest: goed", () => {
    expect(metricFitsAssumption("price", { type: "pricing", metric_label: "Kiest een aanbod", metric_numerator: "bezoekers" }).ok).toBe(true);
  });
  it("prijsaanname met een maatstaf over geld of toezegging: goed", () => {
    for (const label of ["Betaalt een aanbetaling", "Getekende intentieverklaring", "Toezegging van de directie", "Pre-order geplaatst", "Offerte getekend", "Budget vrijgemaakt", "Abonnement afgesloten", "Kiest het pakket van € 249"]) {
      expect(metricFitsAssumption("price", { type: "interview", metric_label: label, metric_numerator: "geïnterviewden" }).ok, label).toBe(true);
    }
    // Ook als alleen de teller over geld gaat.
    expect(metricFitsAssumption("price", { type: "landing", metric_label: "Conversie", metric_numerator: "bezoekers die een betaling doen" }).ok).toBe(true);
  });
  it("prijsaanname met de aantalregel (aanbetaling of herhaalaankoop): goed", () => {
    expect(metricFitsAssumption("price", { type: "interview", metric_label: "Sterke handeling", metric_numerator: "geïnterviewden", decision_rule: "absolute" }).ok).toBe(true);
  });
  it("technische aanname: geen klanttest, geen voorgesteld testtype", () => {
    for (const type of ["interview", "survey", "landing", "pricing"]) {
      const r = metricFitsAssumption("technical", { type, metric_label: "Iets", metric_numerator: "iets" });
      expect(r.ok, type).toBe(false);
      expect(r.suggestedType).toBeUndefined();
      expect(r.reason).toMatch(/technische proef of prototype buiten ProofLab/);
    }
  });
  it("markt en gedrag: elke maatstaf past", () => {
    expect(metricFitsAssumption("market", landing).ok).toBe(true);
    expect(metricFitsAssumption("behaviour", landing).ok).toBe(true);
  });
});

describe("interviewleidraad bij een prijsaanname", () => {
  it("bevat vragen over huidige uitgaven en budget", () => {
    const g = interviewGuideFor("price", NEUTRAL_INTERVIEW_GUIDE);
    expect(g).toEqual([...NEUTRAL_INTERVIEW_GUIDE, ...PRICE_INTERVIEW_QUESTIONS]);
    expect(g.join(" ")).toMatch(/per maand uit/);
    expect(g.join(" ")).toMatch(/budget/);
    expect(g.length).toBeLessThanOrEqual(15);
  });
  it("de extra vragen zijn niet hypothetisch, sturend of dubbel (leidraadcontrole)", () => {
    const audit = auditGuide([...PRICE_INTERVIEW_QUESTIONS]);
    expect(guideSummary(audit).flagged).toBe(0);
  });
  it("andere soorten houden de neutrale leidraad", () => {
    expect(interviewGuideFor("market", NEUTRAL_INTERVIEW_GUIDE)).toEqual([...NEUTRAL_INTERVIEW_GUIDE]);
  });
  it("de standaardaannames krijgen een soort", () => {
    expect(TEMPLATE_ASSUMPTIONS.map((a) => assumptionKind(a))).toEqual(["behaviour", "behaviour", "price", "market", "technical", "market"]);
  });
});
