import { EVIDENCE_LEVELS, type EvidenceCaps } from "@/lib/domain/evidence";
import { METHOD_VERSIONS, type MethodVersion } from "./types";

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

// Wat elke versie toevoegt aan de vorige, voor de overstappagina.
export const METHOD_CHANGES: Record<MethodVersion, string> = {
  "2026-11-a": "De oorspronkelijke rekenwijze: intervalregel per test, geen samenvoegen per bron en geen plafonds.",
  "2026-11-b": "Een beslisregel per testtype (kansregel of vast aantal), bewijs per bron één keer meetellen en een plafond per bewijsniveau.",
  "2026-11-c": "Herhaling binnen dezelfde wervingsgroep telt afnemend mee, AI-codering telt pas na beoordeling, alleen de hoofdtest per aanname beslist over de status van de aanname en indirect bewijs (een bevinding over een andere populatie, regio of een te oude peildatum) telt half.",
};

// De veranderingen tussen twee versies (alle versies na `from` tot en met `to`).
export function changesBetween(from: MethodVersion, to: MethodVersion): string[] {
  const i = METHOD_VERSIONS.indexOf(from);
  const j = METHOD_VERSIONS.indexOf(to);
  return METHOD_VERSIONS.slice(i + 1, j + 1).map((v) => `${v}: ${METHOD_CHANGES[v]}`);
}

export function ruleLabelText(rule: string | null | undefined): string {
  if (rule === "absolute") return "aantalregel";
  if (rule === "probability") return "kansregel";
  return "intervalregel";
}
