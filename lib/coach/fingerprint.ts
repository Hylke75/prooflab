// Fingerprint of a dossier: counts and latest timestamps per part, plus the calendar day (time-based rules
// such as deadlines and test pace change from day to day). Stored as readable canonical text, so the coach
// can also tell the AI what changed since its last review.

export type FingerprintData = Record<string, string | number | boolean | null>;
export type Fingerprint = { day: string; data: FingerprintData };

export const FINGERPRINT_LABELS: Record<string, string> = {
  claims: "Bevindingen",
  claims_at: "Laatste bevinding",
  sources: "Bronnen",
  sources_at: "Laatste bron",
  competitors: "Concurrenten en alternatieven",
  competitors_at: "Laatste concurrent",
  assumptions: "Aannames",
  assumptions_at: "Laatste aanname",
  assumption_states: "Status van aannames",
  experiments: "Experimenten",
  experiments_at: "Laatste experiment",
  experiment_states: "Status van experimenten",
  test_events: "Meetgebeurtenissen in tests",
  interviews: "Interviews",
  interviews_real: "Interviews aangegeven als echt gesprek",
  recruitment_entries: "Wervingsregels",
  observations: "Observaties",
  observations_at: "Laatste observatie",
  learning_cards: "Leerkaarten",
  learning_cards_approved: "Goedgekeurde leerkaarten",
  reality_checks: "Realiteitschecks",
  reality_checks_at: "Laatste realiteitscheck",
  decisions: "Besluiten",
  decisions_at: "Laatste besluit",
  decisions_confirmed: "Bevestigde besluiten",
  forecasts: "Voorspellingen",
  outcome: "Uitkomst vastgelegd",
  outcome_defined: "Uitkomstdefinitie",
  base_rate_chosen: "Basispercentage gekozen",
  checkins: "Check-ins",
  outreach_replies: "Outreach-antwoorden",
  sprint_week: "Sprintweek",
};

const VERSION = "v1";

function canonical(data: FingerprintData): string {
  return JSON.stringify(Object.keys(data).sort().map((k) => [k, data[k] ?? null]));
}

export function makeFingerprint(fp: Fingerprint): string {
  return `${VERSION}|${fp.day}|${canonical(fp.data)}`;
}

export function parseFingerprint(s: string | null | undefined): Fingerprint | null {
  if (!s) return null;
  const m = s.match(/^v1\|(\d{4}-\d{2}-\d{2})\|([\s\S]*)$/);
  if (!m) return null;
  try {
    const pairs = JSON.parse(m[2]) as [string, string | number | boolean | null][];
    if (!Array.isArray(pairs)) return null;
    return { day: m[1], data: Object.fromEntries(pairs) };
  } catch {
    return null;
  }
}

// `any`: the rules must run again (data or day changed). `data`: the dossier itself changed, which is
// what justifies an AI review.
export function compareFingerprints(prev: string | null | undefined, next: string): { any: boolean; data: boolean } {
  if (!prev) return { any: true, data: true };
  if (prev === next) return { any: false, data: false };
  const a = parseFingerprint(prev);
  const b = parseFingerprint(next);
  if (!a || !b) return { any: true, data: true };
  return { any: true, data: canonical(a.data) !== canonical(b.data) };
}

const show = (v: string | number | boolean | null | undefined) =>
  v == null ? "geen" : typeof v === "boolean" ? (v ? "ja" : "nee") : typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : String(v);

// Dutch lines describing what changed, for the AI review. Timestamps only count when nothing else in
// that part changed, to keep the list short.
export function describeChanges(prev: string | null | undefined, next: string): string[] {
  const b = parseFingerprint(next);
  if (!b) return [];
  const a = parseFingerprint(prev);
  if (!a) return ["Eerste keer dat de coach dit dossier bekijkt."];
  const lines: string[] = [];
  for (const key of Object.keys(b.data).sort()) {
    if (key.endsWith("_at")) continue;
    if ((a.data[key] ?? null) !== (b.data[key] ?? null)) lines.push(`${FINGERPRINT_LABELS[key] ?? key}: ${show(a.data[key])} → ${show(b.data[key])}`);
  }
  for (const key of Object.keys(b.data).sort()) {
    if (!key.endsWith("_at")) continue;
    const countKey = key.slice(0, -3);
    if ((a.data[key] ?? null) !== (b.data[key] ?? null) && (a.data[countKey] ?? null) === (b.data[countKey] ?? null)) {
      lines.push(`${FINGERPRINT_LABELS[key] ?? key} bijgewerkt (${show(b.data[key])})`);
    }
  }
  return lines;
}
