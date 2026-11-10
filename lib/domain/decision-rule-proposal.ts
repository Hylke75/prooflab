// Fase B5: de beslisregel van het dossier als voorstel bij de eerste testkaart. Zolang een dossier geen beslisregel heeft,
// stelt ProofLab bij de eerste hoofdtest voor: doorgaan als de kritieke aannames minstens 70% kans halen én deze
// hoofdtest slaagt. De consultant legt het voorstel met één klik vast (save_decision_rule) of past het aan op de
// aannamepagina. Pure functies; de database bewaakt de vergrendeling.
//
// Gebruikerstest B1: het voorstel neemt standaard álle kritieke aannames mee die nu getest worden (gekozen om nu te
// testen én belang 5), plus altijd de aanname van de hoofdtest. Een kritieke aanname eruit halen kan, maar alleen met
// een motivering; die komt in de toelichting van de regel ("Uitgesloten: <aanname> – <reden>") en dus in audit en rapport.

import { DEVIATION_MIN_CHARS, type DecisionRule } from "./decision-rule";

// Standaard minimale kans voor de aanname in het voorstel. Ruim boven een gok (50%), maar haalbaar met één
// geslaagde hoofdtest; de consultant kan de kans aanpassen op de aannamepagina.
export const GO_RULE_DEFAULT_PROBABILITY = 0.7;
// Belang vanaf waar een gekozen aanname kritiek is voor de beslisregel.
export const GO_RULE_CRITICAL_IMPORTANCE = 5;
// De toelichting van een beslisregel mag maximaal 600 tekens zijn (zelfde grens als de database).
export const RULE_NOTE_MAX = 600;

export type GoRuleCondition = { assumptionId: string; statement: string; minProbability: number; main: boolean };

export type GoRuleProposal = {
  assumptionId: string;
  experimentId: string;
  minProbability: number;
  // Gebruikerstest B1: alle voorwaarden van het voorstel (de aanname van de hoofdtest eerst).
  conditions: GoRuleCondition[];
  sentence: string;
};

export type ProposalAssumption = { id: string; statement: string; importance?: number | null; selectedForTest?: boolean | null };

// Kritiek voor de beslisregel: gekozen om nu te testen en belang 5.
export const isCriticalForRule = (a: Pick<ProposalAssumption, "importance" | "selectedForTest">): boolean =>
  a.selectedForTest === true && (a.importance ?? 0) >= GO_RULE_CRITICAL_IMPORTANCE;

// Voorstel alleen als het dossier nog geen regel heeft (rule === null; undefined = tabel onbekend) en de test de
// hoofdtest van zijn aanname is. Een verkennende test kan het besluit niet beslissen (primary-test.ts).
export function proposeGoRule(input: {
  rule: DecisionRule | null | undefined;
  assumption: { id: string; statement: string };
  experiment: { id: string; title: string };
  isPrimary: boolean;
  // Alle aannames van het dossier (gebruikerstest B1); zonder lijst alleen de aanname van de hoofdtest.
  assumptions?: ProposalAssumption[];
}): GoRuleProposal | null {
  if (input.rule !== null || !input.isPrimary) return null;
  const minProbability = GO_RULE_DEFAULT_PROBABILITY;
  const others = (input.assumptions ?? []).filter((a) => a.id !== input.assumption.id && isCriticalForRule(a));
  const conditions: GoRuleCondition[] = [
    { assumptionId: input.assumption.id, statement: input.assumption.statement, minProbability, main: true },
    ...others.map((a) => ({ assumptionId: a.id, statement: a.statement, minProbability, main: false })),
  ];
  const pctText = `${Math.round(minProbability * 100)}%`;
  const sentence =
    conditions.length === 1
      ? `Doorgaan als de hoofdtest "${input.experiment.title}" slaagt en de aanname "${input.assumption.statement}" minstens ${pctText} kans haalt.`
      : `Doorgaan als de hoofdtest "${input.experiment.title}" slaagt en deze ${conditions.length} aannames elk minstens ${pctText} kans halen: ${conditions.map((c) => `"${c.statement}"`).join(", ")}.`;
  return { assumptionId: input.assumption.id, experimentId: input.experiment.id, minProbability, conditions, sentence };
}

// Toelichting die met het voorstel wordt opgeslagen, zodat in audit en rapport zichtbaar is waar de regel vandaan komt.
export const GO_RULE_NOTE = "Voorgesteld door ProofLab bij de eerste testkaart en met één klik vastgelegd door de consultant.";

// Gebruikerstest B1: een kritieke aanname uit de regel halen vraagt een motivering van minstens DEVIATION_MIN_CHARS
// tekens. Geeft de fout (per ontbrekende motivering één zin) of de regels voor de toelichting. Zelfde controle op de
// testpagina (adoptProposedGoRule) en op de aannamepagina (saveDecisionRule).
export function excludedCriticalCheck(input: {
  critical: { id: string; statement: string }[];
  chosenIds: string[];
  reasons: Record<string, string | null | undefined>;
  baseNote?: string | null;
}): { error: string; missing: string[] } | { error: null; note: string; excluded: string[] } {
  const excluded = input.critical.filter((a) => !input.chosenIds.includes(a.id));
  const missing = excluded.filter((a) => (input.reasons[a.id] ?? "").trim().length < DEVIATION_MIN_CHARS);
  if (missing.length) {
    return {
      error: `Je haalt ${missing.length === 1 ? "een kritieke aanname" : `${missing.length} kritieke aannames`} uit de regel. Leg per aanname in minstens ${DEVIATION_MIN_CHARS} tekens uit waarom: ${missing.map((a) => `"${a.statement}"`).join(", ")}.`,
      missing: missing.map((a) => a.id),
    };
  }
  const lines = excluded.map((a) => `Uitgesloten: ${a.statement} – ${(input.reasons[a.id] ?? "").trim().replace(/\s+/g, " ")}`);
  const note = [input.baseNote?.trim(), ...lines].filter(Boolean).join(" · ");
  if (note.length > RULE_NOTE_MAX) {
    return { error: `De toelichting met de motiveringen is te lang (${note.length} van maximaal ${RULE_NOTE_MAX} tekens). Maak de motiveringen korter.`, missing: [] };
  }
  return { error: null, note, excluded: excluded.map((a) => a.id) };
}
