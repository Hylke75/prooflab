// Verlengde testfase (golf B, punt 20). Gedragsbewijs past niet altijd in de sprint: na de sprint kan het team één
// keer 2 tot 8 weken extra testen, met het tussenbesluit "doorgaan met testen" (extend). Het definitieve besluit en de
// uitkomstklok starten pas daarna. Zelfde regels als de database (guard_decision_extend, guard_clock_extension).

export const EXTEND_MIN_WEEKS = 2;
export const EXTEND_MAX_WEEKS = 8;
export const EXTEND_WEEK_OPTIONS = Array.from({ length: EXTEND_MAX_WEEKS - EXTEND_MIN_WEEKS + 1 }, (_, i) => EXTEND_MIN_WEEKS + i);

const FINAL = ["continue", "stop", "pause"];

function addDays(date: string, days: number): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export type DecisionLite = { action: string; decidedOn: string; extendWeeks: number | null }; // decidedOn: YYYY-MM-DD (NL)

// De verlengde fase van het dossier: start, einde en of hij nog loopt. Null als er geen verlengde fase is, of als er
// na de verlenging al een definitief besluit is genomen.
export function extendedPhase(decisions: DecisionLite[], today: string): { start: string; end: string; weeks: number; active: boolean } | null {
  const sorted = [...decisions].sort((a, b) => a.decidedOn.localeCompare(b.decidedOn));
  let phase: { start: string; end: string; weeks: number } | null = null;
  for (const d of sorted) {
    if (d.action === "extend" && d.extendWeeks) phase = { start: d.decidedOn, end: addDays(d.decidedOn, d.extendWeeks * 7), weeks: d.extendWeeks };
    else if (FINAL.includes(d.action)) phase = null;
  }
  return phase ? { ...phase, active: today < phase.end } : null;
}

// Waarom een besluit nu niet kan (null = mag). Eén verlengde fase per dossier; tijdens de fase geen definitief besluit.
export function extensionBlocker(action: string, decisions: DecisionLite[], today: string, clockStarted: boolean): string | null {
  if (action === "extend") {
    if (decisions.some((d) => d.action === "extend")) return "Dit dossier heeft al een verlengde testfase gehad. Neem nu een definitief besluit, of stuur bij.";
    if (clockStarted) return "Na een definitief besluit is er geen verlengde testfase meer.";
    return null;
  }
  const phase = extendedPhase(decisions, today);
  if (FINAL.includes(action) && phase?.active) return `De verlengde testfase loopt tot ${phase.end}. Het definitieve besluit en de uitkomstklok starten pas daarna.`;
  return null;
}
