import { describe, expect, it } from "vitest";
import { layoutRiskPoints, type PlacedDot } from "@/lib/domain/risk-layout";

const pt = (id: string, importance: number, evidence: number) => ({ id, importance, evidence });

describe("risk map layout", () => {
  it("keeps separate points at their own position", () => {
    const out = layoutRiskPoints([pt("a", 5, 0), pt("b", 2, 0.9)]);
    expect(out).toHaveLength(2);
    expect(out.every((d) => d.kind === "dot" && d.dx === 0 && d.dy === 0)).toBe(true);
  });

  it("spreads identical points so they never overlap", () => {
    const out = layoutRiskPoints([pt("a", 5, 0), pt("b", 5, 0), pt("c", 5, 0.02)]) as PlacedDot[];
    expect(out.map((d) => d.kind)).toEqual(["dot", "dot", "dot"]);
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) expect(Math.hypot(out[i].dx - out[j].dx, out[i].dy - out[j].dy)).toBeGreaterThanOrEqual(39);
    // deterministic
    expect(layoutRiskPoints([pt("a", 5, 0), pt("b", 5, 0), pt("c", 5, 0.02)])).toEqual(out);
  });

  // Gebruikerstest C7: tot acht punten in een ring, pas vanaf negen een cluster.
  it.each([5, 6, 7, 8])("spreads %i points on one spot in a ring, each on its own position", (n) => {
    const out = layoutRiskPoints(Array.from({ length: n }, (_, i) => pt(`p${i}`, 4, 0.1))) as PlacedDot[];
    expect(out).toHaveLength(n);
    expect(out.every((d) => d.kind === "dot")).toBe(true);
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) expect(Math.hypot(out[i].dx - out[j].dx, out[i].dy - out[j].dy)).toBeGreaterThanOrEqual(39);
    expect(new Set(out.map((d) => `${d.dx},${d.dy}`)).size).toBe(n);
    expect(out.every((d) => d.spread >= Math.max(Math.abs(d.dx), Math.abs(d.dy)))).toBe(true);
  });

  it("turns nine or more overlapping points into one cluster, in list order", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const out = layoutRiskPoints(ids.map((id) => pt(id, 4, 0.1)));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "cluster", ids, indexes: [0, 1, 2, 3, 4, 5, 6, 7, 8] });
  });

  it("keeps positions inside the map", () => {
    for (const d of layoutRiskPoints([pt("a", 1, 1), pt("b", 5, 0), pt("c", 9, -3)])) {
      expect(d.x).toBeGreaterThanOrEqual(8);
      expect(d.x).toBeLessThanOrEqual(92);
      expect(d.y).toBeGreaterThanOrEqual(8);
      expect(d.y).toBeLessThanOrEqual(92);
    }
  });
});
