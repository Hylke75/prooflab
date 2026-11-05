import "server-only";
import { cache } from "react";
import { loadAssumptionInputs, loadInformationValue, loadProgress } from "@/lib/progress";
import { loadCalibration } from "@/lib/method-data";
import { nextAction, openDecisionAction, type IdeaProgress } from "@/lib/domain/coach";
import { evidenceStanding, nextFromInformationValue, type EvidenceStanding, type StandingNext } from "@/lib/domain/evidence-standing";

export type StandingPage = "overview" | "evidence" | "report";

// Op Besluit (en in het rapport): eerst de stap na een besluit dat het traject gaande houdt, anders de coach.
function coachNext(p: IdeaProgress): StandingNext {
  const a = openDecisionAction(p) ?? nextAction(p);
  return { title: a.title, detail: a.detail, href: a.href };
}

// Fase 1, punt 2: de Stand van het bewijs van één idee. Bovenop de bestaande ladingen (allemaal React cache, dus op
// een pagina die ze al gebruikt geen extra queries): kans en bewijsregister per aanname (loadInformationValue), tests
// (loadAssumptionInputs), de coach (loadProgress) en de kalibratiestatus (loadCalibration).
export const loadEvidenceStanding = cache(async (ideaId: string, page: StandingPage = "overview"): Promise<EvidenceStanding> => {
  const [ranked, inputs, progress, calibration] = await Promise.all([loadInformationValue(ideaId), loadAssumptionInputs(ideaId), loadProgress(ideaId), loadCalibration(ideaId)]);
  const next = page === "overview" ? (nextFromInformationValue(ideaId, ranked) ?? coachNext(progress)) : coachNext(progress);
  return evidenceStanding({
    ideaId,
    assumptions: ranked.map((a) => ({
      id: a.id,
      statement: a.statement,
      importance: a.importance,
      selectedForTest: a.selectedForTest,
      probability: a.probability,
      register: a.register,
      primaryExperimentId: a.primaryExperimentId,
    })),
    tests: inputs.tests,
    next,
    calibrated: calibration.calibrated,
  });
});
