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
export const OutcomeDefinitionSchema = z.object({
  outcome_statement: z.string().trim().min(10, "Beschrijf in één zin wanneer dit idee geslaagd is.").max(400, "Houd de uitkomst kort: hooguit 400 tekens."),
  outcome_metric: z.string().trim().min(2, "Noem wat je meet, bijvoorbeeld 'betalende klanten'.").max(160, "Houd de maatstaf kort: hooguit 160 tekens."),
  outcome_target: optionalAmount("De doelwaarde moet een getal van 0 of hoger zijn.").refine((n) => n !== null, "Geef de doelwaarde als getal."),
});
