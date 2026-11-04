import { describe, expect, it } from "vitest";
import { decisionConfirmation, decisionSettled } from "@/lib/domain/decision-confirmation";

describe("decisionConfirmation (B1)", () => {
  it("wacht alleen op bevestiging als er een opdrachtgever is", () => {
    expect(decisionConfirmation(null, true)).toBe("awaiting");
    expect(decisionSettled(decisionConfirmation(null, true))).toBe(false);
  });

  it("is zonder opdrachtgever direct definitief, zonder een bevestiging te verzinnen", () => {
    expect(decisionConfirmation(null, false)).toBe("not_needed");
    expect(decisionSettled("not_needed")).toBe(true);
  });

  it("is bevestigd met een bevestigingsmoment, met of zonder opdrachtgever", () => {
    expect(decisionConfirmation("2026-11-03T10:00:00Z", true)).toBe("confirmed");
    expect(decisionConfirmation("2026-11-03T10:00:00Z", false)).toBe("confirmed");
  });
});
