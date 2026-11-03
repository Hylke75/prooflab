// Weergave van kansen (golf A, punt 3). Zolang de organisatie te weinig opgeloste dossiers heeft om haar eigen
// kansen te toetsen (dezelfde grens als het eigen basispercentage: OWN_BASE_RATE_MIN), tonen we een kans in een
// band van 10 procentpunt met het label "niet gekalibreerd". De exacte waarde blijft beschikbaar (tooltip).
// Eén helper voor scherm, rapport en PDF; alleen weergave, de berekening verandert niet.

import { OWN_BASE_RATE_MIN } from "@/lib/domain/forecast";

export const CALIBRATION_MIN_RESOLVED = OWN_BASE_RATE_MIN;
export const UNCALIBRATED_LABEL = "niet gekalibreerd";

export type CalibrationStatus = { resolved: number; calibrated: boolean };

export function calibrationStatus(resolved: number | null | undefined): CalibrationStatus {
  const n = Number.isFinite(resolved) ? Math.max(0, Math.floor(Number(resolved))) : 0;
  return { resolved: n, calibrated: n >= CALIBRATION_MIN_RESOLVED };
}

export type ProbabilityText = {
  text: string; // wat er op het scherm staat: "40–50%" of "43%"
  exact: string; // de exacte waarde: "43,2%"
  label: string | null; // "niet gekalibreerd" of null
  title: string; // tooltip
};

const exactPct = (p: number) => `${(Math.round(p * 1000) / 10).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`;
const clamp01 = (p: number) => Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0));

// Band van 10 procentpunt waar p in valt: 0,43 → [40, 50]; 1 → [90, 100].
export function bandOf(p: number): { low: number; high: number } {
  const low = Math.min(90, Math.floor(clamp01(p) * 10 + 1e-9) * 10);
  return { low, high: low + 10 };
}

export function formatProbability(p: number, calibrated: boolean): ProbabilityText {
  const exact = exactPct(clamp01(p));
  if (calibrated) return { text: `${Math.round(clamp01(p) * 100)}%`, exact, label: null, title: `Exacte waarde: ${exact}` };
  const b = bandOf(p);
  return {
    text: `${b.low}–${b.high}%`,
    exact,
    label: UNCALIBRATED_LABEL,
    title: `Exacte waarde: ${exact}. Niet gekalibreerd: er zijn nog minder dan ${CALIBRATION_MIN_RESOLVED} opgeloste dossiers om deze kansen aan te toetsen, daarom een band van 10 procentpunt.`,
  };
}

// Een bandbreedte (laag–hoog). Niet gekalibreerd: naar buiten afgerond op 10 procentpunt.
export function formatProbabilityRange(low: number, high: number, calibrated: boolean): ProbabilityText {
  const exact = `${exactPct(clamp01(low))}–${exactPct(clamp01(high))}`;
  if (calibrated) return { text: `${Math.round(clamp01(low) * 100)}–${Math.round(clamp01(high) * 100)}%`, exact, label: null, title: `Exacte waarden: ${exact}` };
  const lo = bandOf(low).low;
  const hi = Math.max(lo + 10, Math.min(100, Math.ceil(clamp01(high) * 10 - 1e-9) * 10));
  return { text: `${lo}–${hi}%`, exact, label: UNCALIBRATED_LABEL, title: `Exacte waarden: ${exact}. Niet gekalibreerd, daarom afgerond op 10 procentpunt.` };
}

// Platte tekst voor rapport en PDF: "40–50% (niet gekalibreerd)".
export function probabilityPlain(p: number, calibrated: boolean): string {
  const f = formatProbability(p, calibrated);
  return f.label ? `${f.text} (${f.label})` : f.text;
}
