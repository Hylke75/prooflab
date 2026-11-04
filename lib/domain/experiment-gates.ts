// Fase B0, punt 6: goedkeuren en afronden. Pure beslisfuncties voor de experimentpagina (vooraf tonen waarom
// een knop niet werkt) en de server (transitionExperiment dwingt hetzelfde af).

export const THRESHOLD_UNREACHABLE =
  "De drempel is met deze test niet aantoonbaar te halen. Kies een ander testtype of verleng de looptijd.";

// Goedkeuren (en ter review aanbieden) kan niet als ProofLab vooraf "drempel niet haalbaar" berekende: er is een
// beslisregel, maar geen benodigd aantal deelnemers. Dossiers zonder beslisregel (methode 2026-11-a) rekenen niet
// vooraf en worden hier niet geblokkeerd.
export function thresholdBlock(h: { decision_rule: string | null; required_n: number | null }): string | null {
  return h.decision_rule != null && h.required_n == null ? THRESHOLD_UNREACHABLE : null;
}

export const END_BELOW_SAMPLE_CONFIRM = "Ik rond af onder de minimale steekproef; de uitkomst telt niet mee in kans en rangorde";
export const END_REASON_MIN = 10;
export const END_REASON_MAX = 600;

export function belowMinSample(n: number, minSample: number | null | undefined): boolean {
  return minSample != null && minSample > 0 && n < minSample;
}

// Afronden onder de minimale steekproef vraagt een reden (minstens 10 tekens) en een bevestiging. Daarboven is er
// niets te vragen en wordt er geen reden bewaard.
export function checkEnd(input: { n: number; minSample: number | null | undefined; reason: string; confirmed: boolean }):
  | { ok: true; endReason: string | null }
  | { ok: false; error: string } {
  if (!belowMinSample(input.n, input.minSample)) return { ok: true, endReason: null };
  const reason = input.reason.trim();
  if (reason.length < END_REASON_MIN) {
    return { ok: false, error: `Je rondt af met ${input.n} van minimaal ${input.minSample} deelnemers. Leg in een zin uit waarom (minstens ${END_REASON_MIN} tekens).` };
  }
  if (!input.confirmed) return { ok: false, error: "Bevestig dat je afrondt onder de minimale steekproef en dat de uitkomst niet meetelt." };
  return { ok: true, endReason: reason.slice(0, END_REASON_MAX) };
}

// Fase B5: één beslisregel per dossier. Een hoofdtest start pas (approved → live) als de go-regel van het dossier is
// vastgelegd: anders kan de regel achteraf op de uitkomst worden afgestemd. Verkennende tests beslissen niets en
// worden niet geblokkeerd. rule: "saved" = er is een regel, "missing" = nog niet, "unknown" = de database kent de
// tabel nog niet (oudere omgeving): dan blokkeert ProofLab niet.
export const GO_RULE_MISSING =
  "Leg eerst de go-regel van het dossier vast. Een hoofdtest start pas als vaststaat wanneer je doorgaat, zodat niemand de regel achteraf op de uitkomst afstemt.";

export function goRuleBlock(input: { isPrimary: boolean; rule: "saved" | "missing" | "unknown" }): string | null {
  return input.isPrimary && input.rule === "missing" ? GO_RULE_MISSING : null;
}
