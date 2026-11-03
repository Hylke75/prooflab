import { isProvider, PROVIDERS, type ProviderId } from "./config";

// Which provider runs which task. Pure, so it can be tested without a database or keys.

export const AI_TASKS = ["research", "coach", "survey", "promo", "forecast"] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const AI_TASK_LABELS: Record<AiTask, { label: string; help: string }> = {
  research: { label: "Marktonderzoek", help: "Onderzoekskaart, citaten controleren, aannames, interviews, tegenbewijs en testteksten." },
  coach: { label: "Coach", help: "Antwoorden en procesadviezen van de coach." },
  survey: { label: "Enquête-opzet", help: "Eerste opzet van een enquête." },
  promo: { label: "Uitnodigingsberichten", help: "Berichten per platform om deelnemers te werven." },
  forecast: { label: "Voorspelling", help: "De AI-voorspelling naast die van mensen." },
};

export type AiSettings = {
  defaultProvider: ProviderId;
  tasks: Partial<Record<AiTask, ProviderId | null>>;
  // Web research and the AI forecast use every connected provider (each call logged and capped).
  ensemble: boolean;
};

export const DEFAULT_AI_SETTINGS: AiSettings = { defaultProvider: "anthropic", tasks: {}, ensemble: true };

// Purposes as logged in ai_runs → the task whose provider choice applies.
export function taskForPurpose(purpose: string): AiTask {
  if (purpose === "coach" || purpose.startsWith("coach_")) return "coach";
  if (purpose === "survey_draft") return "survey";
  if (purpose === "promo_posts") return "promo";
  if (purpose === "forecast") return "forecast";
  return "research";
}

export type ProviderPick = { provider: ProviderId; chosen: ProviderId; fallback: boolean };

// The chosen provider for a task (task choice, else the default). When that provider has no key, any configured
// provider takes over (the default first, then the fixed order); null when no provider is configured at all.
export function pickProvider(settings: AiSettings, task: AiTask, configured: readonly ProviderId[]): ProviderPick | null {
  const chosen = settings.tasks[task] ?? settings.defaultProvider;
  if (configured.includes(chosen)) return { provider: chosen, chosen, fallback: false };
  const order = [settings.defaultProvider, ...PROVIDERS];
  const alt = order.find((p) => configured.includes(p));
  return alt ? { provider: alt, chosen, fallback: true } : null;
}

// Providers for a task that may run on several providers (web research, forecast): the picked one first, then
// the other configured providers when the ensemble is on.
export function ensembleProviders(settings: AiSettings, task: AiTask, configured: readonly ProviderId[]): ProviderId[] {
  const pick = pickProvider(settings, task, configured);
  if (!pick) return [];
  if (!settings.ensemble) return [pick.provider];
  return [pick.provider, ...PROVIDERS.filter((p) => p !== pick.provider && configured.includes(p))];
}

type SettingsRow = {
  default_provider: string;
  research_provider: string | null;
  coach_provider: string | null;
  survey_provider: string | null;
  promo_provider: string | null;
  forecast_provider: string | null;
  ensemble: boolean;
};

export function settingsFromRow(row: SettingsRow | null | undefined): AiSettings {
  if (!row) return DEFAULT_AI_SETTINGS;
  const opt = (v: string | null) => (isProvider(v) ? v : null);
  return {
    defaultProvider: isProvider(row.default_provider) ? row.default_provider : "anthropic",
    tasks: {
      research: opt(row.research_provider),
      coach: opt(row.coach_provider),
      survey: opt(row.survey_provider),
      promo: opt(row.promo_provider),
      forecast: opt(row.forecast_provider),
    },
    ensemble: row.ensemble,
  };
}

// Mean of several AI forecasts (an ensemble). Null when there are none.
export function ensembleMean(probabilities: readonly number[]): number | null {
  const xs = probabilities.filter((p) => Number.isFinite(p));
  if (xs.length === 0) return null;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
