// Placement of points on the assumption map (importance × evidence). Points that would overlap are
// spread deterministically around their shared position; more than MAX_SPREAD become one cluster badge.
// Gebruikerstest C7: tot acht punten op één plek worden in een ring gespreid (vroeger vier); pas daarboven een cluster.

export type RiskPoint = { id: string; importance: number; evidence: number };

// spread: de grootste afstand (px) van een gespreid punt tot het gedeelde midden, zodat het scherm het midden zo ver van de
// rand houdt dat de hele ring binnen de kaart valt.
export type PlacedDot = { kind: "dot"; id: string; index: number; x: number; y: number; dx: number; dy: number; spread: number };
export type PlacedCluster = { kind: "cluster"; key: string; ids: string[]; indexes: number[]; x: number; y: number };

// Overlap threshold along the evidence axis, in % of the map width. Dots are 39px wide; at the
// narrowest map (≈300px on a phone) 14% is ≈42px. Importance levels are 21% (≈66px) apart vertically.
const NEAR_X = 14;
const OFFSETS: Record<number, [number, number][]> = {
  2: [[-22, 0], [22, 0]],
  3: [[-23, 12], [23, 12], [0, -28]],
  4: [[-22, -22], [22, -22], [-22, 22], [22, 22]],
};
export const MAX_SPREAD = 8;
// Minimale afstand tussen twee middens in een ring: stip van 39px plus een kleine marge.
const RING_GAP = 44;

// Vijf tot acht punten: gelijk verdeeld op een cirkel, de eerste bovenaan, met de klok mee. De straal is zo gekozen dat
// buren minstens RING_GAP uit elkaar liggen (koorde 2r·sin(π/n)).
export function ringOffsets(n: number): [number, number][] {
  const r = Math.ceil(RING_GAP / (2 * Math.sin(Math.PI / n)));
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))] as [number, number];
  });
}

function offsetsFor(n: number): [number, number][] {
  return OFFSETS[n] ?? ringOffsets(n);
}

export function basePosition(p: { importance: number; evidence: number }): { x: number; y: number } {
  const ev = Math.min(1, Math.max(0, p.evidence));
  const imp = Math.min(5, Math.max(1, p.importance));
  return { x: 8 + (1 - ev) * 84, y: 92 - ((imp - 1) / 4) * 84 };
}

export function layoutRiskPoints(points: RiskPoint[]): (PlacedDot | PlacedCluster)[] {
  const placed = points.map((p, index) => ({ ...p, index, ...basePosition(p) }));
  const groups: (typeof placed)[] = [];
  for (const level of [...new Set(placed.map((p) => Math.round(p.y * 100)))]) {
    const row = placed.filter((p) => Math.round(p.y * 100) === level).sort((a, b) => a.x - b.x || a.index - b.index);
    let current: typeof placed = [];
    for (const p of row) {
      if (current.length && p.x - current[current.length - 1].x > NEAR_X) {
        groups.push(current);
        current = [];
      }
      current.push(p);
    }
    if (current.length) groups.push(current);
  }
  const out: (PlacedDot | PlacedCluster)[] = [];
  for (const g of groups) {
    const members = [...g].sort((a, b) => a.index - b.index);
    const x = members.reduce((n, p) => n + p.x, 0) / members.length;
    const y = members[0].y;
    if (members.length === 1) {
      out.push({ kind: "dot", id: members[0].id, index: members[0].index, x, y, dx: 0, dy: 0, spread: 0 });
    } else if (members.length <= MAX_SPREAD) {
      const offsets = offsetsFor(members.length);
      const spread = Math.max(...offsets.map(([dx, dy]) => Math.max(Math.abs(dx), Math.abs(dy))));
      members.forEach((p, i) => {
        const [dx, dy] = offsets[i];
        out.push({ kind: "dot", id: p.id, index: p.index, x, y, dx, dy, spread });
      });
    } else {
      out.push({ kind: "cluster", key: members.map((p) => p.id).join("|"), ids: members.map((p) => p.id), indexes: members.map((p) => p.index), x, y });
    }
  }
  return out.sort((a, b) => (a.kind === "dot" ? a.index : a.indexes[0]) - (b.kind === "dot" ? b.index : b.indexes[0]));
}
