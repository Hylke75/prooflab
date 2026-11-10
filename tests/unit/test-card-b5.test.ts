import { describe, expect, it } from "vitest";
import {
  daysUntil,
  deadlineFromDays,
  detailFieldErrors,
  formatAmount,
  headlineFromIdea,
  shortHeadline,
  intakePrice,
  orderedErrors,
  parseDutchAmount,
  priceFromText,
  recruitmentFromChannels,
  validateTestCard,
  type TestCardInput,
} from "@/lib/domain/test-card";
import { GO_RULE_MISSING, goRuleBlock } from "@/lib/domain/experiment-gates";
import { LEGACY_REVEAL_DEFAULT, REVEAL_DEFAULT, revealMessageFor } from "@/lib/domain/labels";
import { GO_RULE_DEFAULT_PROBABILITY, proposeGoRule } from "@/lib/domain/decision-rule-proposal";
import { acceptAiLearning, isUnchangedProposal, ruleBasedLearning, type LearningInput } from "@/lib/domain/learning-proposal";

describe("prijs uit de intake (B5)", () => {
  it("haalt bedrag en periode uit de beschrijving van het makelaarsdossier", () => {
    const p = priceFromText("Een AI-assistent voor zelfstandige NVM-makelaars die woningteksten en klantmails schrijft, voor € 249 per maand.");
    expect(p).toEqual({ amount: 249, period: "per maand", text: "€ 249 per maand" });
  });
  it("kent Nederlandse notaties en periodes", () => {
    expect(priceFromText("€1.250 per jaar")?.amount).toBe(1250);
    expect(priceFromText("€1.250 per jaar")?.period).toBe("per jaar");
    expect(priceFromText("kost € 49,95 p/m excl. btw")).toMatchObject({ amount: 49.95, period: "per maand" });
    expect(priceFromText("€ 19/maand per gebruiker")).toMatchObject({ amount: 19, period: "per maand" });
    expect(priceFromText("€ 15 per gebruiker per maand")).toMatchObject({ amount: 15, period: "per maand" });
    expect(priceFromText("249 euro per maand")).toMatchObject({ amount: 249, period: "per maand" });
    expect(priceFromText("€ 99,- eenmalig")).toMatchObject({ amount: 99, period: "eenmalig" });
  });
  it("neemt een bedrag zonder periode alleen na 'voor', 'kost' of 'prijs'", () => {
    expect(priceFromText("We investeren € 40.000 in de lancering.")).toBeNull();
    expect(priceFromText("Een cursus voor € 1.500.")).toEqual({ amount: 1500, period: null, text: "€ 1500" });
  });
  it("kiest een prijs met periode boven een losse prijs, en een expliciet prijsveld boven tekst", () => {
    expect(intakePrice({ texts: ["Een cursus voor € 1.500.", "Betalen minstens 20 kantoren € 249 per maand."] })).toMatchObject({ amount: 249, period: "per maand" });
    expect(intakePrice({ price_eur: 199, price_period: "per maand", texts: ["€ 249 per maand"] })).toMatchObject({ amount: 199, period: "per maand" });
    expect(intakePrice({ texts: ["Geen prijs genoemd.", null, undefined] })).toBeNull();
  });
  it("leest bedragen en schrijft ze terug voor het invoerveld", () => {
    expect(parseDutchAmount("1.250,50")).toBe(1250.5);
    expect(parseDutchAmount("249,-")).toBe(249);
    expect(parseDutchAmount("abc")).toBeNull();
    expect(formatAmount(249)).toBe("249");
    expect(formatAmount(49.95)).toBe("49,95");
  });
});

describe("vooringevulde details (B5)", () => {
  it("maakt een kop zonder de prijs", () => {
    expect(headlineFromIdea("Een AI-assistent voor zelfstandige NVM-makelaars die woningteksten en klantmails schrijft, voor € 249 per maand.", "X")).toBe(
      "Een AI-assistent voor zelfstandige NVM-makelaars die woningteksten en klantmails schrijft",
    );
    expect(headlineFromIdea("", "Makelaarsassistent")).toBe("Makelaarsassistent");
  });
  it("stelt een korte kop voor (hooguit 8 woorden) in plaats van de volledige intakezin", () => {
    expect(shortHeadline("Een AI-assistent voor zelfstandige NVM-makelaars die woningteksten en klantmails schrijft, voor € 249 per maand.", "X")).toBe(
      "Een AI-assistent voor zelfstandige NVM-makelaars",
    );
    expect(shortHeadline("Planning voor sportclubs.", "X")).toBe("Planning voor sportclubs");
    expect(shortHeadline("", "Makelaarsassistent")).toBe("Makelaarsassistent");
    // Zonder zinsdeel: de eerste woorden, zonder los voorzetsel aan het eind.
    const long = shortHeadline("Wij bouwen een slimme app voor het plannen van vrijwilligers bij amateurvoetbalclubs in Nederland", "X");
    expect(long.split(" ").length).toBeLessThanOrEqual(8);
    expect(long).toBe("Wij bouwen een slimme app voor het plannen");
    expect(long).not.toMatch(/…$/);
  });
  it("leidt de wervingsgroep af uit de kanalen, voorzichtig bij gemengde kanalen", () => {
    expect(recruitmentFromChannels(["linkedin", "network"])).toBe("own_network");
    expect(recruitmentFromChannels(["google_ads", "network"])).toBe("own_network");
    expect(recruitmentFromChannels(["google_ads", "outreach"])).toBe("cold");
    expect(recruitmentFromChannels(["other"])).toBe("unknown");
    expect(recruitmentFromChannels([])).toBe("unknown");
  });
  it("rekent de deadline om naar dagen en terug", () => {
    expect(deadlineFromDays(28, "2026-11-04")).toBe("2026-12-02");
    expect(daysUntil("2026-12-02", "2026-11-04")).toBe(28);
    expect(daysUntil("2027-03-29", "2026-11-04")).toBe(145); // over de wintertijd heen: hele dagen
    expect(daysUntil("", "2026-11-04")).toBeNull();
  });
});

const pricing: TestCardInput = {
  type: "pricing",
  title: "Prijs-/aanbodtest: makelaars betalen € 249 per maand",
  we_believe: "Zelfstandige NVM-makelaars kiezen een abonnement van € 249 per maand op de testpagina.",
  target_group: "Zelfstandige NVM-kantoren",
  test_method: "Aanbod met prijspunten op een testpagina (zonder afrekenen)",
  metric_label: "Kiest een aanbod met prijs",
  metric_numerator: "unieke bezoekers die een prijsaanbod kiezen",
  metric_denominator: "unieke relevante bezoekers",
  success_threshold_pct: 8,
  fail_threshold_pct: 2,
  min_sample: 150,
  max_duration_days: 28,
  rule: "probability",
  success_count: null,
  thresholds_locked: true,
  recruitment_group: recruitmentFromChannels(["linkedin", "network"]),
  channels: ["linkedin", "network"],
  headline: headlineFromIdea("Een AI-assistent voor makelaars, voor € 249 per maand.", "X"),
  price_points: 1,
  guide_questions: 0,
};

describe("Testkaart met vijf zichtbare velden (B5)", () => {
  it("is met de standaarden op te slaan", () => {
    expect(validateTestCard(pricing)).toEqual({});
  });
  it("opent Details bij een ontbrekend verplicht detailveld, niet bij een zichtbaar veld", () => {
    // Sinds de tabs staan kop en prijspunten op de tab Testpagina, niet onder Details.
    const e = validateTestCard({ ...pricing, headline: "", price_points: 0, channels: [] });
    expect(detailFieldErrors(e).sort()).toEqual(["channels"]);
    expect(detailFieldErrors(validateTestCard({ ...pricing, we_believe: "" }))).toEqual([]);
    expect(detailFieldErrors({ survey: "x" })).toEqual([]);
  });
  it("noemt de looptijd een deadline", () => {
    expect(validateTestCard({ ...pricing, max_duration_days: null }).max_duration_days).toBe("Kies een deadline na vandaag.");
    expect(validateTestCard({ ...pricing, max_duration_days: 200 }).max_duration_days).toMatch(/binnen 180 dagen/);
    expect(orderedErrors({ headline: "x", max_duration_days: "y" }).map((x) => x.label)).toEqual(["Deadline", "Kop"]);
  });
});

describe("beslisregel (B5)", () => {
  it("blokkeert alleen een hoofdtest zonder vastgelegde regel", () => {
    expect(goRuleBlock({ isPrimary: true, rule: "missing" })).toBe(GO_RULE_MISSING);
    expect(goRuleBlock({ isPrimary: true, rule: "saved" })).toBeNull();
    expect(goRuleBlock({ isPrimary: false, rule: "missing" })).toBeNull();
    expect(goRuleBlock({ isPrimary: true, rule: "unknown" })).toBeNull();
  });
  it("stelt bij de eerste hoofdtest een regel voor: deze aanname en deze test", () => {
    const p = proposeGoRule({ rule: null, assumption: { id: "a1", statement: "Makelaars betalen € 249 per maand" }, experiment: { id: "e1", title: "Prijstest" }, isPrimary: true });
    expect(p).toMatchObject({ assumptionId: "a1", experimentId: "e1", minProbability: GO_RULE_DEFAULT_PROBABILITY });
    expect(p?.sentence).toBe('Doorgaan als de hoofdtest "Prijstest" slaagt en de aanname "Makelaars betalen € 249 per maand" minstens 70% kans haalt.');
  });
  it("stelt niets voor als er al een regel is, de tabel ontbreekt of de test verkennend is", () => {
    const base = { assumption: { id: "a1", statement: "x" }, experiment: { id: "e1", title: "t" } };
    const rule = { primaryExperimentId: null, note: null, lockedAt: null, recordedLate: false, conditions: [] };
    expect(proposeGoRule({ ...base, rule, isPrimary: true })).toBeNull();
    expect(proposeGoRule({ ...base, rule: undefined, isPrimary: true })).toBeNull();
    expect(proposeGoRule({ ...base, rule: null, isPrimary: false })).toBeNull();
  });
});

describe("Leerkaart-voorstel (B5)", () => {
  const input: LearningInput = {
    assumption: "Makelaars betalen € 249 per maand",
    verdict: "pass",
    rule: "probability",
    n: 160,
    successes: 22,
    minSample: 150,
    successThresholdPct: 8,
    failThresholdPct: 2,
    successCount: null,
    probability: 0.91,
    belowSample: false,
    endReason: null,
    isPrimary: true,
    metricNumerator: "unieke bezoekers die een prijsaanbod kiezen",
    followUp: "Test daarna de betaalbereidheid met een echte voorverkoop.",
  };
  it("maakt een regelgebaseerd voorstel uit uitkomst en drempels", () => {
    const p = ruleBasedLearning(input);
    expect(p.source).toBe("rules");
    expect(p.we_learned).toContain("wordt gesteund");
    expect(p.we_learned).toContain("22 van 160 (13,8%)");
    expect(p.we_learned).toContain("succesdrempel was 8%");
    expect(p.therefore).toContain("beslisregel");
    expect(ruleBasedLearning({ ...input, verdict: "fail" }).we_learned).toContain("niet gesteund");
    expect(ruleBasedLearning({ ...input, verdict: "inconclusive" }).we_learned).toMatch(/^Onbeslist/);
    expect(ruleBasedLearning({ ...input, isPrimary: false }).therefore).toContain("hoofdtest");
    const low = ruleBasedLearning({ ...input, verdict: "inconclusive", belowSample: true, n: 40, endReason: "De opdrachtgever stopte het project." });
    expect(low.we_learned).toContain("40 van minimaal 150");
    expect(low.we_learned).toContain("De opdrachtgever stopte");
  });
  it("neemt een AI-voorstel alleen over als het de berekende uitspraak niet tegenspreekt", () => {
    const ai = { we_learned: "De aanname wordt gesteund: 22 van 160 bezoekers kozen een prijs.", therefore: "We starten een voorverkoop." };
    expect(acceptAiLearning(ai, input)).toEqual({ ...ai, source: "ai" });
    expect(acceptAiLearning(ai, { ...input, verdict: "fail" }).source).toBe("rules");
    expect(acceptAiLearning({ we_learned: "De aanname wordt niet gesteund door de cijfers.", therefore: "We passen het aanbod aan." }, { ...input, verdict: "fail" }).source).toBe("ai");
    expect(acceptAiLearning({ we_learned: "kort", therefore: "x" }, input).source).toBe("rules");
    expect(acceptAiLearning(null, input).source).toBe("rules");
  });
  it("herkent een ongewijzigd voorstel op de kaart", () => {
    const metrics = { proposal: { we_learned: "A leren", therefore: "B doen", source: "ai" } };
    expect(isUnchangedProposal({ we_learned: "A leren", therefore: "B doen" }, metrics)).toEqual({ learned: true, therefore: true, source: "ai" });
    expect(isUnchangedProposal({ we_learned: "Aangepast", therefore: "B doen" }, metrics)).toEqual({ learned: false, therefore: true, source: "ai" });
    expect(isUnchangedProposal({ we_learned: "A", therefore: "B" }, {})).toBeNull();
  });
});

describe("bericht na de klik op de testpagina (bevinding 10)", () => {
  it("belooft geen contact zonder e-mailadres en vervangt het oude standaardbericht", () => {
    expect(revealMessageFor(LEGACY_REVEAL_DEFAULT, true)).toBe(REVEAL_DEFAULT);
    expect(revealMessageFor(LEGACY_REVEAL_DEFAULT, false)).toBe("");
    expect(revealMessageFor(REVEAL_DEFAULT, false)).toBe("");
    expect(revealMessageFor("  Eigen tekst van de consultant. ", false)).toBe("Eigen tekst van de consultant.");
    expect(revealMessageFor(null, true)).toBe("");
  });
});
