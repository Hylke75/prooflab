"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/data";
import { templatePlan } from "@/lib/domain/research-plan";
import { defaultFactors, MODEL_FACTORS, type ScenarioKind, type SizingModel } from "@/lib/domain/sizing";
import type { ProjectType, SectorTemplate } from "@/lib/domain/labels";

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
  decision_stakes: optionalText,
  decision_deadline: z
    .string()
    .trim()
    .transform((s) => (s === "" ? null : s))
    .nullable()
    .optional(),
  budget_eur: z
    .string()
    .trim()
    .transform((s) => (s === "" ? null : Number(s.replace(/[^\d.]/g, ""))))
    .refine((n) => n === null || (Number.isFinite(n) && n >= 0), "Budget moet een bedrag zijn.")
    .nullable()
    .optional(),
  title: z.string().trim().min(2, "Geef het idee een korte naam.").max(140),
  description: z.string().trim().min(15, "Beschrijf het idee in minimaal één zin.").max(2000),
  target_audience: z.string().trim().min(2, "Kies of beschrijf de doelgroep.").max(200),
  audience_detail: optionalText,
  region: z.string().trim().min(2, "Kies een regio.").max(120),
  region_detail: optionalText,
  project_type: z.enum(["new_business", "new_product", "expansion", "revenue_model", "internal_innovation"], { message: "Kies het type project." }),
  sector_template: z.enum(["generic", "smb", "events", "media_culture"]),
  key_uncertainty: optionalText,
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
      decision_stakes: v.decision_stakes ?? null,
      decision_deadline: v.decision_deadline ?? null,
      budget_eur: v.budget_eur ?? null,
      description: v.description,
      target_audience: v.target_audience,
      audience_detail: v.audience_detail ?? null,
      region: v.region,
      region_detail: v.region_detail ?? null,
      project_type: v.project_type,
      sector_template: v.sector_template,
      key_uncertainty: v.key_uncertainty ?? null,
    })
    .select("id")
    .single();
  if (error || !idea) return { error: "Het idee kon niet worden opgeslagen. Probeer het opnieuw." };

  await seedDossier(idea.id, v.project_type, v.sector_template, v.target_audience);
  revalidatePath("/app", "layout");
  redirect(`/app/ideas/${idea.id}/research`);
}

// A new dossier starts with a template research map, three visible sizing scenarios built
// from editable assumptions, and "doing nothing" as the always-present alternative.
async function seedDossier(ideaId: string, projectType: ProjectType, sector: SectorTemplate, audience: string) {
  const supabase = await supabaseServer();
  await supabase.from("research_questions").insert(
    templatePlan(projectType, sector).map((q, i) => ({ ...q, idea_id: ideaId, position: i + 1, origin: "template" })),
  );
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
