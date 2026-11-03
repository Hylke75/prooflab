import { describe, expect, it } from "vitest";
import { effortSummary, executionInsufficient, insufficientReason } from "@/lib/domain/effort";
import { EffortSchema, ExclusionSchema } from "@/lib/forecast-schemas";

// Golf B, punt 2: inzet bij de uitkomst en het markeren van onvoldoende uitvoering.

describe("onvoldoende uitvoering", () => {
  it("is onbekend zonder vastgelegde inzet en waar bij niet gestart", () => {
    expect(executionInsufficient({ started: null, hours: null, budgetPctOfPlan: null })).toBeNull();
    expect(executionInsufficient({ started: false, hours: null, budgetPctOfPlan: null })).toBe(true);
  });

  it("markeert minder dan de helft van het budget of van de geplande uren", () => {
    expect(executionInsufficient({ started: true, hours: null, budgetPctOfPlan: 49 })).toBe(true);
    expect(executionInsufficient({ started: true, hours: null, budgetPctOfPlan: 50 })).toBe(false);
    expect(executionInsufficient({ started: true, hours: 30, budgetPctOfPlan: null }, { kind: "time", value: 80 })).toBe(true);
    expect(executionInsufficient({ started: true, hours: 40, budgetPctOfPlan: null }, { kind: "time", value: 80 })).toBe(false);
    // Uren zijn alleen te vergelijken met een inzet in uren.
    expect(executionInsufficient({ started: true, hours: 3, budgetPctOfPlan: null }, { kind: "amount", value: 25000 })).toBe(false);
  });

  it("legt in één zin uit waarom", () => {
    expect(insufficientReason({ started: false, hours: null, budgetPctOfPlan: null })).toMatch(/niet gestart/);
    expect(insufficientReason({ started: true, hours: null, budgetPctOfPlan: 20 })).toMatch(/20% van het geplande budget/);
    expect(insufficientReason({ started: true, hours: 10, budgetPctOfPlan: null }, { kind: "time", value: 80 })).toMatch(/10 uur.*80 uur/);
    expect(insufficientReason({ started: true, hours: 70, budgetPctOfPlan: 90 })).toBeNull();
  });

  it("vat de inzet kort samen", () => {
    expect(effortSummary({ started: true, hours: 120, budgetPctOfPlan: 80 })).toBe("Gestart · 120 uur · 80% van het budget");
    expect(effortSummary({ started: false, hours: null, budgetPctOfPlan: null })).toBe("Niet gestart");
    expect(effortSummary({ started: null, hours: null, budgetPctOfPlan: null })).toBe("Inzet niet vastgelegd");
  });
});

describe("formulier voor inzet en uitsluiting", () => {
  it("vraagt gestart ja/nee en leest uren en budget als Nederlandse getallen", () => {
    expect(EffortSchema.safeParse({}).success).toBe(false);
    const ok = EffortSchema.safeParse({ started: "yes", effort_hours: "120,5", budget_pct_of_plan: "" });
    expect(ok.success && ok.data).toEqual({ started: "yes", effort_hours: 120.5, budget_pct_of_plan: null });
    expect(EffortSchema.safeParse({ started: "yes", budget_pct_of_plan: "5000" }).success).toBe(false);
  });

  it("vraagt een reden van minstens één zin om een dossier uit de kalibratie te halen", () => {
    expect(ExclusionSchema.safeParse({ reason: "kort" }).success).toBe(false);
    expect(ExclusionSchema.safeParse({ reason: "Budget ging na twee maanden naar een ander project." }).success).toBe(true);
  });
});
