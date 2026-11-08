// Fase 1 · punt 3: interviews importeren. Een transcript (Teams, Zoom, Fathom, Otter of eigen notities) wordt
// omgezet naar segmenten {spreker, start, einde, tekst} en daarna naar één genormaliseerde tekst:
//
//   [00:12:03] Spreker A: tekst van het segment
//
// met per segment de positie (charStart/charEnd) van de tekst zelf in die genormaliseerde tekst. Die posities zijn
// de basis voor "markeren om te citeren": een citaat is een stuk van precies deze tekst.
//
// Puur en deterministisch: geen database, geen netwerk, geen AI. Bestanden lezen (DOCX uitpakken, tekens decoderen)
// gebeurt in lib/transcript-file.ts; hier komt alleen tekst binnen.

// ---------------------------------------------------------------------------
// Soorten en grenzen
// ---------------------------------------------------------------------------

export const TRANSCRIPT_FORMATS = {
  paste: "Geplakte tekst",
  txt: "Tekst (TXT)",
  md: "Markdown (MD)",
  docx: "Word (DOCX, ook Teams)",
  vtt: "Ondertiteling (VTT, Teams of Zoom)",
  srt: "Ondertiteling (SRT)",
  fathom: "Fathom",
  // AI-gemodereerd chatinterview (lib/domain/ai-interview.ts): geen bestand, het transcript komt uit de beurten.
  ai_chat: "AI-gemodereerd chatinterview",
} as const;
export type TranscriptFormat = keyof typeof TRANSCRIPT_FORMATS;

// Bestanden die ProofLab uitleest (de rest van de soorten komt niet uit een bestand).
export const TRANSCRIPT_FILE_EXTS = ["txt", "md", "docx", "vtt", "srt"] as const;
export type TranscriptFileExt = (typeof TRANSCRIPT_FILE_EXTS)[number];
export const TRANSCRIPT_ACCEPT = TRANSCRIPT_FILE_EXTS.map((e) => `.${e}`).join(",");
export const TRANSCRIPT_FILE_LABEL = "TXT, MD, DOCX, VTT of SRT";

// Een transcript van een uur is als VTT ongeveer 150–300 kB en als DOCX minder; 4 MB laat ruim marge en blijft onder
// de grens die Vercel voor een verzoek hanteert (4,5 MB, zie next.config.ts).
export const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;
// Was 60.000 tekens (ongeveer een uur gesprek). Nu 200.000: een gesprek van ruim drie uur. De database staat tot
// 250.000 toe (migratie 20261115090000_interviews_import); de AI leest het transcript in vensters.
export const MAX_TRANSCRIPT_CHARS = 200_000;
export const MIN_TRANSCRIPT_CHARS = 50;
export const MAX_SEGMENTS = 5000;
// Opeenvolgende stukjes van dezelfde spreker (Teams maakt er één per paar seconden) worden samengevoegd tot een
// segment van hoogstens zoveel tekens.
export const MAX_SEGMENT_CHARS = 2000;

// De AI leest een lang transcript in vensters van zoveel tekens (ruwweg 10.000 tokens), met overlap zodat een
// uitspraak op de grens in minstens één venster helemaal staat.
export const AI_WINDOW_CHARS = 40_000;
export const AI_WINDOW_OVERLAP = 2_000;

export function transcriptExt(fileName: string): TranscriptFileExt | null {
  const m = /\.([a-z0-9]{1,5})$/i.exec(fileName ?? "");
  const ext = m ? m[1].toLowerCase() : "";
  return (TRANSCRIPT_FILE_EXTS as readonly string[]).includes(ext) ? (ext as TranscriptFileExt) : null;
}

export type TranscriptFileCheck = { ok: true; ext: TranscriptFileExt } | { ok: false; error: string };

export function checkTranscriptFile(f: { name: string; size: number }): TranscriptFileCheck {
  const ext = transcriptExt(f.name);
  if (!ext) return { ok: false, error: `Dit bestandstype kan ProofLab niet uitlezen. Kies een ${TRANSCRIPT_FILE_LABEL}-bestand.` };
  if (!Number.isFinite(f.size) || f.size <= 0) return { ok: false, error: "Het bestand is leeg." };
  if (f.size > MAX_TRANSCRIPT_BYTES) return { ok: false, error: `Het bestand is groter dan ${MAX_TRANSCRIPT_BYTES / 1024 / 1024} MB. Splits het transcript of exporteer het als tekst.` };
  return { ok: true, ext };
}

// ---------------------------------------------------------------------------
// Segmenten
// ---------------------------------------------------------------------------

export type Segment = { speaker: string | null; startMs: number | null; endMs: number | null; text: string };
// Een segment in de genormaliseerde tekst: [charStart, charEnd) is precies `text`.
export type PlacedSegment = Segment & { charStart: number; charEnd: number };

export type ParsedTranscript = {
  segments: Segment[];
  speakers: string[];
  hasTimestamps: boolean;
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Tijden
// ---------------------------------------------------------------------------

// "01:02:03.456", "1:02:03,4", "02:03.456", "0:0:3.180" (Teams-DOCX), "12:03" en "1:02:03" → milliseconden.
export function parseTimestamp(raw: string): number | null {
  const m = /^\s*(\d{1,3})(?::(\d{1,2}))(?::(\d{1,2}))?(?:[.,](\d{1,3}))?\s*$/.exec(raw ?? "");
  if (!m) return null;
  const parts = [m[1], m[2], m[3]].filter((x) => x !== undefined).map(Number);
  const [h, mi, s] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  if (mi > 59 || s > 59) return null;
  const frac = m[4] ? Number(m[4].padEnd(3, "0")) : 0;
  return ((h * 60 + mi) * 60 + s) * 1000 + frac;
}

// 723000 → "00:12:03".
export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((x) => String(x).padStart(2, "0")).join(":");
}

// ---------------------------------------------------------------------------
// Hulpregels
// ---------------------------------------------------------------------------

const TIME = String.raw`\d{1,3}:\d{1,2}(?::\d{1,2})?(?:[.,]\d{1,3})?`;
const CUE_TIMING = new RegExp(String.raw`^\s*(${TIME})\s*-->\s*(${TIME})`);
// Een sprekernaam: hoogstens vijf woorden en 40 tekens, begint met een letter, geen cijfers of zinstekens aan het eind.
const NAME = String.raw`[\p{L}][\p{L}\p{M}'’.\-]*(?:\s+[\p{L}\p{M}'’.\-()]+){0,4}`;
const NAME_RE = new RegExp(`^${NAME}$`, "u");

// Rollen die als sprekerlabel altijd herkend worden, ook als ze maar één keer voorkomen.
const ROLE_LABELS = /^(interviewer|interviewee|geïnterviewde|geinterviewde|respondent|deelnemer|onderzoeker|consultant|vraag|antwoord|q|a|i|r|spreker \d+|speaker \d+)$/i;

function looksLikeName(s: string): boolean {
  const t = s.trim();
  return t.length >= 1 && t.length <= 40 && NAME_RE.test(t) && !/[.!?,;]$/.test(t);
}

// HTML-achtige opmaak uit VTT/SRT: <v Naam>, <c>, <b>, <i>, <00:00:01.000>, {\an8}. Alleen tekst blijft over.
function stripCueMarkup(s: string): { text: string; voice: string | null } {
  let voice: string | null = null;
  const v = /<v(?:\.[^\s>]+)?\s+([^>]+)>/i.exec(s);
  if (v) voice = v[1].trim();
  const text = s
    .replace(/<\/?(?:v|c|b|i|u|lang|ruby|rt)(?:[.\s][^>]*)?>/gi, "")
    .replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}>/g, "")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  return { text, voice };
}

const squash = (s: string) => s.replace(/[ \t ]+/g, " ").trim();

// Opeenvolgende segmenten van dezelfde spreker samenvoegen (tot MAX_SEGMENT_CHARS); lege segmenten weg.
export function mergeSegments(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const text = squash(s.text.replace(/\n+/g, " "));
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.speaker === s.speaker && last.speaker !== null && last.text.length + text.length + 1 <= MAX_SEGMENT_CHARS) {
      last.text = `${last.text} ${text}`;
      last.endMs = s.endMs ?? last.endMs;
      continue;
    }
    out.push({ speaker: s.speaker, startMs: s.startMs, endMs: s.endMs, text });
  }
  return out;
}

function finish(segments: Segment[], warnings: string[] = []): ParsedTranscript {
  let merged = mergeSegments(segments);
  if (merged.length > MAX_SEGMENTS) {
    warnings.push(`Het transcript had meer dan ${MAX_SEGMENTS} stukken; alleen de eerste ${MAX_SEGMENTS} zijn overgenomen.`);
    merged = merged.slice(0, MAX_SEGMENTS);
  }
  const speakers = [...new Set(merged.map((s) => s.speaker).filter((x): x is string => !!x))];
  return { segments: merged, speakers, hasTimestamps: merged.some((s) => s.startMs != null), warnings };
}

// "Naam: tekst" → spreker en tekst, alleen als de naam er als naam uitziet.
function splitSpeakerPrefix(line: string): { speaker: string; text: string } | null {
  const m = /^\s*([^:\n]{1,40}?)\s*:\s+([\s\S]*)$/u.exec(line);
  if (!m || !looksLikeName(m[1])) return null;
  return { speaker: squash(m[1]), text: m[2] };
}

// ---------------------------------------------------------------------------
// VTT, SRT en tekst met tijdcodes ("-->"), zoals de Teams-DOCX
// ---------------------------------------------------------------------------

type Cue = { startMs: number | null; endMs: number | null; lines: string[] };

function cuesFrom(lines: string[]): Cue[] {
  const cues: Cue[] = [];
  let cur: Cue | null = null;
  let skipBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const timing = CUE_TIMING.exec(line);
    if (timing) {
      cur = { startMs: parseTimestamp(timing[1]), endMs: parseTimestamp(timing[2]), lines: [] };
      cues.push(cur);
      skipBlock = false;
      continue;
    }
    if (/^\s*(NOTE|STYLE|REGION)\b/.test(line) && (!cur || cur.lines.length === 0 || lines[i - 1]?.trim() === "")) {
      skipBlock = true;
      continue;
    }
    if (line.trim() === "") {
      skipBlock = false;
      continue;
    }
    if (skipBlock || !cur) continue;
    // Een volgnummer of id (SRT "12", VTT "abc-1") op de regel direct boven de volgende tijdcode, na een lege regel.
    if ((i === 0 || lines[i - 1].trim() === "") && i + 1 < lines.length && CUE_TIMING.test(lines[i + 1]) && /^\s*\S{1,60}\s*$/.test(line)) continue;
    cur.lines.push(line);
  }
  return cues;
}

function segmentsFromCues(cues: Cue[], allowNameLine: boolean): Segment[] {
  const out: Segment[] = [];
  for (const c of cues) {
    const lines = c.lines;
    if (!lines.length) continue;
    let speaker: string | null = null;
    const parts: string[] = [];
    for (const raw of lines) {
      const { text, voice } = stripCueMarkup(raw);
      if (voice && !speaker) speaker = squash(voice);
      parts.push(text);
    }
    let text = parts.join("\n").trim();
    if (!speaker) {
      // Teams-DOCX: de eerste regel is de naam, daarna de tekst.
      if (allowNameLine && parts.length > 1 && looksLikeName(parts[0]) && !/:/.test(parts[0])) {
        speaker = squash(parts[0]);
        text = parts.slice(1).join("\n").trim();
      } else {
        const pre = splitSpeakerPrefix(text);
        if (pre) {
          speaker = pre.speaker;
          text = pre.text;
        }
      }
    }
    // Zoom: "[Naam] tekst".
    if (!speaker) {
      const b = /^\[([^\]]{1,40})\]\s*([\s\S]*)$/u.exec(text);
      if (b && looksLikeName(b[1])) {
        speaker = squash(b[1]);
        text = b[2];
      }
    }
    out.push({ speaker, startMs: c.startMs, endMs: c.endMs, text });
  }
  return out;
}

export function parseVtt(input: string): ParsedTranscript {
  const lines = input.replace(/\r\n?/g, "\n").replace(/^﻿/, "").split("\n");
  if (lines[0] && /^WEBVTT/.test(lines[0])) lines[0] = "";
  return finish(segmentsFromCues(cuesFrom(lines), false));
}

export function parseSrt(input: string): ParsedTranscript {
  const lines = input.replace(/\r\n?/g, "\n").replace(/^﻿/, "").split("\n");
  return finish(segmentsFromCues(cuesFrom(lines), false));
}

// ---------------------------------------------------------------------------
// Platte tekst (TXT, MD, DOCX, geplakt, Fathom)
// ---------------------------------------------------------------------------

// Kopregels met een tijd en een naam, waarna de tekst op de volgende regel(s) volgt:
//   "Jan de Vries   0:03"            (Teams, Otter)
//   "Jan de Vries (00:01:02)"        (diverse)
//   "0:00 - Jan de Vries"            (Fathom)
//   "[00:01:02] Jan de Vries"        (diverse)
const HEADER_NAME_TIME = new RegExp(`^\\s*(${NAME})\\s*[\\[(]?(${TIME})[\\])]?\\s*:?\\s*$`, "u");
const HEADER_TIME_NAME = new RegExp(`^\\s*[\\[(]?(${TIME})[\\])]?\\s*[-–—|]?\\s*(${NAME})\\s*:?\\s*$`, "u");
// Alles op één regel: "[00:01:02] Jan: tekst", "00:01:02 Jan: tekst", "Jan (00:01:02): tekst", "Jan [01:02]: tekst".
const INLINE_TIME_NAME = new RegExp(`^\\s*[\\[(]?(${TIME})[\\])]?\\s*[-–—|]?\\s*([^:\\n]{1,40}?)\\s*:\\s+(.*)$`, "u");
const INLINE_NAME_TIME = new RegExp(`^\\s*([^:\\n\\[(]{1,40}?)\\s*[\\[(](${TIME})[\\])]\\s*:\\s*(.*)$`, "u");
// Alleen een tijd vooraan: "[00:01:02] tekst".
const INLINE_TIME = new RegExp(`^\\s*\\[(${TIME})\\]\\s+(.*)$`, "u");

type Line =
  | { kind: "header"; speaker: string; startMs: number | null }
  | { kind: "inline"; speaker: string | null; startMs: number | null; text: string; candidate?: boolean }
  | { kind: "text"; text: string }
  | { kind: "blank" };

function classify(raw: string): Line {
  const line = raw.replace(/^\s*[-*>]\s+(?=\S)/, "").replace(/\*\*/g, ""); // Markdown: opsommingsteken, citaat, vet
  if (line.trim() === "") return { kind: "blank" };
  let m = HEADER_NAME_TIME.exec(line);
  if (m && looksLikeName(m[1])) return { kind: "header", speaker: squash(m[1]), startMs: parseTimestamp(m[2]) };
  m = HEADER_TIME_NAME.exec(line);
  if (m && looksLikeName(m[2])) return { kind: "header", speaker: squash(m[2]), startMs: parseTimestamp(m[1]) };
  m = INLINE_TIME_NAME.exec(line);
  if (m && looksLikeName(m[2])) return { kind: "inline", speaker: squash(m[2]), startMs: parseTimestamp(m[1]), text: m[3] };
  m = INLINE_NAME_TIME.exec(line);
  if (m && looksLikeName(m[1])) return { kind: "inline", speaker: squash(m[1]), startMs: parseTimestamp(m[2]), text: m[3] };
  m = INLINE_TIME.exec(line);
  if (m) return { kind: "inline", speaker: null, startMs: parseTimestamp(m[1]), text: m[2] };
  const pre = splitSpeakerPrefix(line);
  if (pre) return { kind: "inline", speaker: pre.speaker, startMs: null, text: pre.text, candidate: true };
  return { kind: "text", text: line };
}

export function parsePlainText(input: string): ParsedTranscript {
  const text = input.replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  const lines = text.split("\n");
  // Tijdcodes met "-->" (Teams-DOCX, geplakte VTT): als ondertiteling lezen.
  const arrows = lines.filter((l) => CUE_TIMING.test(l)).length;
  if (arrows >= 2) return finish(segmentsFromCues(cuesFrom(lines), true));

  const classified = lines.map(classify);
  // "Naam: tekst" zonder tijd is alleen een spreker als die naam vaker voorkomt (of een rol is): anders is
  // "Conclusie: …" in eigen notities geen spreker.
  const counts = new Map<string, number>();
  for (const c of classified) if (c.kind === "inline" && c.candidate && c.speaker) counts.set(c.speaker.toLowerCase(), (counts.get(c.speaker.toLowerCase()) ?? 0) + 1);
  const accepted = (name: string) => (counts.get(name.toLowerCase()) ?? 0) >= 2 || ROLE_LABELS.test(name);

  const segments: Segment[] = [];
  let cur: Segment | null = null;
  const flush = () => {
    if (cur && cur.text.trim()) segments.push(cur);
    cur = null;
  };
  let lastSpeaker: string | null = null;
  let fromHeader = false;
  for (let i = 0; i < classified.length; i++) {
    const c = classified[i];
    if (c.kind === "blank") {
      // Een lege regel sluit een alinea. Na een kopregel ("Naam  0:03") loopt de spreker door tot de volgende kop;
      // een regel "Naam: tekst" staat op zichzelf, dus daarna is een losse alinea van niemand ("Conclusie: …").
      flush();
      if (!fromHeader) lastSpeaker = null;
      continue;
    }
    if (c.kind === "header") {
      flush();
      lastSpeaker = c.speaker;
      fromHeader = true;
      cur = { speaker: c.speaker, startMs: c.startMs, endMs: null, text: "" };
      continue;
    }
    if (c.kind === "inline" && (!c.candidate || (c.speaker && accepted(c.speaker)))) {
      flush();
      if (c.speaker) fromHeader = false;
      lastSpeaker = c.speaker ?? lastSpeaker;
      cur = { speaker: c.speaker ?? lastSpeaker, startMs: c.startMs, endMs: null, text: c.text };
      continue;
    }
    const t = c.kind === "inline" ? lines[i].trim() : c.text.trim();
    if (!cur) cur = { speaker: lastSpeaker, startMs: null, endMs: null, text: t };
    else cur.text = cur.text ? `${cur.text}\n${t}` : t;
  }
  flush();
  // Eindtijden: het begin van het volgende segment (alleen als beide bekend zijn).
  for (let i = 0; i < segments.length - 1; i++) if (segments[i].endMs == null && segments[i + 1].startMs != null) segments[i].endMs = segments[i + 1].startMs;
  // Zonder sprekers: elke alinea is een eigen segment; mergeSegments voegt niets samen (spreker null).
  return finish(segments);
}

export function parseTranscript(format: TranscriptFormat, input: string): ParsedTranscript {
  if (format === "vtt") return parseVtt(input);
  if (format === "srt") return parseSrt(input);
  // Een geplakt of als TXT bewaard ondertitelbestand: herken het aan de kop.
  if (/^﻿?WEBVTT/.test(input)) return parseVtt(input);
  return parsePlainText(input);
}

// ---------------------------------------------------------------------------
// Genormaliseerde tekst met posities
// ---------------------------------------------------------------------------

// De kop van een regel: "[00:12:03] Spreker A: ", "Spreker A: ", "[00:12:03] " of niets.
export function segmentPrefix(s: Pick<Segment, "speaker" | "startMs">): string {
  const time = s.startMs != null ? `[${formatTimestamp(s.startMs)}] ` : "";
  const who = s.speaker ? `${s.speaker}: ` : "";
  return `${time}${who}`;
}

// Eén regel per segment. De tekst van segment i staat precies op [charStart, charEnd).
export function renderTranscript(segments: Segment[]): { text: string; placed: PlacedSegment[] } {
  let text = "";
  const placed: PlacedSegment[] = [];
  segments.forEach((s, i) => {
    if (i > 0) text += "\n";
    text += segmentPrefix(s);
    const charStart = text.length;
    text += s.text;
    placed.push({ ...s, charStart, charEnd: text.length });
  });
  return { text, placed };
}

// Het segment waarin een positie valt (of het eerste dat erna begint); -1 als er geen is.
export function segmentAt(placed: Pick<PlacedSegment, "charStart" | "charEnd">[], pos: number): number {
  for (let i = 0; i < placed.length; i++) {
    if (pos < placed[i].charEnd) return i;
  }
  return placed.length ? placed.length - 1 : -1;
}

// Compacte opslag (interviews.segments): geen tekst (die staat in het transcript zelf), wel spreker en posities.
export type StoredSegment = { s: string | null; t0: number | null; t1: number | null; a: number; b: number };

export function storeSegments(placed: PlacedSegment[]): StoredSegment[] {
  return placed.map((p) => ({ s: p.speaker, t0: p.startMs, t1: p.endMs, a: p.charStart, b: p.charEnd }));
}

export function readStoredSegments(raw: unknown, transcriptLength: number): StoredSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredSegment[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const a = Number(o.a);
    const b = Number(o.b);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < a || b > transcriptLength) continue;
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
    out.push({ s: typeof o.s === "string" ? o.s : null, t0: num(o.t0), t1: num(o.t1), a, b });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Vensters voor de AI
// ---------------------------------------------------------------------------

// Vensters van hoogstens maxChars tekens die op een segmentgrens beginnen en eindigen (een segment langer dan het
// venster wordt toch heel meegenomen), met overlap: het volgende venster begint bij het segment dat `overlap` tekens
// vóór het einde van het vorige begint.
export function transcriptWindows(
  text: string,
  placed: Pick<PlacedSegment, "charStart" | "charEnd">[],
  maxChars = AI_WINDOW_CHARS,
  overlap = AI_WINDOW_OVERLAP,
): { start: number; end: number }[] {
  if (text.length <= maxChars || placed.length === 0) return text.length ? [{ start: 0, end: text.length }] : [];
  // Het begin van regel i (met de kop) is het einde van regel i-1 plus de regelovergang.
  const lineStart = (i: number) => (i === 0 ? 0 : placed[i - 1].charEnd + 1);
  const windows: { start: number; end: number }[] = [];
  let first = 0;
  while (first < placed.length) {
    const start = lineStart(first);
    let last = first;
    while (last + 1 < placed.length && placed[last + 1].charEnd - start <= maxChars) last++;
    const end = placed[last].charEnd;
    windows.push({ start, end });
    if (last >= placed.length - 1) break;
    let next = last + 1;
    while (next - 1 > first && end - lineStart(next - 1) <= overlap) next--;
    first = Math.max(first + 1, next);
  }
  return windows;
}
