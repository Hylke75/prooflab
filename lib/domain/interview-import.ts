// Fase 1 · punt 3: een geïmporteerd transcript klaarmaken voor opslag. Pure regels, gedeeld door de server action
// (saveImportedInterview) en de tests. Volgorde: keuzes van de consultant hercontroleren tegen het voorstel dat de
// server zelf opstelt (resolveDecisions), toepassen, het resultaat controleren (recheckPseudonymized), dan pas de
// genormaliseerde tekst met posities maken. Wat hier misgaat, wordt niet opgeslagen.

import { applyPseudonyms, countTerm, labelSummary, recheckPseudonymized, resolveDecisions, type DecisionInput, type LabelSummary, type PseudonymDecision } from "./pseudonymize";
import { renderTranscript, storeSegments, type Segment, type StoredSegment } from "./transcript-parse";

// De database staat tot 250.000 tekens toe; labels kunnen iets langer zijn dan de namen die ze vervangen.
export const MAX_STORED_TRANSCRIPT_CHARS = 250_000;
export const RETENTION_MONTHS = 12;

export const IMPORT_SCHEMA_MISSING =
  "Transcripten importeren vraagt een database-update (migratie 20261115090000_interviews_import). Tot die tijd plak je het transcript bij Interview toevoegen.";
export const DUPLICATE_IMPORT = "Dit transcript is al geïmporteerd in dit dossier. Eén gesprek telt één keer.";
export const EXPLORATORY_INTERVIEW_NOTE =
  "Verkennend interview: geeft richting en telt mee in thema's (X van N geïnterviewden), maar beslist nooit over een aanname, de kans of het besluit.";

// Of een databasefout betekent dat de migratie nog niet is toegepast (onbekende kolom, tabel of functie).
export function missingImportSchema(error: { message?: string | null; code?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const m = error.message ?? "";
  return (
    error.code === "PGRST204" ||
    error.code === "PGRST202" ||
    error.code === "PGRST205" ||
    error.code === "42703" ||
    error.code === "42P01" ||
    error.code === "42883" ||
    (/source_format|source_hash|segments|pseudonym|quote_start|theme_only|interview_codes|observation_codes|experiment_id/.test(m) && /column|schema cache|null value|does not exist|relation|function/i.test(m))
  );
}

// Bewaartermijn: 12 maanden na de gespreksdatum (niet na de import). "2026-03-31" → "2027-03-31"; 29 februari → 28.
export function retentionFrom(heldOn: string): string {
  const [y, m, d] = heldOn.split("-").map(Number);
  const target = new Date(Date.UTC(y + Math.floor((m - 1 + RETENTION_MONTHS) / 12), (m - 1 + RETENTION_MONTHS) % 12, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

// Een gesprek in de toekomst bestaat niet; een gesprek ouder dan de bewaartermijn hoort niet meer in ProofLab.
export function heldOnError(heldOn: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(heldOn)) return "Vul de datum van het gesprek in.";
  if (heldOn > today) return "De datum van het gesprek ligt in de toekomst.";
  if (retentionFrom(heldOn) < today) return `Dit gesprek is ouder dan ${RETENTION_MONTHS} maanden: de bewaartermijn is al verstreken. Importeer het niet.`;
  return null;
}

// Het pseudoniem van de deelnemer mag geen gevonden naam bevatten ("Peter (penningmeester)").
export function participantLabelError(label: string, decisions: PseudonymDecision[]): string | null {
  if (/@|\b\d{9,}\b|\b06[\s-]?\d{8}\b/.test(label)) return "Gebruik een pseudoniem, geen e-mailadres of telefoonnummer.";
  const hit = decisions.find((d) => d.term.length >= 3 && (d.kind === "speaker" || d.kind === "person") && countTerm(label, d.term, "person") > 0);
  return hit ? "Het pseudoniem bevat een naam uit het transcript. Gebruik bijvoorbeeld 'Deelnemer A' of een functie." : null;
}

export type PreparedImport =
  | { ok: true; transcript: string; segments: StoredSegment[]; labels: LabelSummary; decisions: PseudonymDecision[]; speakers: string[] }
  | { ok: false; errors: string[] };

export function prepareImport(original: Segment[], input: DecisionInput[], extraNames: string[] = []): PreparedImport {
  const { decisions, errors } = resolveDecisions(original, input, extraNames);
  if (errors.length) return { ok: false, errors };
  const after = applyPseudonyms(original, decisions);
  const check = recheckPseudonymized(after, decisions);
  if (!check.ok) return { ok: false, errors: check.problems.map((p) => `${p} Controleer de pseudonimisering opnieuw.`) };
  const { text, placed } = renderTranscript(after);
  if (text.length > MAX_STORED_TRANSCRIPT_CHARS) return { ok: false, errors: ["Het transcript is na pseudonimiseren te lang om op te slaan. Splits het in delen."] };
  return {
    ok: true,
    transcript: text,
    segments: storeSegments(placed),
    labels: labelSummary(original, decisions),
    decisions,
    speakers: [...new Set(after.map((s) => s.speaker).filter((x): x is string => !!x))],
  };
}

// Keuzes uit het formulier (JSON); ongeldige invoer is een lege lijst (dan geldt het voorstel van de server).
export function parseDecisionsField(raw: unknown): DecisionInput[] {
  if (typeof raw !== "string" || raw.length > 400_000) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as DecisionInput[]) : [];
  } catch {
    return [];
  }
}

export function parseNamesField(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.length > 20_000) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 80)).slice(0, 100) : [];
  } catch {
    return [];
  }
}
