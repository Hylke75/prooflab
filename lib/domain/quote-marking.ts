// Fase 1 · punt 3: markeren om te citeren. De consultant selecteert een stuk van het (gepseudonimiseerde) transcript;
// de browser stuurt het citaat met begin en einde. De server accepteert het alleen als
//   1. transcript.slice(begin, einde) genormaliseerd precies het citaat is (een verschoven positie of gewijzigde tekst
//      valt af), en
//   2. de bestaande citaatcontrole (checkQuote) het citaat letterlijk in het transcript vindt, en
//   3. het binnen één uitspraak (segment) valt.
// Na het eerste citaat verandert het transcript niet meer (ook niet door opnieuw te pseudonimiseren): anders zouden
// citaten en posities niet meer kloppen. De database dwingt dat ook af (stamp_interview_import).
// Puur: geen database, geen DOM.

import { pseudonymizeCounting, type PseudonymDecision } from "./pseudonymize";
import { readStoredSegments, renderTranscript, storeSegments, type StoredSegment } from "./transcript-parse";
import { checkQuote, normalizeText } from "./verify";

export const MIN_QUOTE_CHARS = 8;
export const MAX_QUOTE_CHARS = 1500;
export const PURGED_TRANSCRIPT = "[verwijderd na afloop van de bewaartermijn]";
export const LINK_CHANGES_PROBABILITY =
  "Koppel je dit citaat aan een aanname, dan verandert de kans van die aanname (per persoon geteld: één gesprek levert per bewijsniveau en richting hoogstens één waarneming).";
export const TRANSCRIPT_FROZEN = "Er hangen al citaten aan dit transcript: de tekst (en dus de pseudonimisering) verandert niet meer.";

export type MarkCheck = { ok: true; quote: string; segmentIndex: number | null } | { ok: false; reason: string };

// Regels om te tonen: de opgeslagen segmenten, of (geplakt of zonder segmenten) één regel per tekstregel.
export function displaySegments(transcript: string, stored: unknown): StoredSegment[] {
  const segs = readStoredSegments(stored, transcript.length);
  if (segs.length) return segs;
  const out: StoredSegment[] = [];
  let pos = 0;
  for (const line of transcript.split("\n")) {
    if (line.length) out.push({ s: null, t0: null, t1: null, a: pos, b: pos + line.length });
    pos += line.length + 1;
  }
  return out;
}

export function checkMarkedQuote(transcript: string, start: number, end: number, quote: string, segments: StoredSegment[] = []): MarkCheck {
  if (transcript === PURGED_TRANSCRIPT) return { ok: false, reason: "Het transcript is verwijderd na afloop van de bewaartermijn." };
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > transcript.length) {
    return { ok: false, reason: "Markeer een stuk tekst in het transcript." };
  }
  const q = quote.trim();
  if (q.length < MIN_QUOTE_CHARS) return { ok: false, reason: `Een citaat is minstens ${MIN_QUOTE_CHARS} tekens.` };
  if (end - start > MAX_QUOTE_CHARS || q.length > MAX_QUOTE_CHARS) return { ok: false, reason: `Een citaat is hoogstens ${MAX_QUOTE_CHARS} tekens. Markeer een korter stuk.` };
  if (normalizeText(transcript.slice(start, end)) !== normalizeText(q)) {
    return { ok: false, reason: "Het citaat komt niet overeen met de gemarkeerde plek in het transcript. Is het transcript gewijzigd? Markeer opnieuw." };
  }
  if (checkQuote(q, transcript) !== "exact") return { ok: false, reason: "Het citaat staat niet letterlijk in het transcript." };
  let segmentIndex: number | null = null;
  if (segments.length) {
    segmentIndex = segments.findIndex((s) => start >= s.a && end <= s.b);
    if (segmentIndex < 0) return { ok: false, reason: "Markeer binnen één uitspraak, zonder de tijd en de spreker." };
  }
  return { ok: true, quote: q, segmentIndex };
}

// Toegankelijk alternatief voor selecteren: het geplakte of getypte citaat opzoeken. Alleen als het precies één keer
// voorkomt; anders vraagt ProofLab om te selecteren.
export function locateQuote(transcript: string, quote: string): { start: number; end: number } | { error: string } {
  const q = quote.trim().replace(/\s+/g, " ");
  if (q.length < MIN_QUOTE_CHARS) return { error: `Een citaat is minstens ${MIN_QUOTE_CHARS} tekens.` };
  const find = (hay: string, needle: string) => {
    const hits: number[] = [];
    for (let i = hay.indexOf(needle); i >= 0 && hits.length < 2; i = hay.indexOf(needle, i + 1)) hits.push(i);
    return hits;
  };
  let hits = find(transcript, q);
  if (hits.length === 0) hits = find(transcript.toLowerCase(), q.toLowerCase());
  if (hits.length === 0) return { error: "Dit citaat staat niet letterlijk in het transcript. Kopieer het precies, of selecteer het." };
  if (hits.length > 1) return { error: "Dit citaat staat meer dan eens in het transcript. Selecteer de juiste plek." };
  return { start: hits[0], end: hits[0] + q.length };
}

// Mag het transcript nog veranderen (bijv. een gemiste naam alsnog vervangen)? Alleen zolang er geen observaties zijn.
export function transcriptChangeAllowed(observations: number): { ok: true } | { ok: false; reason: string } {
  return observations > 0 ? { ok: false, reason: TRANSCRIPT_FROZEN } : { ok: true };
}

// Een gemiste naam alsnog vervangen in een opgeslagen (al gepseudonimiseerd) transcript, met nieuwe posities.
export function replaceInStored(transcript: string, stored: unknown, decision: PseudonymDecision): { transcript: string; segments: StoredSegment[] | null; count: number } {
  const segs = readStoredSegments(stored, transcript.length);
  const counts = new Map<string, number>();
  if (!segs.length) {
    const out = pseudonymizeCounting(transcript, [decision], counts);
    return { transcript: out, segments: null, count: counts.get(decision.label) ?? 0 };
  }
  const rebuilt = segs.map((s) => {
    const speaker = s.s === decision.term ? decision.label : s.s;
    if (speaker !== s.s) counts.set(decision.label, (counts.get(decision.label) ?? 0) + 1);
    return { speaker, startMs: s.t0, endMs: s.t1, text: pseudonymizeCounting(transcript.slice(s.a, s.b), [decision], counts) };
  });
  const { text, placed } = renderTranscript(rebuilt);
  return { transcript: text, segments: storeSegments(placed), count: counts.get(decision.label) ?? 0 };
}
