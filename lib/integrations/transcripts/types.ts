// Fase 1 · punt 3: bronnen van interviewtranscripten. Elke bron levert platte tekst die daarna precies dezelfde weg
// gaat als een bestand: segmenten (lib/domain/transcript-parse.ts), pseudonimiseren met controle door de consultant
// (lib/domain/pseudonymize.ts) en hercontrole op de server. Een bron bewaart zelf niets.

export type TranscriptSourceId = "file" | "fathom";

export type SourceStatus =
  | { state: "connected"; label: string; detail: string }
  // Niet verbonden: altijd met een bruikbaar handmatig alternatief.
  | { state: "not_connected"; label: string; detail: string; alternative: string };

export type RecordingSummary = { id: string; title: string; heldOn: string | null; url: string | null };

export type FetchedTranscript = { ok: true; text: string; title: string; heldOn: string | null } | { ok: false; error: string };

export interface TranscriptSource {
  id: TranscriptSourceId;
  label: string;
  status(ideaId: string): Promise<SourceStatus>;
}

export interface RemoteTranscriptSource extends TranscriptSource {
  listRecordings(ideaId: string, opts?: { limit?: number }): Promise<{ ok: true; recordings: RecordingSummary[] } | { ok: false; error: string }>;
  fetchTranscript(ideaId: string, recordingId: string): Promise<FetchedTranscript>;
}
