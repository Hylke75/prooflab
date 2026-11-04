import { AiBudgetError, AiNotConfiguredError, AiRefusedError } from "@/lib/ai/client";
import { AiProviderError } from "@/lib/ai/providers/types";

// Fase B2, punt 5: een korte, eerlijke reden als een aanbieder faalt ("Gemini: mislukt" zonder uitleg was niet
// genoeg). De code gaat mee in de uitvoer van de stap; de tekst staat in het paneel naast "opnieuw proberen".

export type FailureCode = "timeout" | "quota" | "refused" | "auth" | "budget" | "server" | "network" | "rejected" | "not_configured" | "unknown";

export const FAILURE_TEXT: Record<FailureCode, string> = {
  timeout: "timeout: geen antwoord binnen de tijd",
  quota: "quotum of limiet bereikt",
  refused: "geweigerd door het model",
  auth: "API-sleutel geweigerd",
  budget: "budget van deze stap op",
  server: "storing bij de aanbieder",
  network: "niet bereikbaar",
  rejected: "verzoek afgewezen",
  not_configured: "niet verbonden",
  unknown: "onbekende fout",
};

export function failureCode(e: unknown): FailureCode {
  if (e instanceof AiRefusedError) return "refused";
  if (e instanceof AiBudgetError) return "budget";
  if (e instanceof AiNotConfiguredError) return "not_configured";
  if (e instanceof AiProviderError) {
    switch (e.kind) {
      case "timeout":
        return "timeout";
      case "rate_limit":
        return "quota";
      case "auth":
        return "auth";
      case "server":
        return "server";
      case "network":
        return "network";
      case "bad_request":
        return "rejected";
    }
  }
  if (e instanceof Error && /timeout|timed out|aborted/i.test(`${e.name} ${e.message}`)) return "timeout";
  return "unknown";
}

// Een quotum, timeout of storing gaat vaak vanzelf over; een geweigerde sleutel of een niet-verbonden aanbieder niet.
export const retryable = (code: FailureCode) => code !== "auth" && code !== "not_configured";

export type ProviderFailure = { provider: string; reason: FailureCode };

// De mislukte aanbieders uit de uitvoer van een zoek- of tegenbewijsstap (providers[]: { provider, ok, reason }).
export function failedProviders(output: unknown): ProviderFailure[] {
  const list = (output as { providers?: unknown } | null)?.providers;
  if (!Array.isArray(list)) return [];
  return list.flatMap((p) => {
    const row = p as { provider?: unknown; ok?: unknown; reason?: unknown; detail?: unknown };
    if (row.ok !== false || typeof row.provider !== "string") return [];
    const reason = typeof row.reason === "string" && row.reason in FAILURE_TEXT ? (row.reason as FailureCode) : "unknown";
    return [{ provider: row.provider, reason }];
  });
}
