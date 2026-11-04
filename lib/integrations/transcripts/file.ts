import { readTranscriptBytes, readTranscriptText, type ReadTranscript } from "@/lib/transcript-file";
import { checkTranscriptFile, TRANSCRIPT_FILE_LABEL } from "@/lib/domain/transcript-parse";
import type { SourceStatus, TranscriptSource } from "./types";

// Fase 1 · punt 3: bestand of geplakte tekst. Altijd beschikbaar, ook als Fathom niet verbonden is. Het bestand wordt
// alleen in het geheugen gelezen en nergens bewaard (niet in step_documents of Storage).
export const fileSource: TranscriptSource & {
  readFile(name: string, bytes: Uint8Array): ReadTranscript;
  readPasted(text: string): ReadTranscript;
} = {
  id: "file",
  label: "Bestand of plakken",
  async status(): Promise<SourceStatus> {
    return { state: "connected", label: "Altijd beschikbaar", detail: `${TRANSCRIPT_FILE_LABEL} uit Teams, Zoom, Fathom of Otter, of geplakte tekst.` };
  },
  readFile(name, bytes) {
    const check = checkTranscriptFile({ name, size: bytes.byteLength });
    if (!check.ok) return { ok: false, error: check.error };
    return readTranscriptBytes(bytes, check.ext);
  },
  readPasted(text) {
    return readTranscriptText("paste", text);
  },
};
