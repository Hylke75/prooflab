import { describe, expect, it } from "vitest";
import { priorChangeError, priorDbError, priorNeedsRationale } from "@/lib/domain/prior";

// Golf A, punt 5: een afwijking van 50% vraagt een onderbouwing; na het eerste bewijs alleen wijzigen met een reden.
const base = { current: 0.5, prior: 0.5, rationale: "", reason: "", locked: false };

describe("startkans van een aanname", () => {
  it("50% is de neutrale startkans en vraagt geen onderbouwing", () => {
    expect(priorNeedsRationale(0.5)).toBe(false);
    expect(priorNeedsRationale(null)).toBe(false);
    expect(priorNeedsRationale(0.35)).toBe(true);
    expect(priorChangeError(base)).toBeNull();
  });

  it("een afwijking van 50% vraagt een onderbouwing van minimaal 10 tekens", () => {
    expect(priorChangeError({ ...base, prior: 0.8 })).toMatch(/onderbouwing/);
    expect(priorChangeError({ ...base, prior: 0.8, rationale: "omdat" })).toMatch(/onderbouwing/);
    expect(priorChangeError({ ...base, prior: 0.8, rationale: "Basispercentage SaaS-pilots 30%" })).toBeNull();
  });

  it("vergrendeld: wijzigen alleen met een reden; dezelfde waarde opnieuw bewaren mag", () => {
    const locked = { ...base, locked: true, current: 0.35, rationale: "Basispercentage van vergelijkbare diensten" };
    expect(priorChangeError({ ...locked, prior: 0.65 })).toMatch(/vergrendeld/);
    expect(priorChangeError({ ...locked, prior: 0.65, reason: "Rekenfout in het basispercentage hersteld" })).toBeNull();
    expect(priorChangeError({ ...locked, prior: 0.35 })).toBeNull();
    // Terug naar 50% is ook een wijziging.
    expect(priorChangeError({ ...locked, prior: 0.5 })).toMatch(/vergrendeld/);
  });

  it("buiten 1%–99% of te lang: geweigerd", () => {
    expect(priorChangeError({ ...base, prior: 1 })).toMatch(/tussen 1% en 99%/);
    expect(priorChangeError({ ...base, prior: Number.NaN })).toMatch(/tussen 1% en 99%/);
    expect(priorChangeError({ ...base, prior: 0.8, rationale: "x".repeat(601) })).toMatch(/korter/);
  });

  it("databasefouten worden een begrijpelijke melding", () => {
    expect(priorDbError("PRIOR_LOCKED: er hangt bewijs")).toMatch(/vergrendeld/);
    expect(priorDbError("PRIOR_RATIONALE: x")).toMatch(/onderbouwing/);
    expect(priorDbError(null)).toMatch(/niet worden opgeslagen/);
  });
});
