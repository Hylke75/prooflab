import { describe, expect, it } from "vitest";
import { belowMinSample, checkEnd, THRESHOLD_UNREACHABLE, thresholdBlock } from "@/lib/domain/experiment-gates";

describe("thresholdBlock (B0 punt 6)", () => {
  it("blokkeert als er een beslisregel is maar geen haalbaar aantal", () => {
    expect(thresholdBlock({ decision_rule: "probability", required_n: null })).toBe(THRESHOLD_UNREACHABLE);
    expect(thresholdBlock({ decision_rule: "absolute", required_n: null })).toBe(THRESHOLD_UNREACHABLE);
    expect(THRESHOLD_UNREACHABLE).toBe("De drempel is met deze test niet aantoonbaar te halen. Kies een ander testtype of verleng de looptijd.");
  });
  it("laat een haalbare drempel en de intervalregel (zonder beslisregel) door", () => {
    expect(thresholdBlock({ decision_rule: "probability", required_n: 120 })).toBeNull();
    expect(thresholdBlock({ decision_rule: null, required_n: null })).toBeNull();
  });
});

describe("checkEnd (B0 punt 6)", () => {
  it("vraagt niets bij een volledige steekproef", () => {
    expect(belowMinSample(8, 8)).toBe(false);
    expect(checkEnd({ n: 8, minSample: 8, reason: "", confirmed: false })).toEqual({ ok: true, endReason: null });
    expect(checkEnd({ n: 12, minSample: 8, reason: "wordt niet bewaard", confirmed: true })).toEqual({ ok: true, endReason: null });
  });
  it("eist onder de steekproef een reden van minstens 10 tekens", () => {
    expect(belowMinSample(3, 8)).toBe(true);
    const r = checkEnd({ n: 3, minSample: 8, reason: "  te kort ", confirmed: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("3 van minimaal 8");
  });
  it("eist onder de steekproef de bevestiging", () => {
    const r = checkEnd({ n: 3, minSample: 8, reason: "De opdrachtgever stopt het project.", confirmed: false });
    expect(r.ok).toBe(false);
  });
  it("geeft de reden terug (ingekort tot 600 tekens) als alles klopt", () => {
    expect(checkEnd({ n: 3, minSample: 8, reason: "  De opdrachtgever stopt het project. ", confirmed: true })).toEqual({ ok: true, endReason: "De opdrachtgever stopt het project." });
    const long = checkEnd({ n: 0, minSample: 8, reason: "x".repeat(700), confirmed: true });
    expect(long.ok && long.endReason?.length).toBe(600);
  });
  it("zonder minimale steekproef is er niets te bevestigen", () => {
    expect(belowMinSample(0, null)).toBe(false);
  });
});
