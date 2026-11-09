import { describe, expect, it } from "vitest";
import { computeSizing } from "@/lib/domain/sizing";

// Zonder basisaantal is TAM/SAM/SOM onbekend, niet 0 (gebruikersreview: formule zei "onbekend", tegels "0").
describe("computeSizing countsKnown", () => {
  it("zonder basisaantal is geen enkele laag bekend", () => {
    const r = computeSizing("b2b_accounts", [
      { key: "fit_pct", value: 20 }, { key: "reach_pct", value: 50 }, { key: "winnable_pct", value: 10 },
    ] as never);
    expect(r.countsKnown).toEqual({ tam: false, sam: false, som: false });
  });
  it("met alle factoren zijn alle lagen bekend", () => {
    const r = computeSizing("b2b_accounts", [
      { key: "base_count", value: 1000 }, { key: "fit_pct", value: 20 }, { key: "reach_pct", value: 50 }, { key: "winnable_pct", value: 10 },
    ] as never);
    expect(r.countsKnown).toEqual({ tam: true, sam: true, som: true });
  });
});
