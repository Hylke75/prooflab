import { z } from "zod";

// Dutch number input: "1.500" and "1.500,5" use dots for thousands and a comma for decimals.
export function parseDutchNumber(raw: string): number {
  const s = raw.replace(/\s/g, "");
  if (s.includes(",")) return Number(s.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ""));
  return Number(s);
}

// An optional non-negative number from a form field; empty becomes null.
export const optionalAmount = (msg: string) =>
  z
    .string()
    .trim()
    .transform((s) => (s === "" ? null : parseDutchNumber(s)))
    .refine((n) => n === null || (Number.isFinite(n) && n >= 0), msg);

// What "geslaagd" means, measured six months after the decision (docs/ProofLab_Voorspelkracht_v1.md §3.1).
// Naast het aantal ook een waarde: een minimumbedrag per klant en/of een omzetdoel (minstens één van beide,
// zie outcomeValueProblem) en optioneel een geplande meetdatum binnen zes maanden na de beslisdatum.
export const OutcomeDefinitionSchema = z.object({
  outcome_statement: z.string().trim().min(10, "Beschrijf in één zin wanneer dit idee geslaagd is.").max(400, "Houd de uitkomst kort: hooguit 400 tekens."),
  outcome_metric: z.string().trim().min(2, "Noem wat je meet, bijvoorbeeld 'betalende klanten'.").max(160, "Houd de maatstaf kort: hooguit 160 tekens."),
  outcome_target: optionalAmount("De doelwaarde moet een getal van 0 of hoger zijn.").refine((n) => n !== null, "Geef de doelwaarde als getal."),
  outcome_min_value_per_customer: optionalAmount("Het minimumbedrag per klant moet een bedrag van 0 of hoger zijn.").optional(),
  outcome_revenue_target: optionalAmount("Het omzetdoel moet een bedrag van 0 of hoger zijn.").optional(),
  outcome_measure_date: z
    .string()
    .trim()
    .transform((s) => (s === "" ? null : s))
    .refine((s) => s === null || /^\d{4}-\d{2}-\d{2}$/.test(s), "Kies een geldige meetdatum.")
    .nullable()
    .optional(),
});

export type OutcomeDefinition = z.infer<typeof OutcomeDefinitionSchema>;

// Een aantal alleen zegt weinig: 15 klanten van € 10 is iets anders dan 15 klanten van € 2.000.
export function outcomeValueProblem(v: Pick<OutcomeDefinition, "outcome_min_value_per_customer" | "outcome_revenue_target">): string | null {
  const per = v.outcome_min_value_per_customer ?? null;
  const rev = v.outcome_revenue_target ?? null;
  if ((per === null || per <= 0) && (rev === null || rev <= 0)) return "Vul ook een minimumbedrag per klant of een omzetdoel in (minstens één van beide).";
  return null;
}
