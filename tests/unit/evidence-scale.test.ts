import { describe, expect, it } from "vitest";
import { EVIDENCE_LEVELS, KIND_LEVEL } from "@/lib/domain/evidence";
import { EVIDENCE_SCALE, ladderRungs, scaleIndex, scaleLabel, scaleOf, scaleOfKind } from "@/lib/domain/evidence-scale";
import { EVIDENCE_LADDER, evidenceLadder } from "@/lib/domain/dossier-label";

// Fase 1, punt 2: één bewijsschaal, gekoppeld aan de bewijsniveaus van de kansberekening.
describe("bewijsschaal", () => {
  it("vijf treden in vaste volgorde", () => {
    expect(EVIDENCE_SCALE.map((s) => s.label)).toEqual(["Verkenning", "Mening", "Gedrag", "Betaling", "Herhaling"]);
    expect(scaleIndex("payment")).toBe(3);
    expect(scaleLabel("behaviour")).toBe("Gedrag");
  });

  it("elk bewijsniveau staat op precies één trede", () => {
    for (const { level } of EVIDENCE_LEVELS) expect(EVIDENCE_SCALE.filter((s) => s.levels.includes(level))).toHaveLength(1);
    expect(scaleOf(null)).toBe("exploration");
    expect(scaleOf("opinion")).toBe("opinion");
    expect([scaleOf("problem"), scaleOf("small_action"), scaleOf("quote")]).toEqual(["behaviour", "behaviour", "behaviour"]);
    expect(scaleOf("deposit")).toBe("payment");
    expect(scaleOf("repeat")).toBe("repeat");
  });

  it("demo-aanvraag is overal een kleine handeling (gedrag)", () => {
    expect(KIND_LEVEL.demo_request).toBe("small_action");
    expect(scaleOfKind("demo_request")).toBe("behaviour");
    const rung = EVIDENCE_LADDER.find((r) => r.kinds.includes("demo_request"))!;
    expect(rung.level).toBe("small_action");
    expect(rung.label).toBe("Kleine handeling (aanmelding, demo-aanvraag)");
    expect(EVIDENCE_LADDER.find((r) => r.level === "quote")!.kinds).toEqual(["quote_request"]);
    expect(evidenceLadder([{ kind: "demo_request", interviewId: null, isSynthetic: false }]).highest).toMatchObject({ level: "small_action", step: "behaviour" });
  });

  it("de ladder volgt KIND_LEVEL, zonder tegenbewijs, 'overig' en enquêtes", () => {
    for (const r of ladderRungs()) for (const k of r.kinds) expect(KIND_LEVEL[k as keyof typeof KIND_LEVEL]).toBe(r.level);
    const all = EVIDENCE_LADDER.flatMap((r) => r.kinds);
    for (const k of ["objection", "problem_absent", "counter_example", "other", "survey_answer"]) expect(all).not.toContain(k);
    expect(EVIDENCE_LADDER.map((r) => r.level)).toEqual(["opinion", "problem", "small_action", "quote", "deposit", "repeat"]);
  });
});
