"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/data";
import { insertDerivedQuestions, missingColumn } from "@/lib/research-questions-data";
import { AUDIENCE_SHORT_MAX, priceFromIntake, shortAudience, shortAudienceOf, type IntakeFacts } from "@/lib/research-questions";
import { defaultFactors, MODEL_FACTORS, type ScenarioKind, type SizingModel } from "@/lib/domain/sizing";
import { OutcomeDefinitionSchema, optionalAmount, outcomeValueProblem } from "@/lib/forecast-schemas";
import { measureWindowProblem } from "@/lib/domain/forecast";
import { STAKE_KINDS, formatStake } from "@/lib/domain/decision-quality";
import { todayInNL } from "@/lib/domain/sprint";
import type { FormState } from "@/components/ui/ActionForm";
import { fieldErrorsFrom, savedNothing } from "@/lib/domain/form-errors";
import { aiConfigured } from "@/lib/env";
import { aiErrorMessage, runOrgAi } from "@/lib/ai/guard";
import { extractIntakeProposal } from "@/lib/ai/intake";
import {
  AUDIENCE_CATEGORIES,
  PROJECT_TYPE_KEYS,
  REGION_OPTIONS,
  SECTOR_KEYS,
  annualPriceFromOffer,
  changedFields,
  composeStatement,
  currentPracticeFromText,
  statusQuoPositioning,
  mergeProposals,
  ruleProposal,
  sanitizeAiProposal,
  type IntakeAnswers,
  type IntakeProposal,
  type ProposalResult,
} from "@/lib/intake-proposal";

// Fase B3: de intake in drie vragen (idee en voor wie; beslissing met inzet en datum; grootste onzekerheid), daarna
// één samenvattingskaart met een voorstel voor alle velden. proposeIntake maakt het voorstel (AI, of regels als
// terugval); createIdea legt het vast na "Klopt, start de marktverkenning".

const AnswersSchema = z.object({
  idea: z.string().trim().min(15, "Beschrijf het idee en voor wie het is in minimaal één zin.").max(2000, "Houd het idee kort: hooguit 2000 tekens."),
  decision: z.string().trim().min(10, "Beschrijf de beslissing in minimaal één korte zin.").max(400, "Houd de beslissing kort: hooguit 400 tekens."),
  uncertainty: z.string().trim().min(10, "Beschrijf je grootste onzekerheid in minimaal één zin.").max(2000, "Houd de onzekerheid kort: hooguit 2000 tekens."),
});

export type ProposeResult = { ok: true; result: ProposalResult } | { ok: false; error: string; field: keyof IntakeAnswers };

// Het voorstel uit de drie antwoorden. Zonder AI-sleutel, zonder budget of bij een fout: het voorstel uit de regels
// (bedragen, datums, prijs en doelgroep uit de tekst), met de reden. Er wordt niets opgeslagen.
export async function proposeIntake(input: IntakeAnswers): Promise<ProposeResult> {
  const ws = await getWorkspace();
  if (!ws.org) return { ok: false, error: "Maak eerst een werkruimte aan.", field: "idea" };
  const parsed = AnswersSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0]) as keyof IntakeAnswers };
  }
  const answers = parsed.data;
  const today = todayInNL();
  const rules = ruleProposal(answers, today);
  const fallback = "Dit voorstel komt uit je eigen tekst; vul aan wat ontbreekt.";
  if (!aiConfigured()) return { ok: true, result: { ...rules, note: `AI is niet verbonden. ${fallback}` } };
  try {
    const res = await runOrgAi(ws.org.id, "coach_intake", (p) => extractIntakeProposal(answers, today, p));
    return { ok: true, result: mergeProposals(rules, sanitizeAiProposal(res.data, today)) };
  } catch (e) {
    return { ok: true, result: { ...rules, note: `${aiErrorMessage(e, "Het AI-voorstel lukte niet.")} ${fallback}` } };
  }
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === "" ? null : s))
    .nullable()
    .optional();

const IntakeSchema = z.object({
  // De drie antwoorden, ongewijzigd opgeslagen als beschrijving, beslisvraag en grootste onzekerheid.
  description: AnswersSchema.shape.idea,
  decision_question: AnswersSchema.shape.decision,
  key_uncertainty: AnswersSchema.shape.uncertainty,
  title: z.string().trim().min(2, "Geef het idee een korte naam.").max(140),
  // Inzet en beslisdatum zijn verplicht voor nieuwe intakes (bestaande ideeën blijven geldig zonder).
  stake_kind: z.enum(STAKE_KINDS, { message: "Kies wat er op het spel staat: bedrag, tijd of capaciteit." }),
  stake_value: optionalAmount("De inzet moet een getal van 0 of hoger zijn.").refine((n) => n !== null && n > 0, "Vul in hoeveel er op het spel staat (een getal groter dan 0)."),
  decision_deadline: z
    .string()
    .trim()
    .refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s), "Kies de uiterlijke beslisdatum.")
    .refine((s) => s >= todayInNL(), "De beslisdatum ligt in het verleden. Kies vandaag of later."),
  ...OutcomeDefinitionSchema.shape,
  // Leeg: de zin wordt gemaakt uit maatstaf, doelwaarde en prijs (composeStatement).
  outcome_statement: z.string().trim().max(400, "Houd de uitkomst kort: hooguit 400 tekens.").optional(),
  target_audience: z.enum(AUDIENCE_CATEGORIES, { message: "Kies het soort klant." }),
  audience_detail: z.string().trim().min(2, "Beschrijf de doelgroep, bijvoorbeeld 'zelfstandige NVM-kantoren met 2–15 medewerkers'.").max(200),
  // Gebruikerstest D8: de korte doelgroep voor in vragen en kopjes (leeg: afgeleid uit de toelichting).
  audience_short: optionalText(AUDIENCE_SHORT_MAX),
  region: z.enum(REGION_OPTIONS, { message: "Kies een regio." }),
  region_detail: optionalText(120),
  project_type: z.enum(PROJECT_TYPE_KEYS, { message: "Kies het type project." }),
  sector_template: z.enum(SECTOR_KEYS, { message: "Kies een branche." }),
  offer_price: optionalText(120),
  sprint_start: z
    .string()
    .trim()
    .transform((s) => (s === "" ? null : s))
    .refine((s) => s === null || /^\d{4}-\d{2}-\d{2}$/.test(s), "Kies een geldige startdatum voor de sprint.")
    .nullable()
    .optional(),
  sprint_weeks: z.coerce.number().int().min(2, "Een sprint duurt minimaal 2 weken.").max(12, "Een sprint duurt maximaal 12 weken.").default(5),
  // Opdrachtgever: standaard geen (eigen idee); een nieuwe alleen na de expliciete keuze "+ Nieuwe opdrachtgever".
  client_id: z.string().trim().default("none"),
  new_client_name: z.string().trim().max(160).optional(),
  // Het voorstel zoals het op de kaart kwam (bron, herkomst en waarden), voor intake_proposal.
  proposal_json: z.string().max(16000).optional(),
});

const FIELD_MESSAGES: Partial<Record<string, string>> = {
  outcome_target: "Geef de doelwaarde als getal.",
};

type StoredProposal = { source: "ai" | "rules" | null; note: string | null; proposal: IntakeProposal | null; origin: Record<string, string> };

// Het voorstel komt van de kaart terug; alleen geldige waarden worden bewaard (zelfde controle als een AI-voorstel).
function parseProposal(raw: string | undefined): StoredProposal {
  const none: StoredProposal = { source: null, note: null, proposal: null, origin: {} };
  try {
    const j = JSON.parse(raw ?? "null") as Partial<ProposalResult> | null;
    if (!j || typeof j !== "object" || !j.proposal || typeof j.proposal !== "object") return none;
    const origin = Object.fromEntries(
      Object.entries(j.origin ?? {}).filter(([, o]) => o === "ai" || o === "text" || o === "default"),
    ) as Record<string, string>;
    return {
      source: j.source === "ai" || j.source === "rules" ? j.source : null,
      note: typeof j.note === "string" ? j.note.slice(0, 400) : null,
      // Datums in het verleden horen ook bij het voorstel zoals het was: daarom geen ondergrens voor de datum.
      proposal: sanitizeAiProposal(j.proposal, "0000-00-00"),
      origin,
    };
  } catch {
    return none;
  }
}

export async function createIdea(_: FormState, form: FormData): Promise<FormState> {
  const ws = await getWorkspace();
  if (!ws.org) return { error: "Maak eerst een werkruimte aan." };
  const parsed = IntakeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const fieldErrors = fieldErrorsFrom(parsed.error.issues, FIELD_MESSAGES);
    return { error: savedNothing("Het dossier", fieldErrors), fieldErrors };
  }
  const v = parsed.data;
  const fieldErrors: Record<string, string> = {};
  const outcome_statement =
    v.outcome_statement && v.outcome_statement.length >= 10
      ? v.outcome_statement
      : composeStatement({
          outcome_metric: v.outcome_metric,
          outcome_target: v.outcome_target,
          outcome_min_value_per_customer: v.outcome_min_value_per_customer ?? null,
          offer_price: v.offer_price ?? null,
        });
  if (!outcome_statement) fieldErrors.outcome_statement = "Beschrijf in één zin wanneer dit idee geslaagd is.";
  const valueProblem = outcomeValueProblem(v);
  if (valueProblem) fieldErrors.outcome_min_value_per_customer = valueProblem;
  const windowProblem = v.outcome_measure_date ? measureWindowProblem(v.outcome_measure_date, v.decision_deadline) : null;
  if (windowProblem) fieldErrors.outcome_measure_date = windowProblem;
  const newClient = v.client_id === "new";
  if (newClient && !v.new_client_name) fieldErrors.new_client_name = "Vul de naam van de nieuwe opdrachtgever in, of kies 'Geen (eigen idee)'.";
  if (Object.keys(fieldErrors).length || !outcome_statement) return { error: savedNothing("Het dossier", fieldErrors), fieldErrors };
  const supabase = await supabaseServer();

  let clientId: string | null = /^[0-9a-f-]{36}$/i.test(v.client_id) ? v.client_id : null;
  if (newClient && v.new_client_name) {
    const { data: client, error } = await supabase
      .from("clients")
      .insert({ org_id: ws.org.id, name: v.new_client_name, sector: v.sector_template })
      .select("id")
      .single();
    if (error) return { error: "De opdrachtgever kon niet worden opgeslagen. Probeer het opnieuw." };
    clientId = client.id;
  }

  // Wat was voorstel en wat paste de consultant aan (herleidbaar, zoals ai_original bij onderzoeksvragen).
  const stored = parseProposal(v.proposal_json);
  const audienceShort = v.audience_short ?? shortAudience(v.audience_detail);
  const confirmed = {
    title: v.title,
    stake_kind: v.stake_kind,
    stake_value: v.stake_value,
    decision_deadline: v.decision_deadline,
    outcome_metric: v.outcome_metric,
    outcome_target: v.outcome_target,
    outcome_min_value_per_customer: v.outcome_min_value_per_customer ?? null,
    outcome_statement,
    target_audience: v.target_audience,
    audience_detail: v.audience_detail,
    audience_short: audienceShort,
    region: v.region,
    region_detail: v.region_detail ?? null,
    sector_template: v.sector_template,
    project_type: v.project_type,
    offer_price: v.offer_price ?? null,
    sprint_weeks: v.sprint_weeks,
  };
  const intakeProposal = {
    version: "b3",
    answers: { idea: v.description, decision: v.decision_question, uncertainty: v.key_uncertainty },
    source: stored.source,
    note: stored.note,
    proposal: stored.proposal,
    origin: stored.origin,
    changed: stored.proposal ? changedFields(stored.proposal, confirmed) : null,
    confirmed_at: new Date().toISOString(),
  };

  const row = {
    org_id: ws.org.id,
    client_id: clientId,
    title: v.title,
    decision_question: v.decision_question,
    outcome_statement,
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
    audience_detail: v.audience_detail,
    region: v.region,
    region_detail: v.region_detail ?? null,
    project_type: v.project_type,
    sector_template: v.sector_template,
    key_uncertainty: v.key_uncertainty,
    sprint_start: v.sprint_start ?? todayInNL(),
    sprint_weeks: v.sprint_weeks,
  };
  let res = await supabase
    .from("ideas")
    .insert({ ...row, offer_price: v.offer_price ?? null, intake_proposal: intakeProposal, audience_short: audienceShort })
    .select("id")
    .single();
  // Zonder de migratie van groep D: zonder de korte doelgroep (die wordt dan steeds afgeleid uit de toelichting).
  if (res.error && missingColumn(res.error)) {
    res = await supabase.from("ideas").insert({ ...row, offer_price: v.offer_price ?? null, intake_proposal: intakeProposal }).select("id").single();
  }
  if (res.error && missingColumn(res.error)) {
    // Zonder de B3-migratie: zonder de nieuwe kolommen. De prijs gaat dan mee in de beschrijving, zodat de
    // onderzoeksvragen hem toch vinden (priceFromIntake leest de onzekerheid en de beschrijving).
    const found = priceFromIntake({ key_uncertainty: v.key_uncertainty, description: v.description });
    const price = v.offer_price && !found ? `\n\nPrijs: ${v.offer_price}` : "";
    res = await supabase.from("ideas").insert({ ...row, description: `${v.description}${price}`.slice(0, 2100) }).select("id").single();
  }
  const idea = res.data;
  if (res.error || !idea) return { error: "Het idee kon niet worden opgeslagen. Probeer het opnieuw." };

  // Fase B2: de onderzoeksvragen komen uit de intake (specifieke doelgroep, aanbod, prijs, grootste onzekerheid).
  await seedDossier(idea.id, {
    title: v.title,
    description: v.description,
    decision_question: v.decision_question,
    target_audience: v.target_audience,
    audience_detail: v.audience_detail,
    audience_short: audienceShort,
    region: v.region,
    region_detail: v.region_detail ?? null,
    project_type: v.project_type,
    sector_template: v.sector_template,
    key_uncertainty: v.key_uncertainty,
    outcome_min_value_per_customer: v.outcome_min_value_per_customer ?? null,
    offer_price: v.offer_price ?? null,
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
  // Gebruikerstest D5: de prijs uit de intake als jaaromzet per klant, gemarkeerd als aanname (geen claim_id).
  const price = annualPriceFromOffer(intake.offer_price ?? priceFromIntake(intake));
  const priceKey = "revenue_per_customer";
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
        value: f.key === priceKey && price ? price.value : (defaults[f.key] ?? 0),
        note: f.key === priceKey && price ? price.note : null,
        position: i + 1,
      })),
    );
  }
  await supabase.from("unit_economics").insert({ idea_id: ideaId });
  await supabase.from("competitors").insert({
    idea_id: ideaId,
    name: "Niets doen / huidige werkwijze",
    kind: "status_quo",
    // Gebruikerstest D6: uit de intake, geen verzonnen werkwijze.
    positioning: statusQuoPositioning(shortAudienceOf(intake), currentPracticeFromText(intake.description, intake.key_uncertainty)),
    origin: "manual",
  });
}
