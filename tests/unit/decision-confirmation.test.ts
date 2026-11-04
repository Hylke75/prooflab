import { describe, expect, it } from "vitest";
import { CONFIRMATION_LABELS, decisionConfirmation, decisionSettled } from "@/lib/domain/decision-confirmation";

describe("decisionConfirmation (B1)", () => {
  it("wacht alleen op bevestiging als er een opdrachtgever is", () => {
    expect(decisionConfirmation(null, true, "continue")).toBe("awaiting");
    expect(decisionSettled(decisionConfirmation(null, true, "stop"))).toBe(false);
  });

  it("is zonder opdrachtgever direct definitief, zonder een bevestiging te verzinnen", () => {
    expect(decisionConfirmation(null, false, "continue")).toBe("not_needed");
    expect(decisionSettled("not_needed")).toBe(true);
  });

  it("is bevestigd met een bevestigingsmoment, met of zonder opdrachtgever", () => {
    expect(decisionConfirmation("2026-11-03T10:00:00Z", true, "continue")).toBe("confirmed");
    expect(decisionConfirmation("2026-11-03T10:00:00Z", false, "stop")).toBe("confirmed");
  });
});

describe("decisionConfirmation: tussenbesluit (gebruikerstest D1)", () => {
  it.each(["test_more", "extend", "adjust", "pause"])("%s is nooit definitief, met of zonder opdrachtgever", (action) => {
    for (const hasClient of [true, false]) {
      for (const at of [null, "2026-11-03T10:00:00Z"]) {
        const c = decisionConfirmation(at, hasClient, action);
        expect(c).toBe("not_final");
        expect(decisionSettled(c)).toBe(true);
        expect(CONFIRMATION_LABELS[c]).toBe("Tussenbesluit: nog geen definitief besluit");
      }
    }
  });
});
