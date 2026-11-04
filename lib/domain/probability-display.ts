// Weergave van kansen (golf A, punt 3). Zolang de organisatie te weinig opgeloste dossiers heeft om haar eigen
// kansen te toetsen (dezelfde grens als het eigen basispercentage: OWN_BASE_RATE_MIN), tonen we een kans in een
// band van 10 procentpunt rond de waarde met het label "niet gekalibreerd". De exacte waarde blijft beschikbaar (tooltip).
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

// Band van 10 procentpunt rond de waarde (gebruikerstest C6): het midden is p afgerond op 10 procentpunt, de band loopt
// 5 procentpunt naar beide kanten, begrensd op 0–100. 0,43 → [35, 45]; 0,47 → [45, 55]; 0,01 → [0, 5]; 1 → [95, 100].
// Zo ligt de exacte waarde altijd binnen 5 procentpunt van het midden (vroeger 0,49 → "40–50%", ver van 49%).
export function bandOf(p: number): { low: number; high: number } {
  const c = Math.round(clamp01(p) * 10 + 1e-9) * 10;
  return { low: Math.max(0, c - 5), high: Math.min(100, c + 5) };
}

const span = (low: number, high: number) => (low === high ? `${low}%` : `${low}–${high}%`);

export function formatProbability(p: number, calibrated: boolean): ProbabilityText {
  const exact = exactPct(clamp01(p));
  // De tooltip noemt alleen de exacte waarde; de uitleg over kalibratie staat één keer per kaart (gebruikerstest C6).
  const title = `Exacte waarde: ${exact}`;
  if (calibrated) return { text: `${Math.round(clamp01(p) * 100)}%`, exact, label: null, title };
  const b = bandOf(p);
  return { text: span(b.low, b.high), exact, label: UNCALIBRATED_LABEL, title };
}

// Een bandbreedte (laag–hoog). Niet gekalibreerd: van de onderkant van de band van laag tot de bovenkant van de band van
// hoog. Vallen laag en hoog samen, dan één getal ("40%").
export function formatProbabilityRange(low: number, high: number, calibrated: boolean): ProbabilityText {
  const a = exactPct(clamp01(low));
  const b = exactPct(clamp01(high));
  const exact = a === b ? a : `${a}–${b}`;
  const title = a === b ? `Exacte waarde: ${a}` : `Exacte waarden: ${exact}`;
  if (calibrated) return { text: span(Math.round(clamp01(low) * 100), Math.round(clamp01(high) * 100)), exact, label: null, title };
  return { text: span(bandOf(low).low, bandOf(high).high), exact, label: UNCALIBRATED_LABEL, title };
}

// Platte tekst voor rapport en PDF: "40–50% (niet gekalibreerd)".
export function probabilityPlain(p: number, calibrated: boolean): string {
  const f = formatProbability(p, calibrated);
  return f.label ? `${f.text} (${f.label})` : f.text;
}
