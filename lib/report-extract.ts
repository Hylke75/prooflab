import "server-only";
import { pdfPages } from "@/lib/pdf-text";
import { docxToText } from "@/lib/docx-text";
import {
  chunkText,
  cleanText,
  decodeText,
  joinPages,
  MAX_IMPORT_BYTES,
  MAX_PDF_PAGES,
  MAX_TEXT_CHARS,
  MIN_TEXT_CHARS,
  type ExtractError,
  type ImportExt,
  type ReportBlock,
} from "@/lib/domain/report-import";

// Tekst uit een geïmporteerd rapport halen en in blokken verdelen. Alleen lezen: geen macro's, scripts of
// ingesloten objecten; PDF via pdf.js zonder codegeneratie, DOCX via een eigen ZIP/XML-lezer.

export type Extracted = { ok: true; text: string; pages: number | null; blocks: ReportBlock[] } | { ok: false; reason: ExtractError };

export async function extractReport(data: Uint8Array, ext: ImportExt): Promise<Extracted> {
  if (data.byteLength > MAX_IMPORT_BYTES) return { ok: false, reason: "too_large" };
  let text: string;
  let pageStarts: number[] | null = null;
  let pages: number | null = null;
  if (ext === "pdf") {
    const res = await pdfPages(data, { maxBytes: MAX_IMPORT_BYTES, maxPages: MAX_PDF_PAGES });
    if (!res.ok) return { ok: false, reason: res.reason };
    const joined = joinPages(res.pages);
    text = joined.text;
    pageStarts = joined.pageStarts;
    pages = res.numPages;
  } else if (ext === "docx") {
    try {
      text = docxToText(data);
    } catch {
      return { ok: false, reason: "damaged" };
    }
  } else if (ext === "txt" || ext === "md" || ext === "csv") {
    // Een tekstbestand met nul-bytes is in werkelijkheid een binair bestand.
    if (data.subarray(0, 4096).includes(0)) return { ok: false, reason: "damaged" };
    text = cleanText(decodeText(data));
  } else {
    return { ok: false, reason: "unsupported" };
  }
  if (text.replace(/\s/g, "").length < MIN_TEXT_CHARS) return { ok: false, reason: "no_text" };
  if (text.length > MAX_TEXT_CHARS) return { ok: false, reason: "too_long" };
  return { ok: true, text, pages, blocks: chunkText(text, pageStarts) };
}
