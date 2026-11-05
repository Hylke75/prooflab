// Fase 1 · punt 3: een transcriptbestand uitlezen, alleen in het geheugen. Het originele bestand wordt nergens
// bewaard (niet in step_documents of Storage): het kan namen bevatten, opdrachtgevers kunnen documenten lezen en
// voor documenten geldt geen bewaartermijn. Alleen de gepseudonimiseerde tekst wordt opgeslagen.

import { docxToText, ZipError } from "@/lib/docx-text";
import { decodeText } from "@/lib/domain/report-import";
import { MAX_TRANSCRIPT_CHARS, MIN_TRANSCRIPT_CHARS, parseTranscript, renderTranscript, type ParsedTranscript, type TranscriptFileExt, type TranscriptFormat } from "@/lib/domain/transcript-parse";

export type ReadTranscript = { ok: true; parsed: ParsedTranscript; chars: number } | { ok: false; error: string };

export const TRANSCRIPT_ERRORS = {
  docx: "Dit Word-bestand kon niet worden gelezen (beschadigd, versleuteld of geen DOCX). Sla het opnieuw op als DOCX of exporteer het als tekst.",
  empty: `Er staat te weinig tekst in (minimaal ${MIN_TRANSCRIPT_CHARS} tekens). Is het een leeg of gescand bestand?`,
  too_long: `Het transcript is langer dan ${MAX_TRANSCRIPT_CHARS.toLocaleString("nl-NL")} tekens. Splits het in delen en importeer ze als aparte gesprekken.`,
} as const;

export function textFromTranscriptBytes(bytes: Uint8Array, ext: TranscriptFileExt): { ok: true; text: string } | { ok: false; error: string } {
  if (ext === "docx") {
    try {
      return { ok: true, text: docxToText(bytes) };
    } catch (e) {
      if (e instanceof ZipError) return { ok: false, error: TRANSCRIPT_ERRORS.docx };
      throw e;
    }
  }
  return { ok: true, text: decodeText(bytes) };
}

// Tekst (uit een bestand, geplakt of van Fathom) → segmenten, met de grenzen van ProofLab.
export function readTranscriptText(format: TranscriptFormat, text: string): ReadTranscript {
  const parsed = parseTranscript(format, text);
  const chars = renderTranscript(parsed.segments).text.length;
  const body = parsed.segments.reduce((n, s) => n + s.text.length, 0);
  if (body < MIN_TRANSCRIPT_CHARS) return { ok: false, error: TRANSCRIPT_ERRORS.empty };
  if (chars > MAX_TRANSCRIPT_CHARS) return { ok: false, error: TRANSCRIPT_ERRORS.too_long };
  return { ok: true, parsed, chars };
}

export function readTranscriptBytes(bytes: Uint8Array, ext: TranscriptFileExt): ReadTranscript {
  const t = textFromTranscriptBytes(bytes, ext);
  if (!t.ok) return t;
  return readTranscriptText(ext, t.text);
}
