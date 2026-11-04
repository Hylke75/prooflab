import { describe, expect, it } from "vitest";
import {
  audienceFromText,
  breakEvenTarget,
  changedFields,
  deadlineFromText,
  euroAmounts,
  mergeProposals,
  ruleProposal,
  sanitizeAiProposal,
  stakeFromText,
  targetFromText,
  EMPTY_PROPOSAL,
} from "@/lib/intake-proposal";
import { derivePlan } from "@/lib/research-questions";

const TODAY = "2026-11-04";

// Het testdossier "TEST - AI-assistent makelaars", in de drie antwoorden van de nieuwe intake.
const MAKELAARS = {
  idea: "Een AI-assistent voor zelfstandige NVM-kantoren met 2–15 medewerkers die woningteksten en klantmails schrijft, voor € 249 per maand.",
  decision: "Bouwen we de assistent voor € 40.000, ja of nee, vóór 1 maart 2027?",
  uncertainty: "Willen ze € 249 per maand betalen? Makelaars gebruiken nu vaak gratis ChatGPT of hun eigen standaardteksten.",
};

describe("bedragen en inzet", () => {
  it("leest Nederlandse bedragen met en zonder periode", () => {
    expect(euroAmounts("€ 249 per maand en € 40.000 eenmalig")).toEqual([
      { value: 249, period: "maand", index: 0 },
      expect.objectContaining({ value: 40000, period: null }),
    ]);
    expect(euroAmounts("25 duizend euro")[0].value).toBe(25000);
    expect(euroAmounts("€ 1,5 miljoen")[0].value).toBe(1_500_000);
    expect(euroAmounts("€40k")[0].value).toBe(40000);
  });

  it("de inzet is het bedrag zonder periode, of uren of fte", () => {
    expect(stakeFromText(MAKELAARS.decision)).toEqual({ kind: "amount", value: 40000 });
    expect(stakeFromText("Zetten we 120 uur in op een pilot, vóór 1 maart?")).toEqual({ kind: "time", value: 120 });
    expect(stakeFromText("Maken we 1,5 fte vrij voor dit product?")).toEqual({ kind: "capacity", value: 1.5 });
    expect(stakeFromText("Gaan we door met dit idee?")).toBeNull();
  });
});

describe("beslisdatum uit de tekst", () => {
  it("herkent dag en maand, met en zonder jaartal (eerstvolgende keer)", () => {
    expect(deadlineFromText("vóór 1 maart 2027", TODAY)).toBe("2027-03-01");
    expect(deadlineFromText("uiterlijk 1 maart", TODAY)).toBe("2027-03-01");
    expect(deadlineFromText("voor 20 november", TODAY)).toBe("2026-11-20");
    expect(deadlineFromText("op 15-12-2026", TODAY)).toBe("2026-12-15");
    expect(deadlineFromText("op 2027-01-31", TODAY)).toBe("2027-01-31");
  });

  it("herkent eind van een maand, een kwartaal en een termijn", () => {
    expect(deadlineFromText("eind januari", TODAY)).toBe("2027-01-31");
    expect(deadlineFromText("in Q1 2027", TODAY)).toBe("2027-03-31");
    expect(deadlineFromText("in het eerste kwartaal", TODAY)).toBe("2027-03-31");
    expect(deadlineFromText("binnen 6 weken", TODAY)).toBe("2026-12-16");
    // Systeemcontrole: een eerder genoemde periode is niet de beslisdatum.
    expect(deadlineFromText("Bouwen we de cursus in Q1 voor € 15.000, of niet? Beslissen vóór 1 maart.", TODAY)).toBe("2027-03-01");
    expect(deadlineFromText("Lanceren we in Q1 2027? Uiterlijk 15 december besluiten.", TODAY)).toBe("2026-12-15");
    expect(deadlineFromText("Starten we in Q1 2027 of niet?", TODAY)).toBe("2027-03-31");
    expect(deadlineFromText("voor het einde van het jaar", TODAY)).toBe("2026-12-31");
  });

  it("geen datum of een datum in het verleden: leeg", () => {
    expect(deadlineFromText("zo snel mogelijk", TODAY)).toBeNull();
    expect(deadlineFromText("vóór 1 maart 2025", TODAY)).toBeNull();
    expect(deadlineFromText("op 31-02-2027", TODAY)).toBeNull();
  });
});

describe("doelgroep en doelwaarde", () => {
  it("de specifieke doelgroep staat na 'voor', tot de bijzin", () => {
    expect(audienceFromText(MAKELAARS.idea)).toBe("zelfstandige NVM-kantoren met 2–15 medewerkers");
    expect(audienceFromText("Een app voor € 5 per maand voor ouders van jonge kinderen.")).toBe("ouders van jonge kinderen");
    expect(audienceFromText("Een slimme planner.")).toBeNull();
  });

  it("een bandbreedte van medewerkers is geen doel; een aantal klanten wel", () => {
    expect(targetFromText("kantoren met 2–15 medewerkers")).toBeNull();
    expect(targetFromText("minstens 20 makelaarskantoren betalen")).toEqual({ target: 20, noun: "makelaarskantoren" });
    expect(targetFromText("15 betalende klanten")).toEqual({ target: 15, noun: "klanten" });
  });

  it("zonder genoemd aantal: terugverdienen van de inzet binnen een jaar", () => {
    expect(breakEvenTarget({ kind: "amount", value: 40000 }, "€ 249 per maand")).toEqual({ target: 14, basis: expect.stringContaining("binnen een jaar") });
    expect(breakEvenTarget({ kind: "time", value: 120 }, "€ 249 per maand")).toBeNull();
    expect(breakEvenTarget({ kind: "amount", value: 40000 }, null)).toBeNull();
  });
});

describe("regelvoorstel voor het testdossier (zonder AI)", () => {
  const r = ruleProposal(MAKELAARS, TODAY);

  it("vult alle velden die de rest van de app leest, zonder iets dubbel te vragen", () => {
    expect(r.source).toBe("rules");
    expect(r.proposal).toMatchObject({
      title: "AI-assistent voor NVM-kantoren",
      stake_kind: "amount",
      stake_value: 40000,
      decision_deadline: "2027-03-01",
      offer_price: "€ 249 per maand",
      outcome_min_value_per_customer: 249,
      outcome_metric: "betalende NVM-kantoren",
      outcome_target: 14,
      target_audience: "Zakelijke klanten (B2B)",
      audience_detail: "zelfstandige NVM-kantoren met 2–15 medewerkers",
      region: "Nederland",
      sector_template: "smb",
      project_type: "new_product",
      sprint_weeks: 5,
    });
    expect(r.proposal.outcome_statement).toBe("Zes maanden na het besluit betalen minstens 14 NVM-kantoren € 249 per maand.");
    expect(r.proposal.target_basis).toMatch(/€ 40\.000/);
    expect(r.origin.stake_value).toBe("text");
    expect(r.origin.sprint_weeks).toBe("default");
  });

  it("voedt de vraagafleiding van B2: specifieke doelgroep en de prijs als beslissende vraag", () => {
    const plan = derivePlan({
      title: r.proposal.title!,
      description: MAKELAARS.idea,
      decision_question: MAKELAARS.decision,
      target_audience: r.proposal.target_audience!,
      audience_detail: r.proposal.audience_detail,
      region: r.proposal.region!,
      region_detail: r.proposal.region_detail,
      project_type: r.proposal.project_type!,
      sector_template: r.proposal.sector_template!,
      key_uncertainty: MAKELAARS.uncertainty,
      outcome_min_value_per_customer: r.proposal.outcome_min_value_per_customer,
      offer_price: r.proposal.offer_price,
    });
    const decisive = plan.questions[plan.decisiveIndex];
    expect(decisive.question).toContain("€ 249 per maand");
    expect(decisive.question).toContain("NVM-kantoren");
  });

  it("met weinig tekst blijven onbekende velden leeg (de consultant vult ze in)", () => {
    const thin = ruleProposal({ idea: "Een slimme planner.", decision: "Gaan we hiermee door?", uncertainty: "Of het werkt." }, TODAY);
    expect(thin.proposal.stake_value).toBeNull();
    expect(thin.proposal.decision_deadline).toBeNull();
    expect(thin.proposal.outcome_target).toBeNull();
    expect(thin.proposal.outcome_statement).toBeNull();
    expect(thin.proposal.region).toBeNull();
    expect(thin.proposal.sprint_weeks).toBe(5);
  });

  it("een korte deadline geeft een korte sprint", () => {
    expect(ruleProposal({ ...MAKELAARS, decision: "Bouwen we dit voor € 40.000, binnen 3 weken?" }, TODAY).proposal.sprint_weeks).toBe(4);
  });
});

describe("AI-voorstel controleren en samenvoegen", () => {
  it("laat ongeldige waarden weg", () => {
    const s = sanitizeAiProposal(
      { title: "X", stake_kind: "geld", stake_value: -5, decision_deadline: "2020-01-01", region: "Mars", sprint_weeks: 9, outcome_target: 12, project_type: "new_product" },
      TODAY,
    );
    expect(s).toMatchObject({ title: null, stake_kind: null, stake_value: null, decision_deadline: null, region: null, sprint_weeks: null, outcome_target: 12, project_type: "new_product" });
  });

  it("wat letterlijk in de tekst staat wint van de AI; de rest neemt de AI over", () => {
    const rules = ruleProposal(MAKELAARS, TODAY);
    const ai = { ...EMPTY_PROPOSAL, stake_kind: "amount" as const, stake_value: 50000, offer_price: "€ 199 per maand", title: "Makelaarsassistent", outcome_target: 20, target_basis: "Twintig kantoren", outcome_statement: null };
    const m = mergeProposals(rules, ai);
    expect(m.source).toBe("ai");
    expect(m.proposal.stake_value).toBe(40000);
    expect(m.proposal.offer_price).toBe("€ 249 per maand");
    expect(m.proposal.title).toBe("Makelaarsassistent");
    expect(m.origin.title).toBe("ai");
    expect(m.proposal.outcome_target).toBe(20);
    expect(m.proposal.target_basis).toBe("Twintig kantoren");
    // De regelzin blijft staan; de AI gaf geen zin.
    expect(m.proposal.outcome_statement).toContain("14");
  });

  it("telt welke velden de consultant aanpaste", () => {
    const { proposal } = ruleProposal(MAKELAARS, TODAY);
    expect(changedFields(proposal, { title: "TEST - AI-assistent makelaars", stake_value: "40000", region: "Nederland" })).toEqual(["title"]);
  });
});
