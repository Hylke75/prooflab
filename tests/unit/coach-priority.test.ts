import { describe, expect, it } from "vitest";
import { byNotePriority, NOTES_SHOWN } from "@/lib/coach/rules";

describe("coachnotities: volgorde (systeemcontrole)", () => {
  it("toont eerst Let op en Vraag, dan tips en complimenten; binnen een soort de nieuwste eerst", () => {
    const notes = [
      { id: "a", kind: "praise", created_at: "2026-11-04T10:00:00Z" },
      { id: "b", kind: "tip", created_at: "2026-11-04T09:00:00Z" },
      { id: "c", kind: "warning", created_at: "2026-11-01T09:00:00Z" },
      { id: "d", kind: "warning", created_at: "2026-11-03T09:00:00Z" },
      { id: "e", kind: "question", created_at: "2026-11-02T09:00:00Z" },
    ];
    expect(byNotePriority(notes).map((n) => n.id)).toEqual(["d", "c", "e", "b", "a"]);
    expect(notes[0].id).toBe("a"); // de invoer blijft ongewijzigd
    expect(NOTES_SHOWN).toBe(3);
  });
});
