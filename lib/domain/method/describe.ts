import { EVIDENCE_LEVELS, type EvidenceCaps } from "@/lib/domain/evidence";

export type Methodology = {
  version: string;
  label: string;
  rules: string[];
  caps: EvidenceCaps | null;
  capsCustom: boolean;
};

const pctR = (x: number) => `${Math.round(x * 1000) / 10}%`.replace(".", ",");

// Tekst over de gebruikte methode voor rapport en PDF. Rapporten van vóór de methodeversie hebben geen
// methodology; die zijn met methode 2026-11-a gemaakt.
export function describeMethodology(m: Methodology | null | undefined): { title: string; lines: string[] } {
  if (!m) {
    return {
      title: "Methode 2026-11-a",
      lines: ["Dit rapport is gemaakt vóór de methodeversies werden vastgelegd en rekent met methode 2026-11-a: de intervalregel per test, geen samenvoegen per bron en geen plafonds."],
    };
  }
  const lines = [...m.rules];
  if (m.caps) {
    const caps = EVIDENCE_LEVELS.map((l) => `${l.label.toLowerCase()} ${l.level === "repeat" ? "geen plafond" : pctR(m.caps![l.level as keyof EvidenceCaps])}`).join("; ");
    lines.push(`Gebruikte plafonds per bewijsniveau (${m.capsCustom ? "ingesteld door de werkruimte" : "standaardwaarden"}): ${caps}.`);
  } else {
    lines.push("Geen plafonds per bewijsniveau (die horen bij methode 2026-11-b).");
  }
  return { title: m.label, lines };
}

export function ruleLabelText(rule: string | null | undefined): string {
  if (rule === "absolute") return "aantalregel";
  if (rule === "probability") return "kansregel";
  return "intervalregel";
}
