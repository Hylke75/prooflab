import { z } from "zod";
import { BUSINESS_CASE_VERSION, DEFAULT_SCENARIOS, MAX_AMOUNT, MAX_LIST, revenueKnown, type BusinessCaseInputs } from "@/lib/domain/business-case";

// Strikte controle van wat de browser opstuurt: alleen bekende velden, eindige getallen binnen grenzen, korte teksten.
// Wat niet past wordt geweigerd met een begrijpelijke melding (zie saveBusinessCase).

const amount = z.number().finite().min(0).max(MAX_AMOUNT);
const value = z
  .object({
    v: amount.nullable(),
    label: z.enum(["estimate", "confirmed", "proposal"]),
    source: z.string().trim().max(300).nullable().optional(),
  })
  .strict()
  .refine((x) => x.label !== "confirmed" || (x.source ?? "").trim().length >= 3, { message: "Een bevestigd cijfer heeft een herkomst nodig (bijv. offerte, contract of bron)." });
const pct = value.refine((x) => x.v == null || x.v <= 100, { message: "Een percentage ligt tussen 0 en 100." });
const id = z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/);
const name = z.string().trim().min(1, "Geef elke post een naam.").max(80);
const adjust = z
  .object({
    volumePct: z.number().finite().min(-90).max(300),
    pricePct: z.number().finite().min(-90).max(300),
    costPct: z.number().finite().min(-90).max(300),
    delayMonths: z.number().int().min(0).max(36),
  })
  .strict();

const stream = z
  .object({
    id,
    kind: z.enum(["subscription", "unit_sale", "service", "rental", "funding", "other"]),
    name,
    volume: value,
    price: value,
    unitCost: value,
    slotsPerWeek: value.refine((x) => x.v == null || x.v <= 21, { message: "Een week heeft hooguit 21 dagdelen." }).optional(),
    occupancyPct: pct.optional(),
    churnPct: pct.optional(),
    cac: value.optional(),
    certainty: z.enum(["certain", "applied", "idea"]).optional(),
  })
  .strict();

export const BusinessCaseSchema = z
  .object({
    version: z.literal(BUSINESS_CASE_VERSION),
    description: z.string().max(2000),
    question: z.string().max(600),
    goal: z.enum(["profitable", "capital", "breakeven", "coverage"]).nullable(),
    streams: z.array(stream).max(MAX_LIST),
    ramp: z.enum(["direct", "fast", "medium", "slow"]).nullable(),
    growthPctPerYear: z.number().finite().min(-50).max(500),
    fixedCosts: z.array(z.object({ id, name, perMonth: value }).strict()).max(MAX_LIST),
    investments: z.array(z.object({ id, name, amount: value, years: z.number().int().min(1).max(30) }).strict()).max(MAX_LIST),
    horizonMonths: z.union([z.literal(36), z.literal(60)]),
    scenarios: z.object({ conservative: adjust, optimistic: adjust }).strict(),
    answered: z.array(z.enum(["idea", "earn", "sales", "growth", "unit_costs", "fixed", "invest", "goal"])).max(8),
  })
  .strict();

// Opgeslagen invoer van een oudere of beschadigde vorm: wat niet te lezen is, valt terug op leeg; nooit een crash.
export function parseStoredInputs(raw: unknown): BusinessCaseInputs | null {
  const r = BusinessCaseSchema.safeParse(raw);
  if (r.success) return r.data as BusinessCaseInputs;
  if (raw && typeof raw === "object" && !("scenarios" in raw)) {
    const r2 = BusinessCaseSchema.safeParse({ ...raw, scenarios: DEFAULT_SCENARIOS });
    if (r2.success) return r2.data as BusinessCaseInputs;
  }
  return null;
}

export function firstIssue(e: z.ZodError): string {
  const i = e.issues[0];
  return i?.message && !/^(Expected|Invalid|Number must|String must|Too)/.test(i.message) ? i.message : "Een of meer waarden kloppen niet. Controleer de getallen (0 of hoger).";
}

// Stand voor de takenlijst: berekend zodra omzet en vaste kosten bekend zijn.
export function businessCaseState(raw: unknown): "none" | "started" | "calculated" {
  if (raw == null) return "none";
  const x = parseStoredInputs(raw);
  if (!x) return "none";
  if (revenueKnown(x) && x.answered.includes("fixed")) return "calculated";
  return x.answered.length > 0 || x.streams.length > 0 ? "started" : "none";
}
