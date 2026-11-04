// Bestaand onderzoek importeren (stap Markt, tab Bronnen): pure regels zonder database of netwerk, zodat ze los te
// testen zijn. Een geïmporteerd rapport wordt een gewone bron met de uitgelezen tekst als letterlijke fragmenten
// (blokken), zodat de bestaande citaatcontrole (lib/domain/verify.ts) ongewijzigd werkt. Een AI-voorstel telt pas als
// het citaat woord voor woord in een blok staat, en wordt pas een bevinding als de consultant het accepteert.

import { checkQuote, normalizeText, type QuoteCheck } from "./verify";
import { extensionOf, formatBytes } from "./step-files";

// ---------------------------------------------------------------------------
// Grenzen
// ---------------------------------------------------------------------------

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_PAGES = 300;
// Meer tekst dan dit (ruwweg 300 dichtbedrukte pagina's) importeren we niet: splits het rapport dan op.
export const MAX_TEXT_CHARS = 1_000_000;
// Minder leesbare tekst dan dit: vrijwel zeker een scan of een leeg bestand.
export const MIN_TEXT_CHARS = 80;
// Een fragment mag in de database hoogstens 6000 tekens zijn; een blok blijft daar ruim onder.
export const BLOCK_TARGET = 4000;
export const BLOCK_MAX = 5000;
// Opeenvolgende blokken overlappen, zodat elk citaat tot deze lengte in zijn geheel in minstens één blok staat.
export const BLOCK_OVERLAP = 800;
export const MAX_QUOTE_CHARS = BLOCK_OVERLAP - 50;
// Uitgepakte DOCX-inhoud (tegen zip-bommen).
export const MAX_DOCX_XML_BYTES = 60 * 1024 * 1024;

export const IMPORT_TYPES = {
  pdf: "PDF",
  docx: "Word (DOCX)",
  txt: "Tekst (TXT)",
  md: "Markdown (MD)",
  csv: "CSV",
} as const;
export type ImportExt = keyof typeof IMPORT_TYPES;
export const IMPORT_ACCEPT = Object.keys(IMPORT_TYPES)
  .map((e) => `.${e}`)
  .join(",");
export const IMPORT_LABEL = "PDF, DOCX, TXT, MD of CSV";

export function importExt(fileName: string): ImportExt | null {
  const ext = extensionOf(fileName);
  return ext in IMPORT_TYPES ? (ext as ImportExt) : null;
}

export type ImportFileCheck = { ok: true; ext: ImportExt } | { ok: false; error: string };

export function checkImportFile(f: { name: string; size: number }): ImportFileCheck {
  const ext = importExt(f.name ?? "");
  if (!ext) return { ok: false, error: `Dit bestandstype kan ProofLab niet uitlezen. Importeer een ${IMPORT_LABEL}-bestand.` };
  if (!Number.isFinite(f.size) || f.size <= 0) return { ok: false, error: "Het bestand is leeg." };
  if (f.size > MAX_IMPORT_BYTES) return { ok: false, error: `Het bestand is ${formatBytes(f.size)}; de grens is ${formatBytes(MAX_IMPORT_BYTES)}.` };
  return { ok: true, ext };
}

// Bronsoorten die bij een bestaand rapport passen. De consultant kiest; ProofLab rekent daarna zoals bij elke bron.
export const IMPORT_SOURCE_TYPES = ["research_report", "official_statistic", "primary_document", "dataset_upload", "company_page", "news", "other"] as const;
export type ImportSourceType = (typeof IMPORT_SOURCE_TYPES)[number];

// ---------------------------------------------------------------------------
// Uitgelezen tekst opschonen
// ---------------------------------------------------------------------------

// Tekst uit een bestand, zonder BOM; geen geldige UTF-8 (veel vervangtekens) dan Windows-1252, zoals oude Excel-CSV's.
export function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  const bad = (utf8.match(/�/g) ?? []).length;
  if (bad > 0 && bad > utf8.length / 1000) {
    try {
      return new TextDecoder("windows-1252").decode(bytes).replace(/^﻿/, "");
    } catch {
      // Geen Windows-1252 in deze omgeving: houd de UTF-8-lezing.
    }
  }
  return utf8.replace(/^﻿/, "");
}

// Regeleinden gelijk, stuurtekens weg, spaties per regel samengevoegd, hoogstens één lege regel achter elkaar.
// De woorden zelf blijven ongemoeid: het citaat moet letterlijk terug te vinden zijn.
export function cleanText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Pagina's samenvoegen tot één tekst, met de beginpositie van elke pagina (voor de vindplaats "p. 4–5").
export function joinPages(pages: string[]): { text: string; pageStarts: number[] } {
  const pageStarts: number[] = [];
  let text = "";
  for (const raw of pages) {
    const page = cleanText(raw);
    if (text && page) text += "\n\n";
    pageStarts.push(text.length);
    text += page;
  }
  return { text, pageStarts };
}

// ---------------------------------------------------------------------------
// DOCX: de tekst uit word/document.xml (alleen lezen, niets uitvoeren)
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// WordprocessingML naar platte tekst: alinea's op een eigen regel, tabelcellen gescheiden door " | ", tabs en
// regeleinden behouden. Velden, opmaak en verborgen instructies worden genegeerd; alleen <w:t> telt als tekst.
export function docxXmlToText(xml: string): string {
  let out = "";
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>|<\/w:p>|<\/w:tc>|<\/w:tr>|<w:delText\b[^>]*>[^<]*<\/w:delText>/g;
  for (const m of xml.matchAll(re)) {
    const tag = m[0];
    if (m[1] !== undefined) out += decodeXmlEntities(m[1]);
    else if (tag.startsWith("<w:tab")) out += "\t";
    else if (tag.startsWith("<w:br") || tag.startsWith("<w:cr")) out += "\n";
    else if (tag === "</w:p>") out += "\n";
    else if (tag === "</w:tc>") out = out.replace(/\n$/, "") + " | ";
    else if (tag === "</w:tr>") out = out.replace(/ \| $/, "") + "\n";
    // <w:delText>: verwijderde tekst uit wijzigingen bijhouden; hoort niet bij het rapport.
  }
  return cleanText(out);
}

// ---------------------------------------------------------------------------
// In blokken verdelen
// ---------------------------------------------------------------------------

export type ReportBlock = { index: number; text: string; start: number; end: number; location: string };

function pageOf(pos: number, pageStarts: number[]): number {
  let lo = 0;
  let hi = pageStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pageStarts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

export function pageLabel(start: number, end: number, pageStarts: number[] | null): string | null {
  if (!pageStarts?.length) return null;
  const a = pageOf(start, pageStarts);
  const b = pageOf(Math.max(start, end - 1), pageStarts);
  return a === b ? `p. ${a}` : `p. ${a}–${b}`;
}

// Het beste breekpunt tussen min en max: een alinea-einde, dan een zinseinde, dan een regeleinde, dan een spatie.
function breakAt(text: string, min: number, max: number): number {
  const window = text.slice(min, max);
  const lastOf = (re: RegExp) => {
    let pos = -1;
    for (const m of window.matchAll(re)) pos = m.index + m[0].length;
    return pos;
  };
  for (const re of [/\n\n/g, /[.!?…]["')\]]?\s/g, /\n/g, /\s/g]) {
    const p = lastOf(re);
    if (p > 0) return min + p;
  }
  return max;
}

// Volgende blok begint op een woordgrens binnen de overlap, zodat geen woord wordt doorgesneden.
function overlapStart(text: string, from: number, end: number): number {
  const m = /\s/.exec(text.slice(from, end));
  return m ? from + m.index + 1 : from;
}

// Verdeelt de tekst in blokken van ongeveer BLOCK_TARGET tekens met BLOCK_OVERLAP overlap. Elk blok is een exact
// stuk van de tekst (geen herschrijving), met de vindplaats: pagina's als die bekend zijn, anders het blokvolgnummer.
export function chunkText(text: string, pageStarts: number[] | null = null, opts: { target?: number; max?: number; overlap?: number } = {}): ReportBlock[] {
  const target = opts.target ?? BLOCK_TARGET;
  const max = opts.max ?? BLOCK_MAX;
  const overlap = Math.min(opts.overlap ?? BLOCK_OVERLAP, Math.floor(target / 2));
  const spans: { start: number; end: number }[] = [];
  let start = 0;
  while (start < text.length) {
    let end: number;
    if (text.length - start <= max) end = text.length;
    else end = breakAt(text, start + Math.floor(target * 0.6), start + max);
    spans.push({ start, end });
    if (end >= text.length) break;
    const next = overlapStart(text, Math.max(start + 1, end - overlap), end);
    start = next > start ? next : end;
  }
  const total = spans.length;
  return spans
    .map((s) => ({ ...s, text: text.slice(s.start, s.end).trim() }))
    .filter((s) => s.text.length > 0)
    .map((s, i) => {
      const pages = pageLabel(s.start, s.end, pageStarts);
      return { index: i, text: s.text, start: s.start, end: s.end, location: `Rapport, blok ${i + 1} van ${total}${pages ? ` · ${pages}` : ""}` };
    });
}

// ---------------------------------------------------------------------------
// Citaten in een geïmporteerd rapport terugvinden
// ---------------------------------------------------------------------------

export type QuoteLocation = { blockIndex: number; check: QuoteCheck };

// Het eerste blok waarin het citaat letterlijk staat (na dezelfde normalisatie als de citaatcontrole), met de
// controle van de getallen uit de bewering. Staat het citaat nergens, dan "not_found" met blockIndex -1.
export function locateQuote(quote: string, blocks: { text: string }[], statement?: string): QuoteLocation {
  const q = normalizeText(quote);
  if (q.length < 8) return { blockIndex: -1, check: "not_found" };
  let numbersMismatch = -1;
  for (let i = 0; i < blocks.length; i++) {
    const check = checkQuote(quote, blocks[i].text, statement);
    if (check === "exact") return { blockIndex: i, check };
    if (check === "numbers_mismatch" && numbersMismatch < 0) numbersMismatch = i;
  }
  return numbersMismatch >= 0 ? { blockIndex: numbersMismatch, check: "numbers_mismatch" } : { blockIndex: -1, check: "not_found" };
}

export type RawProposal = { block_ref: string; quote: string; statement: string; stance: "supports" | "contradicts"; question_ref: string | null };
export type KeptProposal<T extends RawProposal> = T & { blockIndex: number };

export type ProposalFilter<T extends RawProposal> = { kept: KeptProposal<T>[]; notFound: number; numbersMismatch: number; duplicates: number };

// Alleen voorstellen waarvan het citaat woord voor woord in het rapport staat en dat de getallen uit de bewering
// bevat. Het blok dat het model noemt gaat voor; staat het citaat daar niet, dan zoeken we in alle blokken van het
// rapport (de verwijzing van een model is geen bewijs, de tekst wel). Dubbele citaten tellen één keer.
export function filterProposals<T extends RawProposal>(proposals: T[], blocks: { text: string }[], refToIndex: (ref: string) => number): ProposalFilter<T> {
  const kept: KeptProposal<T>[] = [];
  const seen = new Set<string>();
  let notFound = 0;
  let numbersMismatch = 0;
  let duplicates = 0;
  for (const p of proposals) {
    const quote = p.quote.trim();
    const statement = p.stance === "supports" ? p.statement : undefined;
    if (quote.length > MAX_QUOTE_CHARS) {
      notFound++;
      continue;
    }
    const hinted = refToIndex(p.block_ref);
    let where: QuoteLocation = { blockIndex: -1, check: "not_found" };
    if (hinted >= 0 && hinted < blocks.length) {
      const c = checkQuote(quote, blocks[hinted].text, statement);
      if (c !== "not_found") where = { blockIndex: hinted, check: c };
    }
    if (where.check !== "exact") {
      const anywhere = locateQuote(quote, blocks, statement);
      if (anywhere.check === "exact" || where.check === "not_found") where = anywhere;
    }
    if (where.check === "not_found") {
      notFound++;
      continue;
    }
    if (where.check === "numbers_mismatch") {
      numbersMismatch++;
      continue;
    }
    const key = normalizeText(quote);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    kept.push({ ...p, quote, blockIndex: where.blockIndex });
  }
  return { kept, notFound, numbersMismatch, duplicates };
}

export const blockRef = (i: number) => `B${i + 1}`;
export function blockIndexOf(ref: string): number {
  const m = /^\s*B?(\d{1,4})\s*$/i.exec(ref ?? "");
  return m ? Number(m[1]) - 1 : -1;
}

// Welke blokken de AI in één keer leest: vanaf `from`, tot het tekenbudget op is (minstens één blok).
export function aiWindow(blocks: { text: string }[], from: number, maxChars: number): { from: number; to: number } {
  const start = Math.max(0, Math.min(from, blocks.length));
  let used = 0;
  let to = start;
  while (to < blocks.length && (to === start || used + blocks[to].text.length <= maxChars)) {
    used += blocks[to].text.length;
    to++;
  }
  return { from: start, to };
}

// ---------------------------------------------------------------------------
// Gegevens van de bron
// ---------------------------------------------------------------------------

// Jaar of peildatum zoals de consultant die kent: "2024", "2024-05", "2024-05-13" of "13-05-2024". Een los jaar wordt
// 1 januari van dat jaar (de bron is dan nooit jonger dan hij is) en dat staat er eerlijk bij.
export function parsePublished(raw: string | null | undefined, now: Date = new Date()): { date: string | null; precision: "year" | "month" | "day" | null; error?: string } {
  const v = (raw ?? "").trim();
  if (!v) return { date: null, precision: null };
  const valid = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1900;
  };
  const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  let y: number, m: number, d: number, precision: "year" | "month" | "day";
  let match: RegExpExecArray | null;
  if ((match = /^(\d{4})$/.exec(v))) [y, m, d, precision] = [Number(match[1]), 1, 1, "year"];
  else if ((match = /^(\d{4})-(\d{1,2})$/.exec(v))) [y, m, d, precision] = [Number(match[1]), Number(match[2]), 1, "month"];
  else if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v))) [y, m, d, precision] = [Number(match[1]), Number(match[2]), Number(match[3]), "day"];
  else if ((match = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(v))) [y, m, d, precision] = [Number(match[3]), Number(match[2]), Number(match[1]), "day"];
  else return { date: null, precision: null, error: "Schrijf het jaar (2024), de maand (2024-05) of de datum (2024-05-13)." };
  if (!valid(y, m, d)) return { date: null, precision: null, error: "Deze datum bestaat niet." };
  if (Date.UTC(y, m - 1, d) > now.getTime() + 86_400_000) return { date: null, precision: null, error: "De datum ligt in de toekomst." };
  return { date: iso(y, m, d), precision };
}

// Het kenmerk waarmee ProofLab een geïmporteerd rapport herkent (zonder extra kolom in de database).
export const IMPORT_NOTE_PREFIX = "Geïmporteerd rapport:";

export function isImportedReport(accessNote: string | null | undefined): boolean {
  return !!accessNote?.startsWith(IMPORT_NOTE_PREFIX);
}

export function importAccessNote(x: { fileName: string; pages: number | null; chars: number; blocks: number; precision: "year" | "month" | "day" | null; at: Date }): string {
  const when = x.at.toLocaleDateString("nl-NL", { timeZone: "Europe/Amsterdam" });
  const size = `${x.pages ? `${x.pages} p., ` : ""}${x.chars.toLocaleString("nl-NL")} tekens, ${x.blocks} ${x.blocks === 1 ? "blok" : "blokken"}`;
  const date = x.precision === "year" ? " Alleen het jaar van publicatie is bekend; als datum geldt 1 januari." : x.precision === "month" ? " Alleen de maand van publicatie is bekend; als datum geldt de eerste van de maand." : "";
  const name = x.fileName.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160);
  return `${IMPORT_NOTE_PREFIX} "${name}" (${size}), uitgelezen op ${when}. De tekst is automatisch uit het bestand gehaald en niet online gecontroleerd; vergelijk een citaat bij twijfel met het origineel.${date}`.slice(0, 600);
}

export function defaultTitle(fileName: string): string {
  const base = (fileName.split(/[\\/]/).pop() ?? "").replace(/\.[A-Za-z0-9]{1,10}$/, "");
  return base.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) || "Geïmporteerd rapport";
}

// Foutmeldingen bij het uitlezen, in gewone taal.
export const EXTRACT_ERRORS = {
  no_text: "Dit bestand bevat geen leesbare tekst. Is het een gescande PDF (een foto van papier)? ProofLab leest geen scans. Exporteer het rapport als PDF met tekst, of gebruik OCR en importeer het opnieuw.",
  too_many_pages: `Dit rapport heeft meer dan ${MAX_PDF_PAGES} pagina's. Importeer de relevante hoofdstukken als apart bestand.`,
  too_long: `Dit rapport bevat meer dan ${MAX_TEXT_CHARS.toLocaleString("nl-NL")} tekens. Importeer de relevante hoofdstukken als apart bestand.`,
  encrypted: "Deze PDF is beveiligd met een wachtwoord. Sla hem op zonder beveiliging en importeer hem opnieuw.",
  damaged: "Dit bestand is beschadigd of geen geldig bestand van dit type. Open en bewaar het opnieuw, en probeer het dan nog eens.",
  too_large: `Het bestand is groter dan ${formatBytes(MAX_IMPORT_BYTES)}.`,
  unsupported: `Dit bestandstype kan ProofLab niet uitlezen. Importeer een ${IMPORT_LABEL}-bestand.`,
} as const;
export type ExtractError = keyof typeof EXTRACT_ERRORS;
