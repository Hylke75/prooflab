// Bulk import of customer signals (reviews, forum posts, survey answers, CSV exports). Pure functions:
// shared by the browser (preview) and the server (which never trusts the preview).

export const MAX_FRAGMENTS = 2000;
export const MAX_FRAGMENT_CHARS = 6000;
export const MAX_IMPORT_BYTES = 1_000_000;
export const MIN_FRAGMENT_CHARS = 3;

export type SplitMode = "auto" | "line" | "blank";

const tidy = (s: string) => s.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();

// One fragment per line, or per block separated by a blank line. "auto" uses blocks as soon as the text
// contains a blank line (multi-line reviews), otherwise lines.
export function splitFragments(text: string, mode: SplitMode = "auto"): string[] {
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const useBlank = mode === "blank" || (mode === "auto" && /\n[ \t]*\n/.test(clean.trim()));
  const parts = useBlank ? clean.split(/\n[ \t]*\n+/) : clean.split("\n");
  return parts.map(tidy).filter((p) => p.length > 0);
}

export function normalizeFragment(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/^[\s"'“”.,;:!?\-–—*•]+|[\s"'“”.,;:!?\-–—*•]+$/g, "")
    .trim();
}

// Drops empty and duplicate fragments (same text after normalising case, spacing and edge punctuation),
// cuts each to the excerpt limit and caps the number of fragments.
export function dedupeFragments(list: string[], opts: { existing?: string[]; max?: number } = {}): { fragments: string[]; duplicates: number; tooShort: number; truncated: number; overLimit: number } {
  const seen = new Set((opts.existing ?? []).map(normalizeFragment));
  const max = opts.max ?? MAX_FRAGMENTS;
  const fragments: string[] = [];
  let duplicates = 0;
  let tooShort = 0;
  let truncated = 0;
  let overLimit = 0;
  for (const raw of list) {
    const t = tidy(raw);
    const key = normalizeFragment(t);
    if (key.length < MIN_FRAGMENT_CHARS) {
      tooShort++;
      continue;
    }
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    if (fragments.length >= max) {
      overLimit++;
      continue;
    }
    seen.add(key);
    if (t.length > MAX_FRAGMENT_CHARS) truncated++;
    fragments.push(t.slice(0, MAX_FRAGMENT_CHARS));
  }
  return { fragments, duplicates, tooShort, truncated, overLimit };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export function detectDelimiter(text: string): "," | ";" | "\t" {
  const firstLine = text.replace(/^﻿/, "").split(/\r?\n/)[0] ?? "";
  let inQuotes = false;
  const counts = { ",": 0, ";": 0, "\t": 0 };
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "," || ch === ";" || ch === "\t")) counts[ch]++;
  }
  if (counts["\t"] > counts[","] && counts["\t"] > counts[";"]) return "\t";
  return counts[";"] > counts[","] ? ";" : ",";
}

// RFC 4180-style parser: quoted fields with embedded delimiters, quotes ("") and newlines.
export function parseCsv(text: string, maxRows = MAX_FRAGMENTS + 1): string[][] {
  const src = text.replace(/^﻿/, "");
  const delim = detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") inQuotes = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      if (rows.length >= maxRows) return rows;
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows.slice(0, maxRows);
}

export function csvColumn(rows: string[][], column: number, hasHeader: boolean): string[] {
  return rows.slice(hasHeader ? 1 : 0).map((r) => (r[column] ?? "").trim()).filter(Boolean);
}

// Guess the column with the longest texts (the review or answer itself).
export function guessTextColumn(rows: string[][], hasHeader: boolean): number {
  const body = rows.slice(hasHeader ? 1 : 0, 51);
  const width = Math.max(0, ...rows.slice(0, 51).map((r) => r.length));
  let best = 0;
  let bestLen = -1;
  for (let c = 0; c < width; c++) {
    const avg = body.reduce((s, r) => s + (r[c]?.length ?? 0), 0) / Math.max(1, body.length);
    if (avg > bestLen) {
      best = c;
      bestLen = avg;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Page text → excerpts
// ---------------------------------------------------------------------------

function splitLong(p: string, max: number): string[] {
  if (p.length <= max) return [p];
  const out: string[] = [];
  let rest = p;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const stop = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
    const cut = stop > max * 0.4 ? stop + 1 : window.lastIndexOf(" ") > max * 0.4 ? window.lastIndexOf(" ") : max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// Paragraphs of a fetched page, packed into excerpts of at most `max` characters. Very short lines
// (menus, buttons) are dropped; overlong paragraphs are split at sentence ends.
export function pageExcerpts(text: string, opts: { max?: number; minLine?: number; maxExcerpts?: number } = {}): string[] {
  const max = opts.max ?? MAX_FRAGMENT_CHARS;
  const minLine = opts.minLine ?? 25;
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map(tidy)
    .filter((p) => p.length >= minLine)
    .flatMap((p) => splitLong(p, max));
  const out: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && current.length + 2 + p.length > max) {
      out.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${p}` : p;
  }
  if (current) out.push(current);
  return out.slice(0, opts.maxExcerpts ?? 60);
}
