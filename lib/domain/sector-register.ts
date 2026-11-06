// Sectorregisters (fase 2, punt 6): aantallen van een brancheorganisatie of bond (bijv. clubs per sport, grootteklasse
// en regio) als CSV importeren. Pure regels zonder database of netwerk, gedeeld door de browser (voorbeeld en fouten
// per regel vóór het uploaden) en de server (die het voorbeeld nooit vertrouwt en alles opnieuw controleert).
//
// Opslag: een register wordt een gewone bron (dataset_upload) met elke regel als letterlijk fragment, zodat de
// bestaande citaatcontrole ongewijzigd werkt. Zo'n register telt ALLEEN als primaire bron wanneer het originele
// bestand of de bronpagina is bijgevoegd en ProofLab daarin, per gekozen regel, de categorie én het aantal letterlijk
// terugvindt. Dan wordt de passage uit het origineel het fragment van een primaire bron (primary_document). Anders,
// of bij een optelling van meerdere regels (die staat niet letterlijk in de bron), is de bevinding een schatting en
// telt ze niet als officiële of primaire bron.

import { detectDelimiter } from "@/lib/signals/import";
import { checkQuote, normalizeText, valueInQuote } from "./verify";

export const REGISTER_REQUIRED = ["uitgever", "bron_url", "peildatum", "categorie", "grootteklasse", "regio", "aantal"] as const;
export const REGISTER_OPTIONAL = ["opmerking"] as const;
export type RegisterColumn = (typeof REGISTER_REQUIRED)[number] | (typeof REGISTER_OPTIONAL)[number];

export const REGISTER_COLUMN_HELP: Record<RegisterColumn, string> = {
  uitgever: "Wie het register bijhoudt, bijv. de sportbond of brancheorganisatie.",
  bron_url: "Webadres van de bronpagina of het originele bestand (https://…).",
  peildatum: "Datum of jaar van de telling: 2025, 2025-06 of 2025-06-30 (ook 30-06-2025).",
  categorie: "Waar het aantal over gaat, zoals het in de bron staat (bijv. een sport of branche).",
  grootteklasse: "Grootteklasse zoals in de bron (bijv. 100-250 leden), of \"totaal\" of \"onbekend\".",
  regio: "Regio zoals in de bron (bijv. een provincie), of \"Nederland\" of \"onbekend\".",
  aantal: "Het aantal als heel getal (1234 of 1.234), zonder eenheden of tekst.",
  opmerking: "Optioneel: bijv. de definitie die de uitgever hanteert.",
};

export const REGISTER_MAX_BYTES = 1_000_000;
export const REGISTER_MAX_ROWS = 5000;
// Markering in de toegangsnotitie van de bron; zo herkent ProofLab een register (en het origineel) zonder extra tabel.
export const REGISTER_MARKER = "Sectorregister (CSV-import)";
export const ORIGINAL_MARKER = "Origineel van sectorregister";
export const SUM_LOCATION = "Optelling door ProofLab";

// Het downloadbare sjabloon: alleen de kolomkoppen. Bewust zonder voorbeeldregels, zodat er nooit per ongeluk
// verzonnen aantallen worden geïmporteerd.
export function registerTemplateCsv(): string {
  return `${[...REGISTER_REQUIRED, ...REGISTER_OPTIONAL].join(";")}\r\n`;
}

export type RegisterRow = {
  line: number; // regelnummer in het bestand (kopregel = 1)
  publisher: string;
  url: string;
  referenceDate: string; // jjjj, jjjj-mm of jjjj-mm-dd
  category: string;
  sizeClass: string;
  region: string;
  count: number;
  note: string | null;
};

export type RegisterLineError = { line: number; messages: string[] };
export type RegisterParse = { rows: RegisterRow[]; errors: RegisterLineError[]; fatal: string | null };

const headerKey = (h: string) =>
  normalizeText(h)
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z_]/g, "");

// CSV volgens RFC 4180, met het regelnummer waarop elke rij begint (lege regels tellen mee, zodat de foutmelding
// naar de juiste regel in het bestand wijst).
export function csvRowsWithLines(text: string): { line: number; cells: string[] }[] {
  const src = text.replace(/^﻿/, "");
  const delim = detectDelimiter(src);
  const out: { line: number; cells: string[] }[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let start = 1;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") inQuotes = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((c) => c.trim() !== "")) out.push({ line: start, cells: row });
      row = [];
      field = "";
      line++;
      start = line;
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) out.push({ line: start, cells: row });
  return out;
}

const DATE_ISO = /^(\d{4})(?:-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?)?$/;
const DATE_NL = /^(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](\d{4})$/;

// Peildatum als jjjj, jjjj-mm of jjjj-mm-dd; null als ze onleesbaar, onmogelijk of in de toekomst is.
export function parseRegisterDate(raw: string, today: Date = new Date()): string | null {
  const s = raw.trim();
  let iso: string | null = null;
  if (DATE_ISO.test(s)) iso = s;
  else {
    const m = DATE_NL.exec(s);
    if (m) iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  if (!iso) return null;
  const [y, mo, d] = iso.split("-").map(Number);
  if (y < 1950) return null;
  if (d) {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1) return null; // 31 juni bestaat niet
    if (dt.getTime() > today.getTime()) return null;
  } else if (mo) {
    if (Date.UTC(y, mo - 1, 1) > today.getTime()) return null;
  } else if (y > today.getUTCFullYear()) return null;
  return iso;
}

// Een aantal als heel getal: "1234", "1.234", "1 234" of "1,234"; geen decimalen, negatieve getallen of tekst.
export function parseRegisterCount(raw: string): number | null {
  const s = raw.trim().replace(/[   ]/g, "");
  if (/^\d+$/.test(s)) return Number(s);
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ""));
  return null;
}

function validUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function parseRegisterCsv(text: string, today: Date = new Date()): RegisterParse {
  if (new TextEncoder().encode(text).byteLength > REGISTER_MAX_BYTES) return { rows: [], errors: [], fatal: "Het bestand is groter dan 1 MB. Splits het register op." };
  const table = csvRowsWithLines(text);
  if (table.length === 0) return { rows: [], errors: [], fatal: "Het bestand is leeg." };
  const header = table[0].cells.map(headerKey);
  const missing = REGISTER_REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) return { rows: [], errors: [], fatal: `Deze verplichte kolommen ontbreken: ${missing.join(", ")}. Gebruik het sjabloon.` };
  const body = table.slice(1);
  if (body.length === 0) return { rows: [], errors: [], fatal: "Het bestand bevat alleen kolomkoppen en geen regels." };
  if (body.length > REGISTER_MAX_ROWS) return { rows: [], errors: [], fatal: `Meer dan ${REGISTER_MAX_ROWS} regels. Splits het register op.` };
  const col = (cells: string[], name: RegisterColumn) => {
    const i = header.indexOf(name);
    return i < 0 ? "" : (cells[i] ?? "").trim();
  };
  const rows: RegisterRow[] = [];
  const errors: RegisterLineError[] = [];
  for (const { line, cells } of body) {
    const messages: string[] = [];
    const text = (name: RegisterColumn, max: number) => {
      const v = col(cells, name);
      if (!v) messages.push(`${name} is leeg`);
      else if (v.length > max) messages.push(`${name} is langer dan ${max} tekens`);
      return v.slice(0, max);
    };
    const publisher = text("uitgever", 200);
    const rawUrl = col(cells, "bron_url");
    const url = rawUrl ? validUrl(rawUrl) : null;
    if (!rawUrl) messages.push("bron_url is leeg");
    else if (!url) messages.push("bron_url is geen geldig webadres (https://…)");
    const rawDate = col(cells, "peildatum");
    const referenceDate = rawDate ? parseRegisterDate(rawDate, today) : null;
    if (!rawDate) messages.push("peildatum is leeg");
    else if (!referenceDate) messages.push("peildatum is geen geldige datum in het verleden (2025, 2025-06, 2025-06-30 of 30-06-2025)");
    const category = text("categorie", 200);
    const sizeClass = text("grootteklasse", 120);
    const region = text("regio", 120);
    const rawCount = col(cells, "aantal");
    const count = rawCount ? parseRegisterCount(rawCount) : null;
    if (!rawCount) messages.push("aantal is leeg");
    else if (count == null) messages.push(`aantal "${rawCount.slice(0, 20)}" is geen heel getal`);
    const note = col(cells, "opmerking").slice(0, 300) || null;
    if (messages.length) errors.push({ line, messages });
    else rows.push({ line, publisher, url: url!, referenceDate: referenceDate!, category, sizeClass, region, count: count!, note });
  }
  return { rows, errors, fatal: null };
}

// Eén register per uitgever, bron en peildatum (een bestand kan er meer bevatten).
export function groupRegisters(rows: RegisterRow[]): { publisher: string; url: string; referenceDate: string; rows: RegisterRow[] }[] {
  const groups = new Map<string, { publisher: string; url: string; referenceDate: string; rows: RegisterRow[] }>();
  for (const r of rows) {
    const key = `${normalizeText(r.publisher)}|${r.url}|${r.referenceDate}`;
    const g = groups.get(key) ?? { publisher: r.publisher, url: r.url, referenceDate: r.referenceDate, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  return [...groups.values()];
}

// De letterlijke regel van het register (het fragment van de bron). Vast formaat, zodat ProofLab hem later weer kan
// lezen (parseRegisterLine) en een koppeling met een API (bijv. een bondsregister) dezelfde regels kan maken.
export function registerLine(r: Omit<RegisterRow, "line" | "url">): string {
  return `Sectorregister ${r.publisher}; Categorie: ${r.category}; Grootteklasse: ${r.sizeClass}; Regio: ${r.region}; Peildatum: ${r.referenceDate}; Aantal: ${r.count}${r.note ? `; Opmerking: ${r.note}` : ""}`;
}

const LINE_RE = /^Sectorregister (.+?); Categorie: (.+?); Grootteklasse: (.+?); Regio: (.+?); Peildatum: (\d{4}(?:-\d\d){0,2}); Aantal: (\d+)(?:; Opmerking: ([\s\S]*))?$/;

export function parseRegisterLine(text: string): Omit<RegisterRow, "line" | "url"> | null {
  const m = LINE_RE.exec(text.trim());
  if (!m) return null;
  return { publisher: m[1], category: m[2], sizeClass: m[3], region: m[4], referenceDate: m[5], count: Number(m[6]), note: m[7] ?? null };
}

// ---------------------------------------------------------------------------
// Het origineel: staan categorie en aantal letterlijk in het bijgevoegde bestand of de bronpagina?
// ---------------------------------------------------------------------------

export const MAX_PASSAGE = 600;

// De kortste passage uit het origineel (één regel, of tot drie opeenvolgende regels voor tabellen waarvan de cellen op
// aparte regels staan) waarin zowel de categorie als het aantal letterlijk staan. Null als die er niet is: dan is het
// aantal niet in het origineel teruggevonden.
export function findInOriginal(row: Pick<RegisterRow, "category" | "count">, originalText: string): string | null {
  const lines = originalText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const cat = normalizeText(row.category);
  if (cat.length < 2) return null;
  for (let span = 1; span <= 3; span++) {
    for (let i = 0; i + span <= lines.length; i++) {
      const passage = lines.slice(i, i + span).join(" ");
      if (passage.length > MAX_PASSAGE) continue;
      if (normalizeText(passage).includes(cat) && valueInQuote(row.count, passage)) return passage;
    }
  }
  return null;
}

export type Attestation = { found: { line: string; passage: string }[]; missing: string[] };

// Per registerregel (de tekst van het fragment) de passage uit het origineel, of de regel bij "niet teruggevonden".
export function attestRegister(lines: string[], originalText: string): Attestation {
  const found: Attestation["found"] = [];
  const missing: string[] = [];
  for (const line of lines) {
    const row = parseRegisterLine(line);
    const passage = row ? findInOriginal(row, originalText) : null;
    if (passage) found.push({ line, passage });
    else missing.push(line);
  }
  return { found, missing };
}

// De regel: telt een bevinding uit een register als primaire bron? Alleen met een bijgevoegd origineel, één gekozen
// regel (een optelling staat niet letterlijk in de bron) en een passage uit dat origineel waarin categorie en aantal
// staan. In alle andere gevallen is het een schatting (geen officiële of primaire bron).
export type RegisterClaimPlan =
  | { kind: "primary"; passage: string; reason: string }
  | { kind: "estimate"; reason: string; sum: boolean };

export function registerClaimPlan(input: { rows: Pick<RegisterRow, "category" | "count">[]; originalPassages: string[] | null }): RegisterClaimPlan {
  if (input.rows.length === 0) return { kind: "estimate", sum: false, reason: "Er is geen regel gekozen." };
  if (input.rows.length > 1) {
    return { kind: "estimate", sum: true, reason: "Een optelling van meerdere regels staat niet letterlijk in de bron; ProofLab bewaart haar als schatting." };
  }
  if (!input.originalPassages) {
    return { kind: "estimate", sum: false, reason: "Het originele bestand of de bronpagina is niet bijgevoegd; het aantal is daarom een schatting." };
  }
  const row = input.rows[0];
  const passage = input.originalPassages.map((p) => findInOriginal(row, p)).find((p): p is string => !!p);
  if (!passage) return { kind: "estimate", sum: false, reason: "Categorie en aantal zijn niet letterlijk teruggevonden in het origineel; het aantal is daarom een schatting." };
  return { kind: "primary", passage, reason: "Categorie en aantal staan letterlijk in het origineel." };
}

// De bevinding bij één regel uit het origineel: alleen woorden en getallen die in de passage staan (de citaatcontrole
// eist dat elk getal uit de bevinding in het citaat staat). Null als er geen passende formulering is.
export function primaryStatement(row: Pick<RegisterRow, "category" | "count" | "publisher">, passage: string): string | null {
  const options = [`Volgens ${row.publisher}: ${row.category}, aantal ${row.count}.`, `${row.category}: aantal ${row.count} (volgens het originele register).`];
  return options.find((s) => checkQuote(passage, passage, s) === "exact") ?? null;
}

// De bevinding bij één registerregel zonder bevestigd origineel: alle onderdelen komen uit de regel zelf.
export function estimateStatement(row: Omit<RegisterRow, "line" | "url">): string {
  return `Volgens het sectorregister van ${row.publisher}: ${row.category} (grootteklasse ${row.sizeClass}, regio ${row.region}, peildatum ${row.referenceDate}), aantal ${row.count}.`;
}

export const MAX_SUM_ROWS = 50;

// Het fragment bij een optelling: uitdrukkelijk door ProofLab berekend, met elke opgetelde regel. Het citaat is de
// kop (met het aantal regels en het totaal), zodat het binnen de lengtegrens van een citaat blijft.
export function sumExcerpt(publisher: string, rows: Omit<RegisterRow, "line" | "url">[]): { text: string; quote: string; total: number; statement: string } {
  const total = rows.reduce((s, r) => s + r.count, 0);
  const quote = `Optelling door ProofLab (geen tekst van de uitgever) van ${rows.length} regels uit het sectorregister van ${publisher}, totaal ${total}`;
  const parts = rows.map((r) => `${r.category}, ${r.sizeClass}, ${r.region}, ${r.referenceDate}: ${r.count}`);
  return {
    text: `${quote}: ${parts.join(" + ")}`,
    quote,
    total,
    statement: `Optelling van ${rows.length} regels uit het sectorregister van ${publisher}: ${total}.`,
  };
}
