import { describe, expect, it } from "vitest";
import { pickDueForRecheck, recheckNote, RECHECK_DAYS } from "@/lib/domain/recheck";
import { planNoteChanges } from "@/lib/coach/rules";

const now = new Date("2026-11-10T09:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const comp = (id: string, over: Partial<Parameters<typeof pickDueForRecheck>[0][number]> = {}) => ({
  id,
  kind: "direct",
  website: "https://voorbeeld.nl",
  hasLinkedSource: false,
  last_checked_at: daysAgo(RECHECK_DAYS + 5),
  created_at: daysAgo(90),
  origin: "manual",
  ...over,
});

describe("automatische maandelijkse concurrentiecontrole", () => {
  it("kiest alleen wat over tijd is en iets op te halen heeft; voorstellen en niets doen nooit", () => {
    const list = [
      comp("vers", { last_checked_at: daysAgo(3) }),
      comp("oud"),
      comp("voorstel", { origin: "proposal" }),
      comp("niets-doen", { kind: "status_quo", website: null }),
      comp("zonder-bron", { website: null, hasLinkedSource: false }),
      comp("met-bron", { website: null, hasLinkedSource: true }),
    ];
    expect(pickDueForRecheck(list, now).map((c) => c.id)).toEqual(["oud", "met-bron"]);
  });

  it("de langst niet gecontroleerde eerst, hooguit drie per keer; nooit gecontroleerd telt vanaf aanmaken", () => {
    const list = [comp("a", { last_checked_at: daysAgo(40) }), comp("b", { last_checked_at: daysAgo(100) }), comp("c", { last_checked_at: null, created_at: daysAgo(60) }), comp("d", { last_checked_at: daysAgo(35) })];
    expect(pickDueForRecheck(list, now).map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(pickDueForRecheck([comp("nieuw", { last_checked_at: null, created_at: daysAgo(2) })], now)).toEqual([]);
  });

  it("de tip noemt wat veranderde, verwijst naar Concurrenten en heeft één code per aanbieder per maand", () => {
    const n = recheckNote({ id: "12345678-aaaa", name: "Concurrent X" }, ["De vastgelegde prijs staat niet meer letterlijk op de website."], "idee-1", now);
    expect(n.code).toBe("recheck:12345678:2026-11");
    expect(n.kind).toBe("warning");
    expect(n.title).toContain("Concurrent X");
    expect(n.body).toContain("prijs");
    expect(n.body).toContain("Niets is verwijderd");
    expect(n.href).toBe("/app/ideas/idee-1/research?tab=competitors");
    expect(recheckNote({ id: "x", name: "y" }, ["z".repeat(2000)], "i", now).body.length).toBeLessThanOrEqual(1200);
  });

  it("de coach sluit tips van de controle niet zelf", () => {
    const plan = planNoteChanges([], [{ id: "n1", code: "recheck:12345678:2026-11", source: "rules", status: "open", resolvedAt: null }], now.getTime());
    expect(plan.close).toEqual([]);
  });
});
