// Experimentencatalogus: ruwe resultaten van een handmatig sjabloon. Pure functies voor scherm, server en tests.
//
// Eén regel = één waarneming of één telling: een datum, hoeveel eenheden (n), hoeveel daarvan aan de vooraf
// vastgelegde teller voldoen, een notitie zonder namen en eventueel een bewijsbestand. Ingetrokken regels tellen niet.
// De meting is n = som van de eenheden, successen = som van de successen; het oordeel volgt de bestaande beslisregel
// van de methodeversie, pas na de eindconditie (lib/experiment-metrics.ts).

import { detectPii } from "./pseudonymize";

export const NOTE_MIN = 3;
export const NOTE_MAX = 1000;
export const WITHDRAW_REASON_MIN = 10;
export const MAX_UNITS = 100000;
// De bucket staat 10 MB toe; een server action neemt hooguit 4,5 MB per verzoek aan (next.config.ts).
export const EVIDENCE_MAX_BYTES = 4 * 1024 * 1024;
export const EVIDENCE_BUCKET = "manual-evidence";
export const EVIDENCE_TYPES = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "text/csv": "csv",
} as const;
export type EvidenceMime = keyof typeof EVIDENCE_TYPES;

export const MANUAL_SCHEMA_MISSING =
  "Handmatige sjablonen vragen een database-update (migratie 20261118100000_experiment_catalog). Tot die tijd kun je de catalogus bekijken en ingebouwde methodes gebruiken.";

export type ManualResultRow = {
  id: string;
  observed_on: string;
  units: number;
  successes: number;
  note: string;
  evidence_path: string | null;
  evidence_mime: string | null;
  created_at: string;
  withdrawn_at: string | null;
  withdraw_reason: string | null;
};

export type ManualTally = { n: number; successes: number; entries: number; withdrawn: number; withEvidence: number };

export function tallyManual(rows: Pick<ManualResultRow, "units" | "successes" | "withdrawn_at" | "evidence_path">[]): ManualTally {
  const t: ManualTally = { n: 0, successes: 0, entries: 0, withdrawn: 0, withEvidence: 0 };
  for (const r of rows) {
    if (r.withdrawn_at) {
      t.withdrawn++;
      continue;
    }
    t.entries++;
    t.n += Number(r.units) || 0;
    t.successes += Number(r.successes) || 0;
    if (r.evidence_path) t.withEvidence++;
  }
  return t;
}

export type ManualEntryInput = {
  observed_on: string;
  units: number | null;
  successes: number | null;
  note: string;
  today: string; // jjjj-mm-dd
  startedOn: string | null; // jjjj-mm-dd, start van de test
  evidence?: { mime: string; size: number } | null;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// Zelfde regels als de database (guard_manual_result), zodat een fout bij het juiste veld staat.
export function validateManualEntry(i: ManualEntryInput): Record<string, string> {
  const e: Record<string, string> = {};
  if (!ISO_DAY.test(i.observed_on)) e.observed_on = "Kies de datum van de waarneming.";
  else if (i.observed_on > i.today) e.observed_on = "Een waarneming ligt niet in de toekomst.";
  else if (i.startedOn && i.observed_on < i.startedOn) e.observed_on = "Alleen waarnemingen vanaf de start van de test tellen; wat ervoor gebeurde was niet vooraf vastgelegd.";
  if (i.units == null || !Number.isInteger(i.units) || i.units < 1) e.units = "Vul een aantal van minstens 1 in.";
  else if (i.units > MAX_UNITS) e.units = `Hooguit ${MAX_UNITS.toLocaleString("nl-NL")} per regel.`;
  if (i.successes == null || !Number.isInteger(i.successes) || i.successes < 0) e.successes = "Vul in hoeveel daarvan aan de teller voldoen (0 mag).";
  else if (i.units != null && i.successes > i.units) e.successes = "Er kunnen niet meer successen zijn dan het aantal.";
  const note = i.note.trim();
  if (note.length < NOTE_MIN) e.note = "Schrijf kort op wat je zag of telde, en waar.";
  else if (note.length > NOTE_MAX) e.note = `Hooguit ${NOTE_MAX} tekens.`;
  else {
    const pii = detectPii(note).filter((f) => f.kind === "email" || f.kind === "phone" || f.kind === "iban");
    if (pii.length) e.note = "Haal e-mailadressen, telefoonnummers en rekeningnummers uit de notitie: gebruik een code per persoon.";
  }
  if (i.evidence) {
    if (!(i.evidence.mime in EVIDENCE_TYPES)) e.evidence = "Alleen pdf, png, jpg, webp of csv.";
    else if (i.evidence.size < 1 || i.evidence.size > EVIDENCE_MAX_BYTES) e.evidence = "Het bestand is leeg of groter dan 4 MB.";
  }
  return e;
}

export function validateWithdrawReason(reason: string): string | null {
  return reason.trim().length < WITHDRAW_REASON_MIN ? `Leg in een zin uit waarom je deze regel intrekt (minstens ${WITHDRAW_REASON_MIN} tekens).` : null;
}

// Bestandsnaam voor de bucket: alleen veilige tekens, met de extensie van het type.
export function evidenceFileName(name: string, mime: EvidenceMime): string {
  const base = name.replace(/\.[^.]*$/, "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "bewijs";
  return `${base}.${EVIDENCE_TYPES[mime]}`;
}

// Het bestandstype volgt de inhoud, niet de opgegeven naam (zelfde aanpak als de toezeggingen).
export function sniffEvidence(bytes: Uint8Array, claimed: string): EvidenceMime | null {
  const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  if (starts([0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (claimed === "text/csv" || claimed === "application/vnd.ms-excel") {
    // Tekst zonder nulbytes in het begin.
    const head = bytes.slice(0, 2048);
    if (head.length > 0 && !head.includes(0)) return "text/csv";
  }
  return null;
}

// De samenvatting van de systeemwaarneming bij de Learning Card: altijd met "handmatig ingevoerd" en de methode.
export function manualSummary(i: { methodName: string; unitMany: string; n: number; successes: number; metricLabel: string; interval: string; entries: number }): string {
  return `Handmatig ingevoerd (${i.methodName}): ${i.successes} van ${i.n} ${i.unitMany}: ${i.metricLabel.toLowerCase()} (${i.interval}); ${i.entries} ${i.entries === 1 ? "regel" : "regels"} met notitie.`.slice(0, 400);
}
