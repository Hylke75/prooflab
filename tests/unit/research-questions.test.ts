import { describe, expect, it } from "vitest";
import { splitQuestion } from "@/lib/domain/research-plan";
import {
  decisiveFirst,
  decisiveQuestionFor,
  derivePlan,
  isGenericTemplate,
  pickDecisiveIndex,
  priceFromIntake,
  questionTopic,
  specificAudience,
  uncertaintyTopic,
  type IntakeFacts,
} from "@/lib/research-questions";

// Fase B2, punt 1: de onderzoeksvragen komen uit de intake (specifieke doelgroep, aanbod, prijs, grootste
// onzekerheid) en één vraag is de beslissende vraag.

const MAKELAAR: IntakeFacts = {
  title: "Makelaarsassistent",
  description: "Een AI-assistent die makelaars helpt woningteksten en bezichtigingsverslagen te maken.",
  decision_question: "Investeren we € 40.000 in een eerste versie voor makelaars?",
  target_audience: "Zakelijke klanten (B2B)",
  audience_detail: "zelfstandige NVM-kantoren met 2–15 medewerkers",
  region: "Nederland",
  region_detail: null,
  project_type: "new_product",
  sector_template: "smb",
  key_uncertainty: "Willen ze € 249 per maand betalen?",
  outcome_min_value_per_customer: 2988,
};

describe("afleiden uit de intake", () => {
  it("gebruikt de specifieke doelgroep, niet de brede categorie", () => {
    expect(specificAudience(MAKELAAR)).toBe("zelfstandige NVM-kantoren");
    const plan = derivePlan(MAKELAAR);
    expect(plan.questions).toHaveLength(5);
    for (const q of plan.questions) expect(q.question).not.toMatch(/Zakelijke klanten \(B2B\)/);
    expect(plan.questions.filter((q) => q.question.includes("NVM-kantoren")).length).toBeGreaterThanOrEqual(4);
  });

  it("haalt de genoemde prijs uit de onzekerheid", () => {
    expect(priceFromIntake(MAKELAAR)).toBe("€ 249 per maand");
    expect(priceFromIntake({ key_uncertainty: "of kantoren 1.250 euro per jaar willen betalen", description: null })).toBe("€ 1.250 per jaar");
    expect(priceFromIntake({ key_uncertainty: "betalen ze €99/mnd?", description: null })).toBe("€ 99 per maand");
    // Zonder genoemd bedrag: de minimale waarde per klant uit de uitkomstdefinitie.
    expect(priceFromIntake({ key_uncertainty: "of ze willen betalen", description: null, outcome_min_value_per_customer: 1500 })).toBe("€ 1.500 per klant");
    expect(priceFromIntake({ key_uncertainty: null, description: null })).toBeNull();
  });

  it("maakt de prijsvraag met doelgroep, aanbod en prijs de beslissende vraag", () => {
    const q = decisiveQuestionFor(MAKELAAR);
    expect(q.question).toBe("Willen zelfstandige NVM-kantoren in Nederland € 249 per maand betalen voor Makelaarsassistent?");
    expect(q.expected_source).toBe("pricing_page");
    expect(q.unit).toBe("euro per klant per maand");
    expect(q.data_needed).toMatch(/gratis alternatieven/);
    expect(splitQuestion(q.question)).toEqual([q.question]);
    const plan = derivePlan(MAKELAAR);
    expect(plan.questions[plan.decisiveIndex]).toEqual(q);
    // De sjabloonvraag over prijs is vervangen, niet verdubbeld.
    expect(plan.questions.filter((x) => questionTopic(x) === "pricing")).toHaveLength(1);
  });

  it("vraagt zonder genoemde prijs wat de doelgroep wil betalen", () => {
    const q = decisiveQuestionFor({ ...MAKELAAR, key_uncertainty: "of ze hiervoor willen betalen", outcome_min_value_per_customer: null });
    expect(q.question).toBe("Hoeveel willen zelfstandige NVM-kantoren in Nederland betalen voor Makelaarsassistent?");
  });

  it("herkent het onderwerp van de onzekerheid", () => {
    expect(uncertaintyTopic("Willen ze € 249 betalen?")).toBe("pricing");
    expect(uncertaintyTopic("of er al gratis alternatieven zijn")).toBe("alternatives");
    expect(uncertaintyTopic("of eventmanagers dit probleem echt hebben")).toBe("problem");
    expect(uncertaintyTopic("hoeveel kantoren zijn er")).toBe("size");
    expect(uncertaintyTopic("hoe we ze bereiken")).toBe("channels");
    expect(uncertaintyTopic("")).toBe("other");
  });

  it("valt zonder herkend onderwerp terug op de laatste sjabloonvraag en houdt de vraag enkelvoudig", () => {
    const plan = derivePlan({ ...MAKELAAR, key_uncertainty: "Of de wetgeving rond AVG het toelaat" });
    expect(plan.decisiveIndex).toBe(4);
    const q = plan.questions[4].question;
    expect(q).toMatch(/AVG/);
    expect(q.match(/\?/g)).toHaveLength(1);
  });

  it("kiest uit bestaande vragen de vraag die de onzekerheid raakt, met voorkeur voor de genoemde prijs", () => {
    const qs = [
      { question: "Hoeveel NVM-kantoren zijn er?", expected_source: "official_statistic" },
      { question: "Wat betalen kantoren nu voor software?", expected_source: "pricing_page" },
      { question: "Willen kantoren € 249 per maand betalen?", expected_source: "customer_research" },
    ];
    expect(pickDecisiveIndex(qs, MAKELAAR)).toBe(2);
    expect(pickDecisiveIndex(qs.slice(0, 2), MAKELAAR)).toBe(1);
    expect(pickDecisiveIndex(qs.slice(0, 1), MAKELAAR)).toBe(-1);
  });

  it("herkent een sjabloonvraag met de brede doelgroep", () => {
    expect(isGenericTemplate({ question: "Hoeveel Zakelijke klanten (B2B) zijn er in Nederland?", origin: "template" }, MAKELAAR)).toBe(true);
    expect(isGenericTemplate({ question: "Hoeveel zelfstandige NVM-kantoren met 2–15 medewerkers zijn er in Nederland?", origin: "template" }, MAKELAAR)).toBe(false);
    expect(isGenericTemplate({ question: "Hoeveel Zakelijke klanten (B2B) zijn er?", origin: "manual" }, MAKELAAR)).toBe(false);
  });
});

describe("onderzoeksvolgorde", () => {
  it("zet de beslissende vraag vooraan, de rest op positie", () => {
    const qs = [
      { id: "a", position: 1 },
      { id: "b", position: 2 },
      { id: "c", position: 4, is_decisive: true },
      { id: "d", position: 3 },
    ];
    expect(decisiveFirst(qs).map((q) => q.id)).toEqual(["c", "a", "b", "d"]);
    // Zonder markering (of vóór de migratie): op positie.
    expect(decisiveFirst(qs.map(({ id, position }) => ({ id, position }))).map((q) => q.id)).toEqual(["a", "b", "d", "c"]);
  });
});
