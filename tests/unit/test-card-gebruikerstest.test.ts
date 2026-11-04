import { describe, expect, it } from "vitest";
import { FIELD_LABELS, sampleBelowRequired, validateTestCard, VISIBLE_FIELDS, type TestCardInput } from "@/lib/domain/test-card";
import { experimentTitle, EXPERIMENT_TITLE_MAX, truncateWords } from "@/lib/domain/truncate";

// Gebruikerstest C3 (steekproef onder het berekende aantal), C4 (titel op een woordgrens) en C5 ("Wij denken dat …").

const card = (over: Partial<TestCardInput> = {}): TestCardInput => ({
  type: "landing",
  title: "Landingpage-test: clubs vragen een demo aan",
  we_believe: "Minstens 30% van de benaderde clubbesturen vraagt binnen twee weken een demo aan.",
  target_group: "Besturen van tennis- en hockeyclubs",
  test_method: "Landingpage met demo-aanvraag",
  metric_label: "Demo-aanvraag",
  metric_numerator: "bezoekers die een demo aanvragen",
  metric_denominator: "unieke bezoekers uit de doelgroep",
  success_threshold_pct: 30,
  fail_threshold_pct: 10,
  min_sample: 60,
  max_duration_days: 14,
  rule: "probability",
  success_count: null,
  thresholds_locked: true,
  recruitment_group: "cold",
  channels: ["linkedin"],
  headline: "Communicatie voor je club, zonder gedoe",
  price_points: 0,
  guide_questions: 0,
  ...over,
});

describe("C3: minimale steekproef onder het berekende aantal", () => {
  it("gelijk aan of boven het berekende aantal: niets te vragen", () => {
    expect(validateTestCard(card({ required_n: 60 })).sample_below_reason).toBeUndefined();
    expect(validateTestCard(card({ required_n: 40 })).sample_below_reason).toBeUndefined();
  });
  it("lager zonder motivering: fout bij het motiveringsveld", () => {
    const e = validateTestCard(card({ min_sample: 30, required_n: 60, sample_below_reason: "kort" }));
    expect(e.sample_below_reason).toMatch(/onder het berekende aantal \(60\)/);
  });
  it("lager met motivering van minstens 10 tekens: goed", () => {
    expect(validateTestCard(card({ min_sample: 30, required_n: 60, sample_below_reason: "Er zijn maar 30 clubs in de regio." })).sample_below_reason).toBeUndefined();
  });
  it("geldt niet voor de aantalregel of zonder berekening", () => {
    expect(sampleBelowRequired({ rule: "absolute", min_sample: 5, required_n: 20 })).toBe(false);
    expect(sampleBelowRequired({ rule: null, min_sample: 5, required_n: 20 })).toBe(false);
    expect(sampleBelowRequired({ rule: "probability", min_sample: 5, required_n: null })).toBe(false);
  });
});

describe("C4: titel op een woordgrens", () => {
  it("de voorbeeldtitel blijft heel als hij past", () => {
    const t = experimentTitle("Klantinterviews", "Vrijwilligersbesturen van kleine tennis- en hockeyclubs (200–1.500 leden)");
    expect(t).toBe("Klantinterviews: Vrijwilligersbesturen van kleine tennis- en hockeyclubs (200–1.500 leden)");
    expect(t.length).toBeLessThanOrEqual(EXPERIMENT_TITLE_MAX);
  });
  it("te lang: afgekapt op een woordgrens met …, nooit midden in een woord of getal", () => {
    const t = experimentTitle("Klantinterviews", "Vrijwilligersbesturen van kleine tennis- en hockeyclubs (200–1.500 leden) besteden hun communicatie liever uit aan een vaste partij");
    expect(t.endsWith("…")).toBe(true);
    expect(t.length).toBeLessThanOrEqual(EXPERIMENT_TITLE_MAX);
    const words = "Klantinterviews: Vrijwilligersbesturen van kleine tennis- en hockeyclubs (200–1.500 leden) besteden hun communicatie liever uit aan een vaste partij".split(" ");
    const kept = t.slice(0, -1).split(" ");
    expect(kept.every((w, i) => w === words[i])).toBe(true);
  });
  it("het oude afkappen op 60 tekens brak midden in het getal; de helper niet", () => {
    const statement = "Vrijwilligersbesturen van kleine tennis- en hockeyclubs (200–1.500 leden)";
    expect(statement.slice(0, 60)).toMatch(/\(200$/);
    expect(truncateWords(`Klantinterviews: ${statement}`, 70)).toBe("Klantinterviews: Vrijwilligersbesturen van kleine tennis- en…");
  });
  it("de naam staat in het zichtbare deel van de Test Card", () => {
    expect(VISIBLE_FIELDS).toContain("title");
  });
});

describe("C5: Wij denken dat …", () => {
  it("label in gewone taal", () => {
    expect(FIELD_LABELS.we_believe).toBe("Wij denken dat …");
  });
  it("een vraag is geen bewering", () => {
    expect(validateTestCard(card({ we_believe: "Vragen clubbesturen binnen twee weken een demo aan als ze de pagina zien?" })).we_believe).toMatch(/bewering, geen vraag/);
    expect(validateTestCard(card()).we_believe).toBeUndefined();
  });
});
