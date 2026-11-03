import "server-only";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { anthropic, AiRefusedError, costUsd, FALLBACK_BETAS, MODEL, RESEARCH_SYSTEM, type AiUsage } from "./client";
import type { IdeaContext } from "./research";
import { MOMENT_LABELS, PROBABILITY_MAX, PROBABILITY_MIN, type ForecastMoment } from "@/lib/domain/forecast";

// The model as one extra forecaster with its own score (docs/ProofLab_Voorspelkracht_v1.md §2 "Wat AI wel
// en niet kan"): it gives a probability with one sentence of reasoning. It never counts as evidence.

export type ForecastInput = {
  idea: IdeaContext;
  moment: ForecastMoment;
  outcome: { statement: string; metric: string | null; target: number | null };
  baseRate: { label: string; low: number | null; high: number | null; note: string | null };
  dossierSummary: string;
};

const ForecastSchema = z.object({
  // Range is stated in the description and clamped afterwards, so a borderline answer is not lost.
  probability_percent: z.number().describe("Kans in procenten, geheel getal tussen 5 en 95"),
  rationale: z.string().describe("Eén zin waarom, hooguit 300 tekens"),
});

const pct = (p: number | null) => (p == null ? "onbekend" : `${Math.round(p * 100)}%`);

export async function forecastOutcome(input: ForecastInput): Promise<{ data: { probability: number; rationale: string }; usage: AiUsage; model: string }> {
  const res = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    betas: [...FALLBACK_BETAS],
    fallbacks: "default",
    system: `${RESEARCH_SYSTEM}
Je bent een gekalibreerde voorspeller. Je geeft een kans dat een vooraf vastgelegde uitkomst wordt gehaald.
Werkwijze: begin bij het basispercentage (buitenperspectief) en pas het alleen aan op concreet bewijs uit het dossier.
Enthousiasme, meningen en AI-teksten zijn geen bewijs. Bij weinig bewijs blijf je dicht bij het basispercentage.
Geef een kans tussen 5 en 95 procent en één zin waarom (hooguit 300 tekens).`,
    output_config: { effort: "medium", format: betaZodOutputFormat(ForecastSchema) },
    messages: [
      {
        role: "user",
        content: `<idee>
Titel: ${input.idea.title}
Beslisvraag: ${input.idea.decisionQuestion}
Beschrijving: ${input.idea.description}
Doelgroep: ${input.idea.targetAudience}
Regio: ${input.idea.region}
Type project: ${input.idea.projectType}
Branche: ${input.idea.sector}
</idee>
<uitkomst>
Geslaagd als: ${input.outcome.statement}
Maatstaf: ${input.outcome.metric ?? "onbekend"}
Doelwaarde: ${input.outcome.target ?? "onbekend"}
Gemeten: zes maanden na het besluit
</uitkomst>
<basispercentage>
Referentie: ${input.baseRate.label}
Bandbreedte: ${pct(input.baseRate.low)} tot ${pct(input.baseRate.high)}
${input.baseRate.note ? `Toelichting: ${input.baseRate.note}` : ""}
</basispercentage>
<moment>${MOMENT_LABELS[input.moment].label}</moment>
<dossier>
${input.dossierSummary}
</dossier>
Hoe groot is de kans dat de uitkomst wordt gehaald?`,
      },
    ],
  });
  const usage: AiUsage = {
    cost: costUsd(res.usage),
    searches: res.usage.server_tool_use?.web_search_requests ?? 0,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };
  if (res.stop_reason === "refusal") throw new AiRefusedError("Het model weigerde deze voorspelling.", usage);
  const out = res.parsed_output;
  if (!out) throw new Error("Ongeldige gestructureerde uitvoer van het model.");
  const probability = Math.min(PROBABILITY_MAX, Math.max(PROBABILITY_MIN, Math.round(out.probability_percent) / 100));
  const rationale = out.rationale.trim().slice(0, 600);
  return { data: { probability, rationale: rationale.length >= 3 ? rationale : "Geen toelichting gegeven." }, usage, model: res.model ?? MODEL };
}
