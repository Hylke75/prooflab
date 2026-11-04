import { describe, expect, it } from "vitest";
import { annualPriceFromOffer, currentPracticeFromText, mergeProposals, ruleProposal, sanitizeAiProposal, sectorFromText, statusQuoPositioning, EMPTY_PROPOSAL } from "@/lib/intake-proposal";
import { computeSizing } from "@/lib/domain/sizing";
import { reachableRevenue } from "@/lib/report-sheet";
import { sectorFitsAudience, templatePlan } from "@/lib/domain/research-plan";
import { derivePlan, isGenericTemplate, shortAudience, specificAudience } from "@/lib/research-questions";
import { newProposals, proposalAdoptionProblem, withoutProposals } from "@/lib/domain/competitor-proposals";
import { SECTOR_TEMPLATES } from "@/lib/domain/labels";

// Gebruikerstest groep D: markt en intake (D5–D8).

describe("D5: intakeprijs als jaaromzet per klant", () => {
  it("rekent de periode om naar een jaar", () => {
    expect(annualPriceFromOffer("€ 79 per maand")).toEqual({ value: 948, note: "Aanname uit intake: € 79 per maand × 12, niet getoetst" });
    expect(annualPriceFromOffer("€ 300 per kwartaal")?.value).toBe(1200);
    expect(annualPriceFromOffer("€ 10 per week")?.value).toBe(520);
    expect(annualPriceFromOffer("€ 1.200 per jaar")).toEqual({ value: 1200, note: "Aanname uit intake: € 1.200 per jaar, niet getoetst" });
  });

  it("zonder bedrag of periode: geen aanname", () => {
    expect(annualPriceFromOffer(null)).toBeNull();
    expect(annualPriceFromOffer("€ 79")).toBeNull();
    expect(annualPriceFromOffer("gratis")).toBeNull();
  });

  const factors = (base: number, revenue: number) => [
    { key: "base_count", value: base, claimStatus: "verified" as const, claimValue: base },
    { key: "fit_pct", value: 20 },
    { key: "reach_pct", value: 50 },
    { key: "winnable_pct", value: 3 },
    { key: "revenue_per_customer", value: revenue },
  ];

  it("de formule toont de overgenomen prijs: € 948", () => {
    const r = computeSizing("b2b_accounts", factors(2000, annualPriceFromOffer("€ 79 per maand")!.value));
    expect(r.formula).toContain("€ 948");
    expect(r.missing).toEqual([]);
  });

  it("een factor op 0 is onbekend: in de formule en als uitkomst niet vastgesteld", () => {
    const r = computeSizing("b2b_accounts", [{ key: "base_count", value: 0 }, ...factors(0, 948).slice(1)]);
    expect(r.formula.startsWith("onbekend ×")).toBe(true);
    expect(r.label).toMatch(/niet vastgesteld/);
    const noPrice = computeSizing("b2b_accounts", factors(2000, 0));
    expect(noPrice.formula).toMatch(/× onbekend$/);
    expect(noPrice.label).toMatch(/omzet niet vastgesteld/);
    expect(reachableRevenue({ somRevenue: noPrice.somRevenue, status: noPrice.label, established: noPrice.established }).value).toBe("Niet vastgesteld");
  });
});

describe("D6: niets doen en voorstellen", () => {
  it("de regel 'Niets doen' komt uit de intake", () => {
    expect(statusQuoPositioning("amateursportclubs", "Clubs communiceren nu via WhatsApp-groepen en e-mail")).toBe(
      "Amateursportclubs houden vast aan hoe het nu gaat: clubs communiceren nu via WhatsApp-groepen en e-mail.",
    );
    expect(statusQuoPositioning("amateursportclubs", null)).toBe("Amateursportclubs houden vast aan hoe het nu gaat: nog te onderzoeken.");
    expect(currentPracticeFromText("Een AI-assistent voor sportclubs. Clubs communiceren nu via WhatsApp en e-mail.")).toBe("Clubs communiceren nu via WhatsApp en e-mail");
    expect(currentPracticeFromText("Een AI-assistent voor sportclubs.")).toBeNull();
  });

  it("voorstellen tellen niet mee en worden pas overgenomen met website of bevinding", () => {
    expect(withoutProposals([{ origin: "manual" }, { origin: "proposal" }, { origin: "ai" }])).toHaveLength(2);
    expect(proposalAdoptionProblem({ website: null, claim_id: null })).toMatch(/website of een gekoppelde bevinding/);
    expect(proposalAdoptionProblem({ website: "https://voorbeeld.nl", claim_id: null })).toBeNull();
    expect(proposalAdoptionProblem({ website: null, claim_id: "c1" })).toBeNull();
  });

  it("slaat bestaande en dubbele namen over, hooguit drie", () => {
    const out = newProposals(
      [{ name: "WhatsApp-groepen", why: "Gratis" }, { name: "whatsapp groepen" }, { name: "Excel" }, { name: "Clubee" }, { name: "Sportlink" }, { name: "Nog één" }],
      [{ name: "Excel" }],
    );
    expect(out.map((p) => p.name)).toEqual(["WhatsApp-groepen", "Clubee", "Sportlink"]);
  });
});

describe("D7: branche verenigingen", () => {
  it("bestaat als branche en wordt herkend", () => {
    expect(SECTOR_TEMPLATES.associations).toBe("Verenigingen, sport en maatschappelijke organisaties");
    expect(sectorFromText("amateursportclubs met vrijwilligers")).toBe("associations");
    expect(sectorFromText("voetbalverenigingen in Utrecht")).toBe("associations");
  });

  it("geen MKB bij een publieke doelgroep", () => {
    const r = ruleProposal(
      { idea: "Een AI-communicatieassistent voor sportclubs met veel vrijwilligers en medewerkers.", decision: "Investeren we € 20.000 voor 1 maart?", uncertainty: "Willen besturen € 79 per maand betalen?" },
      "2026-11-04",
    );
    expect(r.proposal.target_audience).toBe("Publieke organisaties of verenigingen");
    expect(r.proposal.sector_template).not.toBe("smb");
    const merged = mergeProposals(r, sanitizeAiProposal({ ...EMPTY_PROPOSAL, sector_template: "smb" }, "2026-11-04"));
    expect(merged.proposal.sector_template).not.toBe("smb");
  });

  it("het sjabloon laat een branche weg die niet bij het soort klant past", () => {
    expect(sectorFitsAudience("smb", "Publieke organisaties of verenigingen")).toBe(false);
    expect(sectorFitsAudience("smb", "Zakelijke klanten (B2B)")).toBe(true);
    const qs = templatePlan("new_product", "smb", { audience: "sportclubs", region: "Nederland", targetAudience: "Publieke organisaties of verenigingen" });
    expect(qs.some((q) => q.question.includes("in de branche"))).toBe(false);
    const fit = templatePlan("new_product", "associations", { audience: "sportclubs", region: "Nederland", targetAudience: "Publieke organisaties of verenigingen" });
    expect(fit.some((q) => q.why_it_matters.includes("contributie"))).toBe(true);
  });
});

describe("D8: korte doelgroep", () => {
  it("leidt een korte vorm af uit de toelichting", () => {
    expect(shortAudience("amateursportclubs met 100–500 leden in Nederland")).toBe("amateursportclubs");
    expect(shortAudience("besturen van amateursportclubs")).toBe("besturen");
    expect(shortAudience("kleine zorginstellingen die met vrijwilligers werken")).toBe("kleine zorginstellingen");
    expect(shortAudience("a b c d e f g h")).toBe("a b c d e f");
    expect(shortAudience("")).toBeNull();
  });

  const intake = {
    title: "AI-communicatie voor sportclubs",
    target_audience: "Publieke organisaties of verenigingen",
    audience_detail: "amateursportclubs met 100–500 leden en een vrijwilligersbestuur",
    region: "Nederland",
    project_type: "new_product",
    sector_template: "associations",
  };

  it("specificAudience: eerst de korte doelgroep, dan de afgeleide vorm, dan de toelichting", () => {
    expect(specificAudience({ ...intake, audience_short: "sportclubs" })).toBe("sportclubs");
    expect(specificAudience(intake)).toBe("amateursportclubs");
    expect(specificAudience({ ...intake, audience_detail: null })).toBe("Publieke organisaties of verenigingen");
  });

  it("de vragen gebruiken de korte doelgroep en tellen niet als algemeen sjabloon", () => {
    const plan = derivePlan({ ...intake, audience_short: "sportclubs" });
    expect(plan.questions[0].question).toContain("sportclubs");
    expect(plan.questions.some((q) => q.question.includes("met 100–500 leden"))).toBe(false);
    for (const q of plan.questions) expect(isGenericTemplate({ question: q.question, origin: "template" }, { ...intake, audience_short: "sportclubs" })).toBe(false);
  });

  it("de intake stelt een korte doelgroep voor", () => {
    const r = ruleProposal({ idea: "Een assistent voor amateursportclubs met 100–500 leden.", decision: "Investeren we € 20.000?", uncertainty: "Willen ze betalen?" }, "2026-11-04");
    expect(r.proposal.audience_short).toBe("amateursportclubs");
    expect(sanitizeAiProposal({ audience_short: "x".repeat(80) }, "2026-11-04").audience_short).toHaveLength(60);
  });
});
