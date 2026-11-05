import "server-only";
import { createHash } from "node:crypto";
import { checkTranscriptFile, renderTranscript, type ParsedTranscript, type TranscriptFormat } from "@/lib/domain/transcript-parse";
import { readTranscriptBytes, readTranscriptText } from "@/lib/transcript-file";
import { fathomSource } from "@/lib/integrations/transcripts/fathom-server";

// Fase 1 · punt 3: de bron van een te importeren transcript uit een formulier: een bestand (alleen in het geheugen,
// nooit bewaard), geplakte tekst of een Fathom-opname (achter FATHOM_ENABLED). Dezelfde functie bij "lees in"
// (voorstel) en bij opslaan (hercontrole): de server vertrouwt nooit een gepseudonimiseerde tekst uit de browser.

export type Source = { ok: true; format: TranscriptFormat; parsed: ParsedTranscript; hash: string; label: string } | { ok: false; error: string; field?: string };

// SHA-256 van de originele tekst (genormaliseerd), tegen dubbele import. De tekst zelf wordt niet bewaard.
export function sourceHash(parsed: ParsedTranscript): string {
  return createHash("sha256").update(renderTranscript(parsed.segments).text).digest("hex");
}

export async function readSource(ideaId: string, form: FormData): Promise<Source> {
  const file = form.get("file");
  const pasted = String(form.get("pasted") ?? "");
  const recording = String(form.get("fathom_recording") ?? "").trim();
  if (file instanceof File && file.size > 0) {
    const check = checkTranscriptFile({ name: file.name, size: file.size });
    if (!check.ok) return { ok: false, error: check.error, field: "file" };
    const r = readTranscriptBytes(new Uint8Array(await file.arrayBuffer()), check.ext);
    if (!r.ok) return { ok: false, error: r.error, field: "file" };
    return { ok: true, format: check.ext, parsed: r.parsed, hash: sourceHash(r.parsed), label: file.name.slice(0, 120) };
  }
  if (recording) {
    const r = await fathomSource().fetchTranscript(ideaId, recording);
    if (!r.ok) return { ok: false, error: r.error, field: "fathom_recording" };
    const t = readTranscriptText("fathom", r.text);
    if (!t.ok) return { ok: false, error: t.error, field: "fathom_recording" };
    return { ok: true, format: "fathom", parsed: t.parsed, hash: sourceHash(t.parsed), label: r.title };
  }
  if (pasted.trim()) {
    if (pasted.length > 1_000_000) return { ok: false, error: "De geplakte tekst is te lang. Splits het transcript in delen.", field: "pasted" };
    const r = readTranscriptText("paste", pasted);
    if (!r.ok) return { ok: false, error: r.error, field: "pasted" };
    return { ok: true, format: "paste", parsed: r.parsed, hash: sourceHash(r.parsed), label: "Geplakte tekst" };
  }
  return { ok: false, error: "Kies een bestand of plak het transcript.", field: "file" };
}
