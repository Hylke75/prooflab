import { describe, expect, it } from "vitest";
import { testCardDefaults } from "@/lib/domain/recommend";
import { defaultedTestCardFields, DEFAULT_CHANNELS } from "@/lib/defaulted-test-card";
import { assumptionDefaults, withDefaultedFallback, withFields } from "@/lib/defaulted-fields";

// Fase 1 · punt 1: standaardwaarden die ProofLab invult, blijven zichtbaar (defaulted_fields → auditspoor en testkaart).

describe("Testkaart: welke velden staan nog op de standaard", () => {
  const d = testCardDefaults("landing", "Clubs vragen een demo aan", "Sportclubs");
  const base = {
    type: "landing" as const,
    rule: "probability" as const,
    values: { ...d },
    channels: [...DEFAULT_CHANNELS],
    recruitmentGroup: "own_network",
  };

  it("alles ongewijzigd: alle verborgen velden zijn standaard (ook kanalen en de afgeleide wervingsgroep)", () => {
    expect(defaultedTestCardFields(base)).toEqual([
      "test_method",
      "metric_label",
      "metric_numerator",
      "metric_denominator",
      "success_threshold_pct",
      "fail_threshold_pct",
      "min_sample",
      "max_duration_days",
      "expected_biases",
      "channels",
      "recruitment_group",
    ]);
  });

  it("wat de gebruiker aanpast, valt weg; getallen als tekst tellen ook", () => {
    const out = defaultedTestCardFields({
      ...base,
      values: { ...d, min_sample: "120", max_duration_days: String(d.max_duration_days), test_method: "Eigen aanpak" },
      channels: ["linkedin"],
      recruitmentGroup: "cold",
    });
    expect(out).not.toContain("min_sample");
    expect(out).not.toContain("test_method");
    expect(out).not.toContain("channels");
    expect(out).not.toContain("recruitment_group");
    expect(out).toContain("max_duration_days");
  });

  it("het berekende aantal deelnemers is ook een standaardwaarde", () => {
    expect(defaultedTestCardFields({ ...base, values: { ...d, min_sample: 132 }, requiredN: 132 })).toContain("min_sample");
    expect(defaultedTestCardFields({ ...base, values: { ...d, min_sample: 140 }, requiredN: 132 })).not.toContain("min_sample");
  });

  it("enquête en aantalregel: de maatstaf volgt uit de enquête of de keuze van de gebruiker", () => {
    const s = testCardDefaults("survey", "x", "y");
    expect(defaultedTestCardFields({ ...base, type: "survey", values: { ...s } })).not.toContain("metric_label");
    const i = testCardDefaults("interview", "x", "y");
    const abs = defaultedTestCardFields({ ...base, type: "interview", rule: "absolute", values: { ...i }, recruitmentGroup: null });
    expect(abs).not.toContain("metric_label");
    expect(abs).not.toContain("success_threshold_pct");
    // Bij interviews is de wervingsgroep per gesprek; geen standaard op de testkaart.
    expect(abs).not.toContain("recruitment_group");
  });
});

describe("aannames en terugval zonder migratie", () => {
  it("een aanname zonder eigen startkans krijgt 'prior' als standaardwaarde", () => {
    expect(assumptionDefaults({ statement: "x" })).toEqual(["prior"]);
    expect(assumptionDefaults({ statement: "x", prior: null })).toEqual(["prior"]);
    expect(assumptionDefaults({ statement: "x", prior: 0.65 })).toEqual([]);
  });

  it("withFields voegt de lijst alleen toe als de kolom bestaat", () => {
    expect(withFields({ a: 1 }, ["prior"], true)).toEqual({ a: 1, defaulted_fields: ["prior"] });
    expect(withFields({ a: 1 }, ["prior"], false)).toEqual({ a: 1 });
  });

  it("zonder kolom (PGRST204/42703) nog een keer zonder de lijst; andere fouten niet", async () => {
    const calls: boolean[] = [];
    const missing = await withDefaultedFallback(async (w) => {
      calls.push(w);
      return { error: w ? { code: "PGRST204", message: "Could not find the 'defaulted_fields' column" } : null };
    });
    expect(calls).toEqual([true, false]);
    expect(missing.error).toBeNull();
    const other: boolean[] = [];
    const denied = await withDefaultedFallback(async (w) => {
      other.push(w);
      return { error: { code: "42501", message: "permission denied" } };
    });
    expect(other).toEqual([true]);
    expect(denied.error?.code).toBe("42501");
  });
});
