import { ForecastPanel } from "./ForecastPanel";
import { getIdea } from "@/lib/data";
import { loadProgress } from "@/lib/progress";
import { loadForecastView } from "@/lib/forecast-data";

// The forecast at the decision moment, placed next to the decision on the evidence page. Also shown while
// the outcome is not defined yet, because the decision needs that definition first.
export async function DecisionForecast({ ideaId }: { ideaId: string }) {
  const access = await getIdea(ideaId);
  const view = await loadForecastView(access, await loadProgress(ideaId));
  if (!view || view.resolved) return null;
  if (view.openMoment !== "decision" && view.outcome.statement) return null;
  return <ForecastPanel view={view} compact />;
}
