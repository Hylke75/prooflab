// Fase B5: de go-regel van het dossier als voorstel bij de eerste Test Card. Zolang een dossier geen beslisregel heeft,
// stelt ProofLab bij de eerste hoofdtest voor: doorgaan als deze aanname minstens 70% kans haalt én deze hoofdtest
// slaagt. De consultant legt het voorstel met één klik vast (save_decision_rule) of past het aan op de aannamepagina.
// Pure functies; de database bewaakt de vergrendeling.

import type { DecisionRule } from "./decision-rule";

// Standaard minimale kans voor de aanname in het voorstel. Ruim boven een gok (50%), maar haalbaar met één
// geslaagde hoofdtest; de consultant kan de kans aanpassen op de aannamepagina.
export const GO_RULE_DEFAULT_PROBABILITY = 0.7;

export type GoRuleProposal = {
  assumptionId: string;
  experimentId: string;
  minProbability: number;
  sentence: string;
};

// Voorstel alleen als het dossier nog geen regel heeft (rule === null; undefined = tabel onbekend) en de test de
// hoofdtest van zijn aanname is. Een verkennende test kan het besluit niet beslissen (primary-test.ts).
export function proposeGoRule(input: {
  rule: DecisionRule | null | undefined;
  assumption: { id: string; statement: string };
  experiment: { id: string; title: string };
  isPrimary: boolean;
}): GoRuleProposal | null {
  if (input.rule !== null || !input.isPrimary) return null;
  const minProbability = GO_RULE_DEFAULT_PROBABILITY;
  return {
    assumptionId: input.assumption.id,
    experimentId: input.experiment.id,
    minProbability,
    sentence: `Doorgaan als de hoofdtest "${input.experiment.title}" slaagt en de aanname "${input.assumption.statement}" minstens ${Math.round(minProbability * 100)}% kans haalt.`,
  };
}

// Toelichting die met het voorstel wordt opgeslagen, zodat in audit en rapport zichtbaar is waar de regel vandaan komt.
export const GO_RULE_NOTE = "Voorgesteld door ProofLab bij de eerste Test Card en met één klik vastgelegd door de consultant.";
