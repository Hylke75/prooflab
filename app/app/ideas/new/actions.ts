"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/data";
import { insertDerivedQuestions } from "@/lib/research-questions-data";
import type { IntakeFacts } from "@/lib/research-questions";
import { defaultFactors, MODEL_FACTORS, type ScenarioKind, type SizingModel } from "@/lib/domain/sizing";
import { OutcomeDefinitionSchema, optionalAmount, outcomeValueProblem } from "@/lib/forecast-schemas";
import { measureWindowProblem } from "@/lib/domain/forecast";
import { STAKE_KINDS, formatStake } from "@/lib/domain/decision-quality";
import { todayInNL } from "@/lib/domain/sprint";

export type IntakeState = { error: string | null; field?: string };

const optionalText = z
  .string()
  .trim()
  .max(2000)
  .transform((s) => (s === "" ? null : s))
  .nullable()
  .optional();

const IntakeSchema = z.object({
  decision_question: z.string().trim().min(10, "Beschrijf de beslissing in minimaal één korte zin.").max(400),
  ...OutcomeDefinitionSchema.shape,
  // Inzet en beslisdatum zijn verplicht voor nieuwe intakes (bestaande ideeën blijven geldig zonder).
  stake_kind: z.enum(STAKE_KINDS, { message: "Kies wat er op het spel staat: bedrag, tijd of capaciteit." }),
  stake_value: optionalAmount("De inzet moet een getal van 0 of hoger zijn.").refine((n) => n !== null && n > 0, "Vul in hoeveel er op het spel staat (een getal groter dan 0)."),
  decision_deadline: z
    .string()
    .trim()
    .refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s), "Kies de uiterlijke beslisdatum.")
    .refine((s) => s >= todayInNL(), "De beslisdatum ligt in het verleden. Kies vandaag of later."),
  title: z.string().trim().min(2, "Geef het idee een korte naam.").max(140),
  description: z.string().trim().min(15, "Beschrijf het idee in minimaal één zin.").max(2000),
  target_audience: z.string().trim().min(2, "Kies of beschrijf de doelgroep.").max(200),
  audience_detail: optionalText,
  region: z.string().trim().min(2, "Kies een regio.").max(120),
  region_detail: optionalText,
  project_type: z.enum(["new_business", "new_product", "expansion", "revenue_model", "internal_innovation"], { message: "Kies het type project." }),
  sector_template: z.enum(["generic", "smb", "events", "media_culture"]),
  key_uncertainty: optionalText,
  sprint_start: z
    .string()
    .trim()
    .transform((s) => (s === "" ? null : s))
    .refine((s) => s === null || /^\d{4}-\d{2}-\d{2}$/.test(s), "Kies een geldige startdatum voor de sprint.")
    .nullable()
    .optional(),
  sprint_weeks: z.coerce.number().int().min(2, "Een sprint duurt minimaal 2 weken.").max(12, "Een sprint duurt maximaal 12 weken.").default(5),
  client_id: z.string().trim().optional(),
  new_client_name: z.string().trim().max(160).optional(),
});

export async function createIdea(_: IntakeState, form: FormData): Promise<IntakeState> {
  const ws = await getWorkspace();
  if (!ws.org) return { error: "Maak eerst een werkruimte aan." };
  const parsed = IntakeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue.message, field: String(issue.path[0] ?? "") };
  }
  const v = parsed.data;
  const valueProblem = outcomeValueProblem(v);
  if (valueProblem) return { error: valueProblem, field: "outcome_min_value_per_customer" };
  const windowProblem = v.outcome_measure_date ? measureWindowProblem(v.outcome_measure_date, v.decision_deadline) : null;
  if (windowProblem) return { error: windowProblem, field: "outcome_measure_date" };
  const supabase = await supabaseServer();

  let clientId: string | null = v.client_id && /^[0-9a-f-]{36}$/i.test(v.client_id) ? v.client_id : null;
  if (!clientId && v.new_client_name) {
    const { data: client, error } = await supabase
      .from("clients")
      .insert({ org_id: ws.org.id, name: v.new_client_name, sector: v.sector_template })
      .select("id")
      .single();
    if (error) return { error: "De klant kon niet worden opgeslagen." };
    clientId = client.id;
  }

  const { data: idea, error } = await supabase
    .from("ideas")
    .insert({
      org_id: ws.org.id,
      client_id: clientId,
      title: v.title,
      decision_question: v.decision_question,
      outcome_statement: v.outcome_statement,
      outcome_metric: v.outcome_metric,
      outcome_target: v.outcome_target,
      outcome_min_value_per_customer: v.outcome_min_value_per_customer ?? null,
      outcome_revenue_target: v.outcome_revenue_target ?? null,
      outcome_measure_date: v.outcome_measure_date ?? null,
      stake_kind: v.stake_kind,
      stake_value: v.stake_value,
      decision_stakes: formatStake(v.stake_kind, v.stake_value!),
      decision_deadline: v.decision_deadline,
      budget_eur: v.stake_kind === "amount" ? v.stake_value : null,
      description: v.description,
      target_audience: v.target_audience,
      audience_detail: v.audience_detail ?? null,
      region: v.region,
      region_detail: v.region_detail ?? null,
      project_type: v.project_type,
      sector_template: v.sector_template,
      key_uncertainty: v.key_uncertainty ?? null,
      sprint_start: v.sprint_start ?? null,
      sprint_weeks: v.sprint_weeks,
    })
    .select("id")
    .single();
  if (error || !idea) return { error: "Het idee kon niet worden opgeslagen. Probeer het opnieuw." };

  // Fase B2: de onderzoeksvragen komen uit de intake (specifieke doelgroep, aanbod, prijs, grootste onzekerheid).
  await seedDossier(idea.id, {
    title: v.title,
    description: v.description,
    decision_question: v.decision_question,
    target_audience: v.target_audience,
    audience_detail: v.audience_detail ?? null,
    region: v.region,
    region_detail: v.region_detail ?? null,
    project_type: v.project_type,
    sector_template: v.sector_template,
    key_uncertainty: v.key_uncertainty ?? null,
    outcome_min_value_per_customer: v.outcome_min_value_per_customer ?? null,
  });
  revalidatePath("/app", "layout");
  redirect(`/app/ideas/${idea.id}/research`);
}

// A new dossier starts with a research map derived from the intake (with one decisive question), three visible
// sizing scenarios built from editable assumptions, and "doing nothing" as the always-present alternative.
async function seedDossier(ideaId: string, intake: IntakeFacts) {
  const audience = intake.target_audience;
  const supabase = await supabaseServer();
  await insertDerivedQuestions(supabase, ideaId, intake);
  const model: SizingModel = /consument|particulier|b2c|huishoud/i.test(audience) ? "b2c_people" : "b2b_accounts";
  for (const kind of ["conservative", "realistic", "optimistic"] as ScenarioKind[]) {
    const { data: scenario } = await supabase.from("sizing_scenarios").insert({ idea_id: ideaId, kind, model }).select("id").single();
    if (!scenario) continue;
    const defaults = defaultFactors(model, kind);
    await supabase.from("sizing_factors").insert(
      MODEL_FACTORS[model].map((f, i) => ({
        scenario_id: scenario.id,
        idea_id: ideaId,
        key: f.key,
        label: f.label,
        unit: f.unit,
        value: defaults[f.key] ?? 0,
        position: i + 1,
      })),
    );
  }
  await supabase.from("unit_economics").insert({ idea_id: ideaId });
  await supabase.from("competitors").insert({
    idea_id: ideaId,
    name: "Niets doen / huidige werkwijze",
    kind: "status_quo",
    positioning: "De doelgroep houdt vast aan hoe het nu gaat: eigen netwerk, spreadsheets of uitstellen.",
    origin: "manual",
  });
}
