// Gebruikerstest A10: verversen tijdens een onderzoeksrun. Een nieuwe verversing start pas als de vorige klaar is
// (components/research/ResearchRunPanel.tsx), en het interval groeit (× 1,5, tot 30 seconden) zolang er niets verandert;
// bij een wijziging in de voortgang begint het weer op 5 seconden.
export const REFRESH_MIN_MS = 5000;
export const REFRESH_MAX_MS = 30_000;

export function nextRefreshDelay(previous: number, changed: boolean): number {
  return changed ? REFRESH_MIN_MS : Math.min(REFRESH_MAX_MS, Math.round(previous * 1.5));
}
