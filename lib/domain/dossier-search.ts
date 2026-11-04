// Zoeken binnen een dossier: de pure delen (zoekterm opschonen en veilig maken, resultaten groeperen, de
// zoekterm markeren en de link naar de juiste plek). De queries zelf staan in lib/dossier-search.ts.
//
// Veiligheid: de zoekterm gaat nooit in een PostgREST-filterstring (.or("…")), waar komma's, punten en haakjes
// een eigen betekenis hebben. Elke kolom krijgt een eigen .ilike(kolom, patroon); het patroon is een gewone
// waarde in de querystring. Binnen het patroon zijn alleen de LIKE-jokers bijzonder: \ % _ worden ge-escaped en
// een * (dat PostgREST als % leest) wordt _, zodat het hooguit één willekeurig teken betekent.

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;
export const SEARCH_MAX_WORDS = 5;
export const SEARCH_MAX_RESULTS = 30;

export type SearchKind = "claim" | "assumption" | "source" | "note";

export const SEARCH_KIND_LABELS: Record<SearchKind, string> = {
  claim: "Bevindingen",
  assumption: "Aannames",
  source: "Bronnen",
  note: "Eigen notities",
};

export const SEARCH_KIND_ORDER: SearchKind[] = ["claim", "assumption", "source", "note"];

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string; // de hoofdtekst van het resultaat (bewering, titel van de bron of notitie)
  detail: string | null; // extra regel: uitgever en adres van een bron, een stukje van de notitie
  badge: string | null; // korte status, bijv. "Geverifieerd" of "Tegenbewijs"
  href: string;
};

export type SearchGroup = { kind: SearchKind; label: string; hits: SearchHit[] };

// De woorden waarop gezocht wordt: getrimd, witruimte samengevoegd, hooguit 100 tekens en 5 woorden.
// Null als er te weinig over blijft om zinvol te zoeken.
export function searchWords(raw: unknown): string[] | null {
  if (typeof raw !== "string") return null;
  const clean = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_LENGTH).trim();
  if (clean.length < SEARCH_MIN_LENGTH) return null;
  const words = [...new Set(clean.split(" ").map((w) => w.toLowerCase()))].filter(Boolean).slice(0, SEARCH_MAX_WORDS);
  return words.length ? words : null;
}

// LIKE-patroon voor één woord: "deel" → "%deel%". Jokers in de invoer tellen als gewone tekens.
export function ilikePattern(word: string): string {
  const escaped = word.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, "_");
  return `%${escaped}%`;
}

// Alle woorden moeten in de tekst staan, hoofdletterongevoelig en met dezelfde betekenis als ilikePattern: alles
// letterlijk, behalve * (één willekeurig teken).
export function matchesAll(text: string | null | undefined, words: string[]): boolean {
  const t = (text ?? "").toLowerCase();
  return words.every((w) => {
    if (!w.includes("*")) return t.includes(w.toLowerCase());
    const re = new RegExp(w.toLowerCase().split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("."), "s");
    return re.test(t);
  });
}

// Resultaten per soort, in vaste volgorde, zonder dubbelen en met hooguit SEARCH_MAX_RESULTS in totaal. Het
// maximum wordt eerlijk verdeeld (om de beurt één per soort), zodat veel bevindingen de bronnen niet wegdrukken.
export function groupHits(hits: SearchHit[], max = SEARCH_MAX_RESULTS): { groups: SearchGroup[]; total: number; truncated: boolean } {
  const seen = new Set<string>();
  const perKind = new Map<SearchKind, SearchHit[]>(SEARCH_KIND_ORDER.map((k) => [k, []]));
  for (const h of hits) {
    const key = `${h.kind}:${h.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    perKind.get(h.kind)?.push(h);
  }
  const all = [...perKind.values()].reduce((n, l) => n + l.length, 0);
  const taken = new Map<SearchKind, SearchHit[]>(SEARCH_KIND_ORDER.map((k) => [k, []]));
  let count = 0;
  for (let round = 0; count < max; round++) {
    let added = false;
    for (const k of SEARCH_KIND_ORDER) {
      const list = perKind.get(k)!;
      if (round < list.length && count < max) {
        taken.get(k)!.push(list[round]);
        count++;
        added = true;
      }
    }
    if (!added) break;
  }
  const groups = SEARCH_KIND_ORDER.filter((k) => taken.get(k)!.length > 0).map((k) => ({ kind: k, label: SEARCH_KIND_LABELS[k], hits: taken.get(k)! }));
  return { groups, total: count, truncated: all > count };
}

export type Segment = { text: string; match: boolean };

// Splitst een tekst in stukken met en zonder zoekterm (hoofdletterongevoelig), voor <mark>. Overlappende of
// aansluitende treffers worden samengevoegd.
export function highlightSegments(text: string, words: string[]): Segment[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const w of words) {
    if (!w) continue;
    let i = lower.indexOf(w);
    while (i !== -1) {
      ranges.push([i, i + w.length]);
      i = lower.indexOf(w, i + 1);
    }
  }
  if (ranges.length === 0) return [{ text, match: false }];
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const out: Segment[] = [];
  let pos = 0;
  for (const [a, b] of merged) {
    if (a > pos) out.push({ text: text.slice(pos, a), match: false });
    out.push({ text: text.slice(a, b), match: true });
    pos = b;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), match: false });
  return out;
}

// Een stukje lange tekst rond de eerste treffer (voor notities), met … waar ingekort is.
export function snippetAround(text: string, words: string[], max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const lower = flat.toLowerCase();
  const first = Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0), Number.POSITIVE_INFINITY);
  const start = Number.isFinite(first) ? Math.max(0, Math.min(first - Math.floor(max / 3), flat.length - max)) : 0;
  const part = flat.slice(start, start + max).trim();
  return `${start > 0 ? "…" : ""}${part}${start + max < flat.length ? "…" : ""}`;
}

// Stap van een notitie → pagina van die stap (zelfde indeling als lib/steps.ts).
const NOTE_STEP_PATH: Record<string, string> = {
  overview: "",
  market: "/research",
  assumptions: "/assumptions",
  test: "/experiments",
  decide: "/evidence",
};

// De plek waar een resultaat staat: bevinding → marktbeeld met anker, aanname → geselecteerd op de risicokaart,
// bron → tab Bronnen met anker, notitie → de pagina van haar stap.
export function hitHref(ideaId: string, kind: SearchKind, id: string, step?: string | null): string {
  const base = `/app/ideas/${ideaId}`;
  switch (kind) {
    case "claim":
      return `${base}/research?tab=overview#claim-${id}`;
    case "assumption":
      return `${base}/assumptions?select=${encodeURIComponent(id)}`;
    case "source":
      return `${base}/research?tab=sources#bron-${id}`;
    case "note":
      return `${base}${NOTE_STEP_PATH[step ?? ""] ?? ""}`;
  }
}
