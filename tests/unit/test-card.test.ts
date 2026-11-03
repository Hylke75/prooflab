import { describe, expect, it } from "vitest";
import { errorSummary, orderedErrors, sampleBand, validateTestCard, type TestCardInput } from "@/lib/domain/test-card";
import { empiricalPrior, FLAT_PRIOR } from "@/lib/domain/stats";

const pricing: TestCardInput = {
  type: "pricing",
  title: "Prijstest: makelaars betalen € 249 per maand",
  we_believe: "Zelfstandige NVM-makelaars kiezen een abonnement van € 249 per maand op de testpagina.",
  target_group: "Zelfstandige NVM-kantoren met 2–15 medewerkers",
  test_method: "Aanbod met prijspunten op een testpagina",
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
  recruitment_group: "cold",
  channels: ["linkedin"],
  headline: "AI-assistent voor je woningteksten",
  price_points: 1,
  guide_questions: 0,
};

describe("validateTestCard (B1a)", () => {
  it("accepteert een complete prijstest", () => {
    expect(validateTestCard(pricing)).toEqual({});
  });

  it("geeft per leeg veld een eigen melding in plaats van stil niets te doen", () => {
    const e = validateTestCard({ ...pricing, recruitment_group: "", headline: "", price_points: 0, channels: [] });
    expect(Object.keys(e).sort()).toEqual(["channels", "headline", "price_points", "recruitment_group"]);
    expect(e.price_points).toMatch(/prijspunt/);
    expect(errorSummary(e)).toMatch(/4 punten/);
  });

  it("vraagt eerst de drempels vast te leggen", () => {
    expect(validateTestCard({ ...pricing, thresholds_locked: false }).thresholds).toMatch(/drempels vast/);
    // Bij methode 2026-11-a (geen beslisregel) is er geen vastlegstap.
    expect(validateTestCard({ ...pricing, rule: null, thresholds_locked: false }).thresholds).toBeUndefined();
  });

  it("zet de hypothesecoach om in veldmeldingen", () => {
    const e = validateTestCard({ ...pricing, we_believe: "Leuk", fail_threshold_pct: 20, min_sample: 2 });
    expect(e.we_believe).toBeTruthy();
    expect(e.fail_threshold_pct).toMatch(/faaldrempel/);
    expect(e.min_sample).toMatch(/minstens 5/);
  });

  it("controleert de leidraad bij interviews en het aantal bij de aantalregel", () => {
    const iv = { ...pricing, type: "interview", headline: "", price_points: 0, recruitment_group: "", guide_questions: 2, rule: "absolute" as const, success_count: 20, min_sample: 10 };
    const e = validateTestCard(iv);
    expect(e.guide).toMatch(/drie vragen/);
    expect(e.success_count).toMatch(/niet groter/);
    expect(e.recruitment_group).toBeUndefined(); // bij interviews niet verplicht
  });

  it("sorteert de samenvatting in schermvolgorde", () => {
    const list = orderedErrors({ price_points: "a", title: "b", recruitment_group: "c" });
    expect(list.map((x) => x.field)).toEqual(["title", "recruitment_group", "price_points"]);
    expect(list[0].label).toBe("Naam van het experiment");
  });
});

describe("sampleBand (B1b)", () => {
  it("rekent zonder eerdere tests met scenario's boven de drempel en toont het voorzichtige scenario", () => {
    const b = sampleBand({ rule: "probability", thresholdPct: 8, prior: FLAT_PRIOR, maxDurationDays: 28 });
    expect(b.basis).toBe("threshold");
    expect(b.scenarios.map((s) => s.ratePct)).toEqual([10, 12, 16]);
    expect(b.shown).toBe("low");
    expect(b.requiredN).toBe(b.scenarios[0].requiredN);
    expect(b.requiredN).toBeGreaterThan(50); // geen misleidend klein getal door de vlakke prior
    expect(b.expectedPct).toBe(10);
    // Hoe ruimer het echte percentage boven de drempel, hoe minder deelnemers nodig.
    expect(b.scenarios[0].requiredN!).toBeGreaterThan(b.scenarios[2].requiredN!);
    expect(b.feasible).toBe(true);
    expect(b.advice).toBeNull();
  });

  it("gebruikt eerdere tests van hetzelfde type als die er zijn", () => {
    const prior = empiricalPrior([
      { n: 200, successes: 30 },
      { n: 150, successes: 18 },
      { n: 180, successes: 27 },
    ]);
    const b = sampleBand({ rule: "probability", thresholdPct: 8, prior, maxDurationDays: 28 });
    expect(b.basis).toBe("earlier_tests");
    expect(b.earlierTests).toBe(3);
    expect(b.scenarios[1].ratePct).toBeGreaterThan(12);
  });

  it("adviseert een ander testtype of een langere looptijd, nooit een lagere drempel", () => {
    const low = empiricalPrior([
      { n: 200, successes: 4 },
      { n: 150, successes: 3 },
      { n: 180, successes: 5 },
    ]);
    const b = sampleBand({ rule: "probability", thresholdPct: 8, prior: low, maxDurationDays: 28 });
    expect(b.requiredN).toBeNull();
    expect(b.feasible).toBe(false);
    expect(b.advice).toMatch(/ander testtype of verleng de looptijd/);
    expect(b.advice).not.toMatch(/drempel (verlagen|aan)/i);

    const slow = sampleBand({ rule: "probability", thresholdPct: 8, prior: FLAT_PRIOR, availablePerWeek: 5, maxDurationDays: 14 });
    expect(slow.feasible).toBe(false);
    expect(slow.capacity).toBe(10);
    expect(slow.advice).toMatch(/Niet haalbaar binnen de looptijd.*ander testtype of verleng de looptijd/);
  });

  it("werkt ook voor de aantalregel", () => {
    const b = sampleBand({ rule: "absolute", thresholdPct: 30, successCount: 3, prior: FLAT_PRIOR, maxDurationDays: 14 });
    expect(b.requiredN).toBe(Math.ceil(3 / 0.375 - 1e-9));
  });
});
