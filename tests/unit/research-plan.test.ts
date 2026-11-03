import { describe, expect, it } from "vitest";
import { EXPECTED_SOURCES, splitCompoundQuestions, splitQuestion, templatePlan } from "@/lib/domain/research-plan";
import { PROJECT_TYPES, SECTOR_TEMPLATES, type ProjectType, type SectorTemplate } from "@/lib/domain/labels";

// Onderzoekskaart: het sjabloon vult doelgroep, regio en branche in (geen plaatshouders), elke vraag heeft een
// meeteenheid en een verwacht brontype, en samengestelde vragen worden gesplitst tot hooguit vijf.

const PLACEHOLDERS = [/gekozen gebied/i, /\bde doelgroep\b/i, /deze klanten/i, /\{|\}/, /\$\{/, /undefined|null/, /\bX\b/, /\[.*\]/];

describe("sjabloon voor de onderzoekskaart", () => {
  it("vult doelgroep, regio en branche in en laat nooit plaatshouders over", () => {
    for (const t of Object.keys(PROJECT_TYPES) as ProjectType[]) {
      for (const s of Object.keys(SECTOR_TEMPLATES) as SectorTemplate[]) {
        const plan = templatePlan(t, s, { audience: "zelfstandige fysiotherapeuten", region: "Utrecht" });
        expect(plan.length).toBeGreaterThanOrEqual(3);
        expect(plan.length).toBeLessThanOrEqual(5);
        for (const q of plan) {
          const all = [q.question, q.why_it_matters, q.data_needed, q.suggested_sources, q.done_criterion, q.unit].join(" | ");
          for (const p of PLACEHOLDERS) expect(all, `${t}/${s}: ${all}`).not.toMatch(p);
          expect(q.unit.length).toBeGreaterThan(3);
          expect(Object.keys(EXPECTED_SOURCES)).toContain(q.expected_source);
          // Enkelvoudig: precies één vraagteken, aan het eind.
          expect(q.question.match(/\?/g)).toHaveLength(1);
          expect(q.question.endsWith("?")).toBe(true);
          expect(splitQuestion(q.question)).toEqual([q.question]);
        }
        expect(plan.some((q) => q.question.includes("zelfstandige fysiotherapeuten"))).toBe(true);
        expect(plan.some((q) => q.question.includes("Utrecht"))).toBe(true);
      }
    }
  });

  it("noemt de branche in de vraag naar de omvang, behalve bij het algemene sjabloon", () => {
    const events = templatePlan("new_business", "events", { audience: "eventbureaus", region: "Nederland" });
    expect(events[0].question).toBe(`Hoeveel eventbureaus zijn er in Nederland in de branche ${SECTOR_TEMPLATES.events}?`);
    expect(events[0].expected_source).toBe("official_statistic");
    const generic = templatePlan("new_business", "generic", { audience: "eventbureaus", region: "Nederland" });
    expect(generic[0].question).toBe("Hoeveel eventbureaus zijn er in Nederland?");
  });
});

describe("samengestelde vragen splitsen", () => {
  it("splitst op 'en'/'of' tussen twee deelvragen en op meerdere vraagtekens", () => {
    expect(splitQuestion("Hoeveel bureaus zijn er in Nederland en wat betalen ze nu per jaar?")).toEqual([
      "Hoeveel bureaus zijn er in Nederland?",
      "Wat betalen ze nu per jaar?",
    ]);
    expect(splitQuestion("Hoe groot is de markt? Welke partijen zijn actief?")).toEqual(["Hoe groot is de markt?", "Welke partijen zijn actief?"]);
    expect(splitQuestion("Kiezen klanten een abonnement of willen ze per gebruik betalen?")).toEqual(["Kiezen klanten een abonnement?", "Willen ze per gebruik betalen?"]);
  });

  it("laat gewone 'en'/'of' staan en laat een inhoudsloos staartje weg", () => {
    expect(splitQuestion("Hoeveel bureaus en zalen zijn er in Utrecht?")).toEqual(["Hoeveel bureaus en zalen zijn er in Utrecht?"]);
    expect(splitQuestion("Kopen bureaus wel of niet online in?")).toEqual(["Kopen bureaus wel of niet online in?"]);
    expect(splitQuestion("Welk prijsmodel accepteert de doelgroep, en waarom?")).toEqual(["Welk prijsmodel accepteert de doelgroep?"]);
  });

  it("houdt hooguit vijf vragen over, met voorrang voor het eerste deel van elke vraag", () => {
    const qs = ["A1 is een vraag en wat is A2 precies?", "B1 is een vraag?", "C1 is een vraag en hoe zit C2 dan?", "D1 is een vraag?", "E1 is een vraag?"].map((question) => ({ question }));
    const out = splitCompoundQuestions(qs, 5).map((q) => q.question);
    expect(out).toEqual(["A1 is een vraag?", "B1 is een vraag?", "C1 is een vraag?", "D1 is een vraag?", "E1 is een vraag?"]);
    const two = splitCompoundQuestions([{ question: "Hoeveel bureaus zijn er en wat betalen ze?", unit: "x" }], 5);
    expect(two).toEqual([
      { question: "Hoeveel bureaus zijn er?", unit: "x" },
      { question: "Wat betalen ze?", unit: "x" },
    ]);
  });
});
