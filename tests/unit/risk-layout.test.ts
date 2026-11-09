import { describe, expect, it } from "vitest";
import { DOT, layoutRiskPoints, MIN_GAP, type MapSize, type PlacedCluster, type PlacedDot } from "@/lib/domain/risk-layout";

const pt = (id: string, importance: number, evidence: number) => ({ id, importance, evidence });
const DESKTOP: MapSize = { width: 520, height: 313 };
const PHONE: MapSize = { width: 300, height: 313 };

const dist = (a: { left: number; top: number }, b: { left: number; top: number }) => Math.hypot(a.left - b.left, a.top - b.top);

// Geen twee stippen (of clusterknoppen) die elkaar raken, en alles binnen de kaart.
function expectClickable(out: (PlacedDot | PlacedCluster)[], size: MapSize, gap = DOT) {
  for (let i = 0; i < out.length; i++) {
    expect(out[i].left).toBeGreaterThanOrEqual(DOT / 2);
    expect(out[i].left).toBeLessThanOrEqual(size.width - DOT / 2);
    expect(out[i].top).toBeGreaterThanOrEqual(DOT / 2);
    expect(out[i].top).toBeLessThanOrEqual(size.height - DOT / 2);
    for (let j = i + 1; j < out.length; j++) expect(dist(out[i], out[j])).toBeGreaterThanOrEqual(gap);
  }
}

describe("risk map layout", () => {
  it("keeps separate points at their own position", () => {
    const out = layoutRiskPoints([pt("a", 5, 0), pt("b", 2, 0.9)], DESKTOP) as PlacedDot[];
    expect(out.map((d) => d.kind)).toEqual(["dot", "dot"]);
    // a: belangrijk en onwaarschijnlijk → rechtsboven; b: minder belangrijk en waarschijnlijk → linksonder.
    expect(out[0].left).toBeGreaterThan(out[1].left);
    expect(out[0].top).toBeLessThan(out[1].top);
  });

  it("spreads identical points so they never overlap", () => {
    const out = layoutRiskPoints([pt("a", 5, 0), pt("b", 5, 0), pt("c", 5, 0.02)], DESKTOP) as PlacedDot[];
    expect(out.map((d) => d.kind)).toEqual(["dot", "dot", "dot"]);
    expectClickable(out, DESKTOP);
    // deterministic
    expect(layoutRiskPoints([pt("a", 5, 0), pt("b", 5, 0), pt("c", 5, 0.02)], DESKTOP)).toEqual(out);
  });

  // Bevinding 3: de standaardset (twee keer belangrijkheid 5 en twee keer 4, alle op 50%) gaf 19px verschil tussen de
  // rijen, zodat punt 1 en 2 onder 4 en 5 lagen. Ook bijna-overlap tussen rijen moet nu uit elkaar.
  it.each([
    ["desktop", DESKTOP],
    ["telefoon", PHONE],
  ] as const)("keeps the default set of assumptions clickable on %s", (_, size) => {
    const points = [pt("1", 5, 0.5), pt("2", 5, 0.5), pt("3", 3, 0.5), pt("4", 4, 0.5), pt("5", 4, 0.5)];
    const out = layoutRiskPoints(points, size);
    expect(out.every((d) => d.kind === "dot")).toBe(true);
    expect(out).toHaveLength(5);
    expectClickable(out, size, MIN_GAP - 1);
    // Belangrijkere aannames blijven boven de minder belangrijke.
    const top = (id: string) => (out as PlacedDot[]).find((d) => d.id === id)!.top;
    expect(Math.max(top("1"), top("2"))).toBeLessThan(Math.min(top("4"), top("5")));
    expect(Math.max(top("4"), top("5"))).toBeLessThan(top("3"));
  });

  // Gebruikerstest C7: tot acht punten in een ring, pas vanaf negen een cluster.
  it.each([5, 6, 7, 8])("spreads %i points on one spot in a ring, each on its own position", (n) => {
    for (const size of [DESKTOP, PHONE]) {
      const out = layoutRiskPoints(Array.from({ length: n }, (_, i) => pt(`p${i}`, 4, 0.1)), size) as PlacedDot[];
      expect(out).toHaveLength(n);
      expect(out.every((d) => d.kind === "dot")).toBe(true);
      expectClickable(out, size);
    }
  });

  it("turns nine or more overlapping points into one cluster, in list order", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const out = layoutRiskPoints(ids.map((id) => pt(id, 4, 0.1)), DESKTOP);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "cluster", ids, indexes: [0, 1, 2, 3, 4, 5, 6, 7, 8] });
  });

  it("keeps positions inside the map, also with odd input", () => {
    expectClickable(layoutRiskPoints([pt("a", 1, 1), pt("b", 5, 0), pt("c", 9, -3), pt("d", Number.NaN, Number.NaN)], PHONE), PHONE);
  });

  it("never lets two dots overlap, for many random sets on desktop and phone", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let run = 0; run < 300; run++) {
      const n = 1 + Math.floor(rnd() * 12);
      const points = Array.from({ length: n }, (_, i) => pt(`p${i}`, 1 + Math.floor(rnd() * 5), Math.round(rnd() * 20) / 20));
      for (const size of [DESKTOP, PHONE]) {
        const out = layoutRiskPoints(points, size);
        expectClickable(out, size);
        // Elk punt staat er precies één keer in, als stip of in een cluster.
        const ids = out.flatMap((d) => (d.kind === "dot" ? [d.id] : d.ids)).sort();
        expect(ids).toEqual(points.map((p) => p.id).sort());
      }
    }
  });
});
