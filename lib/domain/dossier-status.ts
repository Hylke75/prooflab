// Dossierstatus (fase B1c): één plek die per stap bepaalt of hij klaar is, loopt of nog leeg is, wat de huidige
// stap is en hoeveel stappen echt bewijs hebben. Dashboard, dossieroverzicht, stappenbalk en (later) het menu
// lezen allemaal deze functie, zodat ze nooit iets anders zeggen.
//
// De regels, expliciet:
// - Markt is "klaar" als de beslissende onderzoeksvraag is beantwoord met minstens één geverifieerde bevinding.
//   Tot fase B2 een vraag als beslissend markeert, is dat de eerste vraag (laagste positie). Anders: "Verkenning".
// - Aannames zijn "klaar" als er minstens één kritieke aanname (belang ≥ 4) met een aangewezen hoofdtest is.
// - Testen is "klaar" als er een afgeronde test is; "loopt" als er een test live of gepauzeerd is.
// - Besluit is "klaar" als er een besluit is vastgelegd.
// - "Stappen met bewijs" telt alleen stappen met echte (niet-synthetische) waarnemingen of geverifieerde bronnen.
//   Een ingevuld veld, een AI-tekst of een concepttest telt niet.

export type StepKey = "market" | "assumptions" | "test" | "decide";
export type StepState = "done" | "running" | "empty";

export type DossierInput = {
  questions: number;
  claims: number;
  verifiedClaims: number;
  decisiveQuestion: { status: string; verifiedClaims: number } | null;
  assumptions: number;
  criticalWithPrimaryTest: number;
  assumptionsWithEvidence: number;
  experiments: number;
  experimentsLive: number;
  experimentsEnded: number;
  realTestObservations: number; // niet-synthetische waarnemingen uit tests
  decisions: number;
};

export type DossierStep = {
  key: StepKey;
  number: number;
  label: string;
  state: StepState;
  statusLabel: string; // bijv. "Klaar", "Verkenning", "Test loopt", "Nog niet gestart"
  hasEvidence: boolean;
  why: string; // in gewone taal: waarom deze status
};

export type DossierStatus = {
  steps: DossierStep[];
  current: StepKey | "done";
  currentLabel: string;
  stepsWithEvidence: number;
};

export const STEP_LABELS: Record<StepKey, string> = { market: "Markt", assumptions: "Aannames", test: "Testen", decide: "Besluit" };

export function getDossierStatus(d: DossierInput): DossierStatus {
  const dq = d.decisiveQuestion;
  const marketDone = !!dq && dq.status === "answered" && dq.verifiedClaims > 0;
  const market: DossierStep = {
    key: "market",
    number: 1,
    label: STEP_LABELS.market,
    state: marketDone ? "done" : d.questions > 0 || d.claims > 0 ? "running" : "empty",
    statusLabel: marketDone ? "Klaar" : d.questions > 0 || d.claims > 0 ? "Verkenning" : "Nog niet gestart",
    hasEvidence: d.verifiedClaims > 0,
    why: marketDone
      ? "De beslissende onderzoeksvraag is beantwoord met minstens één geverifieerde bron."
      : !dq
        ? "Er is nog geen beslissende onderzoeksvraag."
        : dq.verifiedClaims === 0
          ? "De beslissende onderzoeksvraag heeft nog geen geverifieerde bron."
          : "De beslissende onderzoeksvraag staat nog niet op beantwoord.",
  };

  const assumptionsDone = d.criticalWithPrimaryTest > 0;
  const assumptions: DossierStep = {
    key: "assumptions",
    number: 2,
    label: STEP_LABELS.assumptions,
    state: assumptionsDone ? "done" : d.assumptions > 0 ? "running" : "empty",
    statusLabel: assumptionsDone ? "Klaar" : d.assumptions > 0 ? "Nog geen hoofdtest" : "Nog niet gestart",
    hasEvidence: d.assumptionsWithEvidence > 0 && (d.verifiedClaims > 0 || d.realTestObservations > 0),
    why: assumptionsDone
      ? "Minstens één kritieke aanname heeft een aangewezen hoofdtest."
      : d.assumptions > 0
        ? "Wijs bij een kritieke aanname een hoofdtest aan."
        : "Er zijn nog geen aannames.",
  };

  const testDone = d.experimentsEnded > 0;
  const test: DossierStep = {
    key: "test",
    number: 3,
    label: STEP_LABELS.test,
    state: testDone ? "done" : d.experimentsLive > 0 || d.experiments > 0 ? "running" : "empty",
    statusLabel: testDone ? "Klaar" : d.experimentsLive > 0 ? "Test loopt" : d.experiments > 0 ? "In voorbereiding" : "Nog niet gestart",
    hasEvidence: d.realTestObservations > 0,
    why: testDone ? "Er is minstens één afgeronde test." : d.experimentsLive > 0 ? "Er loopt een test; de uitkomst volgt na de eindconditie." : "Er is nog geen afgeronde test.",
  };

  const decideDone = d.decisions > 0;
  const decide: DossierStep = {
    key: "decide",
    number: 4,
    label: STEP_LABELS.decide,
    state: decideDone ? "done" : "empty",
    statusLabel: decideDone ? "Klaar" : "Nog niet besloten",
    hasEvidence: decideDone && (d.verifiedClaims > 0 || d.realTestObservations > 0),
    why: decideDone ? "Er is een besluit vastgelegd." : "Er is nog geen besluit vastgelegd.",
  };

  const steps = [market, assumptions, test, decide];
  // Huidige stap: loopt er een test, dan is dat de huidige stap (niet "Onderzoek"). Anders de eerste stap die
  // nog niet klaar is.
  const current: StepKey | "done" = !decideDone && d.experimentsLive > 0 ? "test" : (steps.find((s) => s.state !== "done")?.key ?? "done");
  const currentStep = steps.find((s) => s.key === current);
  const currentLabel = current === "done" ? "Besloten" : current === "test" && d.experimentsLive > 0 ? "Test loopt" : STEP_LABELS[current];
  return {
    steps,
    current,
    currentLabel: currentStep && current !== "test" && currentStep.state === "running" && current === "market" ? "Markt · verkenning" : currentLabel,
    stepsWithEvidence: steps.filter((s) => s.hasEvidence).length,
  };
}
