// Fase 1 · punt 3: thema's over interviews heen. Pure regels voor de AI-voorstellen (alleen citaten die letterlijk
// in het transcript staan, met hun positie, blijven over; zelfde patroon als filterProposals bij rapportimport) en
// het label van een thema. Thema's tellen nooit mee in de kans: geen enkele kansberekening leest deze module.

import { MAX_QUOTE_CHARS, MIN_QUOTE_CHARS } from "./quote-marking";
import type { StoredSegment } from "./transcript-parse";
import { normalizeText } from "./verify";

export const THEME_LABEL_MIN = 3;
export const THEME_LABEL_MAX = 80;
export const THEMES_NEVER_COUNT = "Thema's tellen nooit mee in de kans: alleen een citaat dat je expliciet aan een aanname koppelt, doet dat.";
// Hoogstens zoveel vensters per AI-ronde (ongeveer 240.000 tekens): kosten blijven voorspelbaar.
export const MAX_THEME_WINDOWS = 6;

export type RawTheme = { label: string; description: string; quotes: string[] };
export type LocatedQuote = { quote: string; start: number; end: number; segmentIndex: number };
export type KeptTheme = { label: string; description: string; quotes: LocatedQuote[] };
export type ThemeFilter = { themes: KeptTheme[]; notFound: number; duplicates: number; invalidLabels: number };

export function cleanThemeLabel(raw: string): string | null {
  const label = raw.replace(/\s+/g, " ").trim().replace(/^["'“”‘’]+|["'“”‘’.]+$/g, "").trim();
  if (label.length < THEME_LABEL_MIN || label.length > THEME_LABEL_MAX) return null;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export const labelKey = (label: string) => normalizeText(label);

// Een citaat in het transcript terugvinden binnen [from, to): eerst exact, dan zonder hoofdlettergevoeligheid. Het
// moet binnen één uitspraak (segment) vallen en mag de kop (tijd en spreker) niet bevatten.
export function locateInWindow(transcript: string, quote: string, segments: StoredSegment[], from = 0, to = transcript.length): LocatedQuote | null {
  const q = quote.trim().replace(/^["“'‘]+|["”'’]+$/g, "").replace(/\s+/g, " ").trim();
  if (q.length < MIN_QUOTE_CHARS || q.length > MAX_QUOTE_CHARS) return null;
  const tryFind = (hay: string, needle: string) => {
    let i = hay.indexOf(needle, from);
    while (i >= 0 && i + needle.length <= to) {
      const seg = segments.findIndex((s) => i >= s.a && i + needle.length <= s.b);
      if (seg >= 0) return { start: i, end: i + needle.length, segmentIndex: seg };
      i = hay.indexOf(needle, i + 1);
    }
    return null;
  };
  const hit = tryFind(transcript, q) ?? tryFind(transcript.toLowerCase(), q.toLowerCase());
  return hit ? { quote: transcript.slice(hit.start, hit.end), ...hit } : null;
}

// Alleen voorstellen met letterlijk teruggevonden citaten blijven. Hetzelfde label (ook uit een ander venster) wordt
// samengevoegd; hetzelfde citaat telt één keer per thema. Een thema zonder geldig citaat valt af.
export function filterThemeProposals(raw: RawTheme[], transcript: string, segments: StoredSegment[], window?: { start: number; end: number }): ThemeFilter {
  const byLabel = new Map<string, KeptTheme>();
  let notFound = 0;
  let duplicates = 0;
  let invalidLabels = 0;
  for (const t of raw) {
    const label = cleanThemeLabel(t.label ?? "");
    if (!label) {
      invalidLabels++;
      continue;
    }
    const key = labelKey(label);
    const theme = byLabel.get(key) ?? { label, description: (t.description ?? "").replace(/\s+/g, " ").trim().slice(0, 400), quotes: [] };
    for (const q of t.quotes ?? []) {
      const loc = locateInWindow(transcript, q, segments, window?.start ?? 0, window?.end ?? transcript.length) ?? locateInWindow(transcript, q, segments);
      if (!loc) {
        notFound++;
        continue;
      }
      if (theme.quotes.some((x) => x.start === loc.start && x.end === loc.end)) {
        duplicates++;
        continue;
      }
      theme.quotes.push(loc);
    }
    if (theme.quotes.length) byLabel.set(key, theme);
  }
  return { themes: [...byLabel.values()], notFound, duplicates, invalidLabels };
}

// Meerdere vensters samenvoegen tot één lijst (zelfde label → één thema, zelfde plek → één citaat).
export function mergeThemeFilters(parts: ThemeFilter[]): ThemeFilter {
  const byLabel = new Map<string, KeptTheme>();
  let notFound = 0;
  let duplicates = 0;
  let invalidLabels = 0;
  for (const p of parts) {
    notFound += p.notFound;
    duplicates += p.duplicates;
    invalidLabels += p.invalidLabels;
    for (const t of p.themes) {
      const key = labelKey(t.label);
      const cur = byLabel.get(key);
      if (!cur) {
        byLabel.set(key, { ...t, quotes: [...t.quotes] });
        continue;
      }
      for (const q of t.quotes) {
        if (cur.quotes.some((x) => x.start === q.start && x.end === q.end)) duplicates++;
        else cur.quotes.push(q);
      }
    }
  }
  return { themes: [...byLabel.values()], notFound, duplicates, invalidLabels };
}

// Een bestaand thema met hetzelfde label (hoofdletters en leestekens tellen niet).
export function findCode<T extends { label: string }>(codes: T[], label: string): T | undefined {
  const key = labelKey(label);
  return codes.find((c) => labelKey(c.label) === key);
}
