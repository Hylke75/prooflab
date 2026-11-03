import { describe, expect, it } from "vitest";
import { BRIER_FEW_OUTCOMES, BRIER_MIN_OUTCOMES, brierWarning } from "@/lib/domain/forecast";

// Golf A, punt 16: onder 30 uitkomsten een waarschuwing bij elke Brier-score.
describe("waarschuwing bij Brier-scores", () => {
  it("onder 30 uitkomsten: te weinig dossiers voor een betrouwbaar oordeel", () => {
    expect(BRIER_MIN_OUTCOMES).toBe(30);
    expect(BRIER_FEW_OUTCOMES).toBe("te weinig dossiers voor een betrouwbaar oordeel");
    expect(brierWarning(0)).toBe("0 van de minimaal 30 uitkomsten: te weinig dossiers voor een betrouwbaar oordeel.");
    expect(brierWarning(29)).toMatch(/^29 van de minimaal 30/);
  });

  it("vanaf 30 uitkomsten geen waarschuwing", () => {
    expect(brierWarning(30)).toBeNull();
    expect(brierWarning(120)).toBeNull();
  });
});
