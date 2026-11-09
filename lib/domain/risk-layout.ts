// Placement of points on the assumption map (importance × evidence), in pixels of the measured map. Points whose
// centres would lie closer than a touch target (44px) are grouped and spread deterministically around their shared
// centre; groups whose spread dots would still touch another group are merged, until no two dots overlap. More than
// MAX_SPREAD points in one group become one cluster badge.
// Gebruikerstest C7: tot acht punten op één plek worden in een ring gespreid; pas daarboven een cluster.
// Bevinding 3 (bruikbaarheidsreview): vroeger werd alleen binnen één rij (zelfde belangrijkheid) gegroepeerd en daarna in
// het scherm tegen de rand geklemd. Daardoor lagen punten van twee rijen half over elkaar (19px bij 39px stippen) en
// waren ze niet klikbaar. Nu rekent de indeling in pixels, inclusief de randmarge, en controleert alle paren.

export type RiskPoint = { id: string; importance: number; evidence: number };
export type MapSize = { width: number; height: number };

// left/top: het midden van de stip in pixels vanaf de linkerbovenhoek van de kaart.
export type PlacedDot = { kind: "dot"; id: string; index: number; left: number; top: number };
export type PlacedCluster = { kind: "cluster"; key: string; ids: string[]; indexes: number[]; left: number; top: number };

export const DOT = 39;
// Minimale afstand tussen twee middens: het aanraakdoel van 44px, zodat ook de klikvlakken elkaar niet overlappen.
export const MIN_GAP = 44;
export const MAX_SPREAD = 8;
// Afstand van een midden tot de rand: ruimte voor de aslabels linksboven en linksonder.
const MARGIN_X = 46;
const MARGIN_Y = 50;
// Standaardmaat vóór de eerste meting (desktopkaart); het scherm meet daarna de echte maat.
export const DEFAULT_MAP: MapSize = { width: 520, height: 313 };

const OFFSETS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-22, 0], [22, 0]],
  3: [[-23, 12], [23, 12], [0, -28]],
  4: [[-22, -22], [22, -22], [-22, 22], [22, 22]],
};

// Vijf tot acht punten: gelijk verdeeld op een cirkel, de eerste bovenaan, met de klok mee. De straal is zo gekozen dat
// buren minstens MIN_GAP uit elkaar liggen (koorde 2r·sin(π/n)).
export function ringOffsets(n: number): [number, number][] {
  const r = Math.ceil(MIN_GAP / (2 * Math.sin(Math.PI / n)));
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))] as [number, number];
  });
}

function offsetsFor(n: number): [number, number][] {
  return OFFSETS[n] ?? ringOffsets(n);
}

// Position in % of the map (x: more likely true = further left; y: more important = higher).
export function basePosition(p: { importance: number; evidence: number }): { x: number; y: number } {
  const ev = Math.min(1, Math.max(0, Number.isFinite(p.evidence) ? p.evidence : 0.5));
  const imp = Math.min(5, Math.max(1, Number.isFinite(p.importance) ? p.importance : 3));
  return { x: 8 + (1 - ev) * 84, y: 92 - ((imp - 1) / 4) * 84 };
}

const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));

type Base = RiskPoint & { index: number; bx: number; by: number };

function placeGroup(members: Base[], size: MapSize): (PlacedDot | PlacedCluster)[] {
  const mx = members.reduce((n, p) => n + p.bx, 0) / members.length;
  const my = members.reduce((n, p) => n + p.by, 0) / members.length;
  if (members.length > MAX_SPREAD) {
    const byIndex = [...members].sort((a, b) => a.index - b.index);
    return [
      {
        kind: "cluster",
        key: byIndex.map((p) => p.id).join("|"),
        ids: byIndex.map((p) => p.id),
        indexes: byIndex.map((p) => p.index),
        left: clamp(mx, MARGIN_X, size.width - MARGIN_X),
        top: clamp(my, MARGIN_Y, size.height - MARGIN_Y),
      },
    ];
  }
  const offsets = offsetsFor(members.length);
  const spreadX = Math.max(...offsets.map(([dx]) => Math.abs(dx)));
  const spreadY = Math.max(...offsets.map(([, dy]) => Math.abs(dy)));
  // Het midden blijft zo ver van de rand dat de hele groep binnen de kaart valt.
  const cx = clamp(mx, MARGIN_X + spreadX, size.width - MARGIN_X - spreadX);
  const cy = clamp(my, MARGIN_Y + spreadY, size.height - MARGIN_Y - spreadY);
  // Elk punt krijgt de vrije plek die het dichtst bij zijn eigen richting ligt (belangrijker = hoger, kleinere kans =
  // verder rechts), in vaste volgorde: van boven naar beneden, dan van links naar rechts, dan de lijstvolgorde.
  const free = offsets.map((o, i) => ({ o, i }));
  const out: PlacedDot[] = [];
  for (const p of [...members].sort((a, b) => a.by - b.by || a.bx - b.bx || a.index - b.index)) {
    const vx = p.bx - mx;
    const vy = p.by - my;
    let best = 0;
    for (let k = 1; k < free.length; k++) {
      const d = (o: [number, number]) => (o[0] - vx) ** 2 + (o[1] - vy) ** 2;
      if (d(free[k].o) < d(free[best].o) - 1e-9) best = k;
    }
    const [dx, dy] = free[best].o;
    free.splice(best, 1);
    out.push({ kind: "dot", id: p.id, index: p.index, left: cx + dx, top: cy + dy });
  }
  return out;
}

const first = (p: PlacedDot | PlacedCluster) => (p.kind === "dot" ? p.index : p.indexes[0]);

export function layoutRiskPoints(points: RiskPoint[], size: MapSize = DEFAULT_MAP): (PlacedDot | PlacedCluster)[] {
  const base: Base[] = points.map((p, index) => {
    const { x, y } = basePosition(p);
    return { ...p, index, bx: clamp((x / 100) * size.width, MARGIN_X, size.width - MARGIN_X), by: clamp((y / 100) * size.height, MARGIN_Y, size.height - MARGIN_Y) };
  });
  // Start: elk punt een eigen groep. Zolang twee stippen van verschillende groepen te dicht bij elkaar liggen, worden
  // die groepen samengevoegd en opnieuw gespreid. Elke ronde voegt samen of stopt, dus dit eindigt na hooguit n rondes.
  let groups: Base[][] = base.map((p) => [p]);
  for (;;) {
    const placed = groups.map((g) => placeGroup(g, size));
    let merge: [number, number] | null = null;
    outer: for (let a = 0; a < placed.length; a++)
      for (let b = a + 1; b < placed.length; b++)
        for (const p of placed[a])
          for (const q of placed[b])
            if (Math.hypot(p.left - q.left, p.top - q.top) < MIN_GAP - 0.01) {
              merge = [a, b];
              break outer;
            }
    if (!merge) return placed.flat().sort((p, q) => first(p) - first(q));
    const [a, b] = merge;
    groups = [...groups.filter((_, i) => i !== a && i !== b), [...groups[a], ...groups[b]]];
  }
}
