// B0, punt 2: echte gesprekken en oefendata. Een interview is een echt gesprek (is_practice = false), een oefening
// of fictief gesprek (true) of nog niet aangegeven (null). Alleen een echt gesprek telt als bewijs; oefendata en
// niet-aangegeven gesprekken tellen nergens mee, ook niet in de coach. Pure functies, zonder database.

export type PracticeStatus = "real" | "practice" | "unknown";

export function practiceStatus(isPractice: boolean | null | undefined): PracticeStatus {
  return isPractice === false ? "real" : isPractice === true ? "practice" : "unknown";
}

// Alleen een uitdrukkelijk als echt gesprek aangegeven interview telt als bewijs.
export function countsAsEvidence(isPractice: boolean | null | undefined): boolean {
  return isPractice === false;
}

export const PRACTICE_LABELS: Record<PracticeStatus, { label: string; pill: string }> = {
  real: { label: "Echt gesprek", pill: "green" },
  practice: { label: "Oefening – telt niet als bewijs", pill: "coral" },
  unknown: { label: "Nog niet aangegeven – telt niet als bewijs", pill: "orange" },
};

// De ids van de interviews die als echt gesprek zijn aangegeven.
export function realInterviewIds(rows: { id: string; is_practice: boolean | null }[]): Set<string> {
  return new Set(rows.filter((r) => countsAsEvidence(r.is_practice)).map((r) => r.id));
}

// Een waarneming uit een interview dat niet als echt gesprek is aangegeven (oefening of onbekend). Waarnemingen
// zonder interview (uit tests met meetgebeurtenissen) vallen hier niet onder.
export function isPracticeObservation(o: { interview_id: string | null }, realIds: ReadonlySet<string>): boolean {
  return o.interview_id != null && !realIds.has(o.interview_id);
}

// Bij het laden: een waarneming uit oefendata wordt als synthetisch behandeld, want synthetische waarnemingen
// worden overal al uitgesloten. De gegevens zelf blijven ongewijzigd; is_practice houdt de reden zichtbaar.
export function withPracticeFlag<T extends { interview_id: string | null; is_synthetic: boolean }>(
  o: T,
  realIds: ReadonlySet<string>,
): T & { is_practice: boolean } {
  const practice = isPracticeObservation(o, realIds);
  return { ...o, is_practice: practice, is_synthetic: o.is_synthetic || practice };
}

// ---------------------------------------------------------------------------
// Fictief-detectie: woorden en namen die erop wijzen dat een transcript verzonnen of een oefening is
// ---------------------------------------------------------------------------

// Hele woorden: niet binnen een ander woord ("attest", "bijvoorbeeld" en "contest" tellen niet).
const L = "\\p{L}\\p{N}";
const FICTION_PATTERNS: RegExp[] = [
  "fictie(?:f|ve)",
  "verzonnen",
  "test(?:gesprek(?:ken)?|interview(?:s)?|persoon|klant|data)?",
  "voorbeeld(?:gesprek(?:ken)?|interview(?:s)?|transcript(?:en)?)?",
  `oefen[${L}]*`,
  "rollenspel(?:len)?",
  "dummy",
  "lorem\\s+ipsum",
  "john\\s+doe",
  "jane\\s+doe",
  "jan\\s+jansen",
].map((p) => new RegExp(`(?<![${L}])(?:${p})(?![${L}])`, "giu"));

// De gevonden signalen, elk één keer, in kleine letters en in de volgorde van de lijst hierboven.
export function fictionSignals(transcript: string): string[] {
  const found: string[] = [];
  for (const re of FICTION_PATTERNS) {
    for (const m of transcript.matchAll(re)) {
      const word = m[0].toLowerCase().replace(/\s+/g, " ");
      if (!found.includes(word)) found.push(word);
    }
  }
  return found;
}

// Waarschuwing bij een interview dat als echt gesprek is aangegeven terwijl het transcript fictief lijkt.
export function fictionWarning(signals: string[]): string | null {
  if (signals.length === 0) return null;
  return `Dit transcript lijkt fictief: ${signals.map((s) => `"${s}"`).join(", ")}; controleer de keuze.`;
}
