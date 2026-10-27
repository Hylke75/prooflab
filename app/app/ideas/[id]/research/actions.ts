"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWritableIdea } from "@/lib/data";
import { contentHash, recomputeClaim } from "@/lib/claims";
import { fetchPageText } from "@/lib/fetch-page";
import { checkQuote, normalizeText, registrableDomain } from "@/lib/domain/verify";
import { aiConfigured, env } from "@/lib/env";
import { planResearch } from "@/lib/ai/research";
import { ideaContext } from "@/lib/idea-context";
import { logAiRun } from "@/lib/ai/log";

export type ActionState = { error: string | null; ok?: string | null };

const blank = (s: unknown) => {
  const v = typeof s === "string" ? s.trim() : "";
  return v === "" ? null : v;
};

function done(ideaId: string, msg: string): ActionState {
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  return { error: null, ok: msg };
}

// ---------------------------------------------------------------------------
// Research map
// ---------------------------------------------------------------------------

const QuestionSchema = z.object({
  question: z.string().trim().min(10).max(400),
  done_criterion: z.string().trim().min(5).max(400),
  method: z.enum(["desk", "customer", "both"]),
  status: z.enum(["open", "answered", "needs_customer_research"]),
});

export async function saveQuestion(ideaId: string, questionId: string | null, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const parsed = QuestionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Vul een vraag en een klaar-criterium in." };
  const supabase = await supabaseServer();
  if (questionId) {
    const { error } = await supabase.from("research_questions").update({ ...parsed.data, origin: "manual" }).eq("id", questionId).eq("idea_id", ideaId);
    if (error) return { error: "Opslaan mislukt." };
  } else {
    const { data: existing } = await supabase.from("research_questions").select("position").eq("idea_id", ideaId);
    const used = new Set((existing ?? []).map((q) => q.position));
    const position = [1, 2, 3, 4, 5].find((p) => !used.has(p));
    if (!position) return { error: "Een onderzoekskaart heeft maximaal vijf vragen. Verwijder eerst een vraag." };
    const { error } = await supabase.from("research_questions").insert({ ...parsed.data, idea_id: ideaId, position, origin: "manual" });
    if (error) return { error: "Opslaan mislukt." };
  }
  return done(ideaId, "Onderzoeksvraag opgeslagen.");
}

export async function deleteQuestion(ideaId: string, questionId: string) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  await supabase.from("research_questions").delete().eq("id", questionId).eq("idea_id", ideaId);
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
}

export async function aiPlan(ideaId: string, _: ActionState): Promise<ActionState> {
  const { idea } = await requireWritableIdea(ideaId);
  if (!aiConfigured()) return { error: "AI is niet verbonden; pas de vragen handmatig aan." };
  const supabase = await supabaseServer();
  try {
    const res = await planResearch(ideaContext(idea));
    await logAiRun({ ideaId, purpose: "plan", outcome: "ok", usage: res.usage });
    // Manually edited questions are kept; template and earlier AI questions are replaced.
    const { data: existing } = await supabase.from("research_questions").select("id, position, origin").eq("idea_id", ideaId);
    const manual = (existing ?? []).filter((q) => q.origin === "manual");
    await supabase.from("research_questions").delete().eq("idea_id", ideaId).neq("origin", "manual");
    const free = [1, 2, 3, 4, 5].filter((p) => !manual.some((m) => m.position === p));
    const rows = res.data.questions.slice(0, free.length).map((q, i) => ({ ...q, idea_id: ideaId, position: free[i], origin: "ai" }));
    if (rows.length) await supabase.from("research_questions").insert(rows);
    return done(ideaId, "De onderzoekskaart is opnieuw opgesteld. Controleer de vragen.");
  } catch (e) {
    await logAiRun({ ideaId, purpose: "plan", outcome: "error", detail: String(e) });
    return { error: "Het onderzoeksplan kon niet worden gemaakt. De huidige vragen blijven staan." };
  }
}

// ---------------------------------------------------------------------------
// Sources and excerpts
// ---------------------------------------------------------------------------

const SourceSchema = z.object({
  url: z.string().trim().url("Vul een geldige URL in.").max(2000).optional().or(z.literal("")),
  title: z.string().trim().min(2, "Geef de bron een titel.").max(300),
  publisher: z.string().trim().max(200).optional(),
  published_on: z.string().trim().optional(),
  source_type: z.enum(["official_statistic", "primary_document", "company_page", "research_report", "news", "review_site", "blog", "dataset_upload", "interview", "other"]),
  excerpt: z.string().trim().min(20, "Plak het relevante fragment (minimaal 20 tekens).").max(6000),
  location: z.string().trim().max(200).optional(),
});

export async function addSource(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const parsed = SourceSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  const url = blank(v.url);
  let accessNote: string | null = "Fragment handmatig ingevoerd; niet automatisch gecontroleerd.";
  if (url && form.get("check_live") === "on") {
    try {
      const page = await fetchPageText(url);
      const found = normalizeText(page.text).includes(normalizeText(v.excerpt).slice(0, 400));
      accessNote = found
        ? `Fragment teruggevonden op de live pagina (${new Date().toLocaleDateString("nl-NL")}).`
        : "Fragment NIET teruggevonden op de live pagina. Controleer het citaat of de paginaversie.";
    } catch (e) {
      accessNote = `Live controle niet mogelijk: ${e instanceof Error ? e.message : "onbekende fout"}.`;
    }
  }
  const supabase = await supabaseServer();
  const { data: source, error } = await supabase
    .from("sources")
    .insert({
      idea_id: ideaId,
      url,
      domain: registrableDomain(url),
      title: v.title,
      publisher: blank(v.publisher),
      published_on: blank(v.published_on),
      source_type: v.source_type,
      is_primary: form.get("is_primary") === "on",
      access_note: accessNote,
      origin: "manual",
      content_hash: contentHash(v.excerpt),
    })
    .select("id")
    .single();
  if (error || !source) return { error: "De bron kon niet worden opgeslagen." };
  await supabase.from("source_excerpts").insert({ source_id: source.id, idea_id: ideaId, text: v.excerpt, location: blank(v.location) });
  return done(ideaId, accessNote.startsWith("Fragment NIET") ? accessNote : "Bron opgeslagen. Voeg nu een bevinding met letterlijk citaat toe.");
}

export async function addExcerpt(ideaId: string, sourceId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const text = z.string().trim().min(20).max(6000).safeParse(form.get("excerpt"));
  if (!text.success) return { error: "Plak een fragment van minimaal 20 tekens." };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("source_excerpts").insert({ source_id: sourceId, idea_id: ideaId, text: text.data, location: blank(form.get("location")) });
  if (error) return { error: "Fragment niet opgeslagen." };
  return done(ideaId, "Fragment toegevoegd.");
}

export async function deleteSource(ideaId: string, sourceId: string) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { data: affected } = await supabase.from("claim_sources").select("claim_id").eq("source_id", sourceId);
  await supabase.from("sources").delete().eq("id", sourceId).eq("idea_id", ideaId);
  for (const a of affected ?? []) await recomputeClaim(a.claim_id);
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

const ClaimSchema = z.object({
  statement: z.string().trim().min(10, "Formuleer de bevinding in één zin.").max(600),
  excerpt_id: z.string().uuid("Kies het bronfragment waar het citaat uit komt."),
  quote: z.string().trim().min(8, "Neem een letterlijk citaat over (minimaal 8 tekens).").max(1500),
  stance: z.enum(["supports", "contradicts"]),
  evidence_type: z.enum(["official_statistic", "third_party_estimate", "primary_document", "qualitative_observation", "self_reported_intent", "observed_action", "verified_transaction", "verified_commitment", "internal_assumption"]),
  section: z.enum(["market", "customers", "competition", "pricing", "sizing", "regulation", "other"]),
  freshness_kind: z.enum(["statistic", "price", "regulation", "product", "general"]),
  question_id: z.string().optional(),
  region: z.string().trim().max(120).optional(),
  period: z.string().trim().max(60).optional(),
  numeric_value: z.string().trim().optional(),
  unit: z.string().trim().max(40).optional(),
  definition: z.string().trim().max(400).optional(),
  supports: z.string().trim().max(400).optional(),
  does_not_prove: z.string().trim().min(5, "Vul in wat deze bevinding nog níét bewijst.").max(400),
  limitations: z.string().trim().max(400).optional(),
});

export async function addClaim(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const parsed = ClaimSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await supabaseServer();
  const { data: excerpt } = await supabase.from("source_excerpts").select("id, text, source_id").eq("id", v.excerpt_id).eq("idea_id", ideaId).single();
  if (!excerpt) return { error: "Bronfragment niet gevonden." };
  const check = checkQuote(v.quote, excerpt.text, v.stance === "supports" ? v.statement : undefined);
  const numeric = blank(v.numeric_value);
  const { data: claim, error } = await supabase
    .from("claims")
    .insert({
      idea_id: ideaId,
      question_id: v.question_id && /^[0-9a-f-]{36}$/.test(v.question_id) ? v.question_id : null,
      section: v.section,
      statement: v.statement,
      evidence_type: v.evidence_type,
      region: blank(v.region),
      period: blank(v.period),
      numeric_value: numeric ? Number(numeric.replace(/\./g, "").replace(",", ".")) : null,
      unit: blank(v.unit),
      definition: blank(v.definition),
      supports: blank(v.supports),
      does_not_prove: v.does_not_prove,
      limitations: blank(v.limitations),
      freshness_kind: v.freshness_kind,
      origin: "manual",
    })
    .select("id")
    .single();
  if (error || !claim) return { error: "De bevinding kon niet worden opgeslagen." };
  await supabase.from("claim_sources").insert({
    claim_id: claim.id,
    idea_id: ideaId,
    source_id: excerpt.source_id,
    excerpt_id: excerpt.id,
    quote: v.quote,
    stance: v.stance,
    quote_check: check,
  });
  const result = await recomputeClaim(claim.id);
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  if (check !== "exact") {
    return {
      error:
        check === "numbers_mismatch"
          ? "Opgeslagen als 'Onvoldoende bewijs': de getallen uit je bewering staan niet in het citaat."
          : "Opgeslagen als 'Onvoldoende bewijs': het citaat staat niet letterlijk in het fragment.",
    };
  }
  return { error: null, ok: `Bevinding opgeslagen: ${result?.reason ?? ""}` };
}

export async function linkEvidence(ideaId: string, claimId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const v = z
    .object({ excerpt_id: z.string().uuid(), quote: z.string().trim().min(8).max(1500), stance: z.enum(["supports", "contradicts"]) })
    .safeParse(Object.fromEntries(form));
  if (!v.success) return { error: "Kies een fragment en neem een letterlijk citaat over." };
  const supabase = await supabaseServer();
  const { data: excerpt } = await supabase.from("source_excerpts").select("id, source_id").eq("id", v.data.excerpt_id).eq("idea_id", ideaId).single();
  if (!excerpt) return { error: "Bronfragment niet gevonden." };
  await supabase.from("claim_sources").insert({ claim_id: claimId, idea_id: ideaId, source_id: excerpt.source_id, excerpt_id: excerpt.id, quote: v.data.quote, stance: v.data.stance });
  const r = await recomputeClaim(claimId);
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  return { error: null, ok: `Status: ${r?.reason ?? "bijgewerkt"}` };
}

export async function deleteClaim(ideaId: string, claimId: string) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  await supabase.from("claims").delete().eq("id", claimId).eq("idea_id", ideaId);
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
}

// ---------------------------------------------------------------------------
// Competitors and segments
// ---------------------------------------------------------------------------

const CompetitorSchema = z.object({
  name: z.string().trim().min(2).max(160),
  website: z.string().trim().url().max(500).optional().or(z.literal("")),
  kind: z.enum(["direct", "indirect", "alternative", "status_quo"]),
  positioning: z.string().trim().max(400).optional(),
  target_buyer: z.string().trim().max(200).optional(),
  pricing_model: z.string().trim().max(200).optional(),
  visible_price: z.string().trim().max(200).optional(),
  price_checked_on: z.string().trim().optional(),
  strengths: z.string().trim().max(600).optional(),
  weaknesses: z.string().trim().max(600).optional(),
  differentiation_opportunity: z.string().trim().max(600).optional(),
  claim_id: z.string().optional(),
});

export async function saveCompetitor(ideaId: string, competitorId: string | null, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const parsed = CompetitorSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Vul minstens een naam en het type in." };
  const v = parsed.data;
  if (blank(v.visible_price) && !blank(v.price_checked_on)) return { error: "Een prijs vraagt een peildatum. Onbekende prijzen laat je leeg ('niet publiek')." };
  const row = {
    name: v.name,
    website: blank(v.website),
    kind: v.kind,
    positioning: blank(v.positioning),
    target_buyer: blank(v.target_buyer),
    pricing_model: blank(v.pricing_model),
    visible_price: blank(v.visible_price),
    price_checked_on: blank(v.price_checked_on),
    strengths: blank(v.strengths),
    weaknesses: blank(v.weaknesses),
    differentiation_opportunity: blank(v.differentiation_opportunity),
    claim_id: v.claim_id && /^[0-9a-f-]{36}$/.test(v.claim_id) ? v.claim_id : null,
    last_checked_at: new Date().toISOString(),
  };
  const supabase = await supabaseServer();
  const { error } = competitorId
    ? await supabase.from("competitors").update(row).eq("id", competitorId).eq("idea_id", ideaId)
    : await supabase.from("competitors").insert({ ...row, idea_id: ideaId, origin: "manual" });
  if (error) return { error: "Opslaan mislukt." };
  return done(ideaId, "Aanbieder opgeslagen.");
}

export async function deleteCompetitor(ideaId: string, competitorId: string) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  await supabase.from("competitors").delete().eq("id", competitorId).eq("idea_id", ideaId);
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
}

const SegmentSchema = z.object({
  role: z.enum(["user", "buyer", "supplier", "other"]),
  label: z.string().trim().min(2).max(160),
  job_to_be_done: z.string().trim().max(500).optional(),
  pain: z.string().trim().max(500).optional(),
  current_alternative: z.string().trim().max(500).optional(),
  open_question: z.string().trim().max(500).optional(),
});

export async function saveSegment(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const parsed = SegmentSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Vul minstens de rol en een naam voor het segment in." };
  const v = parsed.data;
  const supabase = await supabaseServer();
  const { error } = await supabase.from("segments").insert({
    idea_id: ideaId,
    role: v.role,
    label: v.label,
    job_to_be_done: blank(v.job_to_be_done),
    pain: blank(v.pain),
    current_alternative: blank(v.current_alternative),
    open_question: blank(v.open_question),
  });
  if (error) return { error: "Opslaan mislukt." };
  return done(ideaId, "Segment toegevoegd.");
}

export async function deleteSegment(ideaId: string, segmentId: string) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  await supabase.from("segments").delete().eq("id", segmentId).eq("idea_id", ideaId);
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
}

// ---------------------------------------------------------------------------
// Sizing and unit economics
// ---------------------------------------------------------------------------

export async function saveScenario(ideaId: string, scenarioId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { data: factors } = await supabase.from("sizing_factors").select("id, key, unit").eq("scenario_id", scenarioId).eq("idea_id", ideaId);
  for (const f of factors ?? []) {
    const raw = String(form.get(`value_${f.key}`) ?? "").replace(",", ".");
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return { error: "Alle waarden moeten positieve getallen zijn." };
    if (f.unit === "percent" && value > 100) return { error: "Percentages liggen tussen 0 en 100." };
    const claim = String(form.get(`claim_${f.key}`) ?? "");
    await supabase
      .from("sizing_factors")
      .update({ value, claim_id: /^[0-9a-f-]{36}$/.test(claim) ? claim : null, note: blank(form.get(`note_${f.key}`)) })
      .eq("id", f.id);
  }
  await supabase.from("sizing_scenarios").update({ updated_at: new Date().toISOString() }).eq("id", scenarioId);
  return done(ideaId, "Scenario opgeslagen.");
}

export async function saveUnitEconomics(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const num = (k: string) => {
    const v = blank(form.get(k));
    if (v === null) return null;
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  const row = {
    price_per_customer_year: num("price_per_customer_year"),
    gross_margin_pct: num("gross_margin_pct"),
    cac_eur: num("cac_eur"),
    annual_churn_pct: num("annual_churn_pct"),
    fixed_costs_year: num("fixed_costs_year"),
    upfront_investment: num("upfront_investment"),
    notes: blank(form.get("notes")),
    updated_at: new Date().toISOString(),
  };
  if (Object.values(row).some((v) => typeof v === "number" && Number.isNaN(v))) return { error: "Gebruik positieve getallen." };
  if ((row.gross_margin_pct ?? 0) > 100 || (row.annual_churn_pct ?? 0) > 100) return { error: "Percentages liggen tussen 0 en 100." };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("unit_economics").upsert({ idea_id: ideaId, ...row });
  if (error) return { error: "Opslaan mislukt." };
  return done(ideaId, "Financiële gegevens opgeslagen.");
}

// ---------------------------------------------------------------------------
// Research runs
// ---------------------------------------------------------------------------

export async function startResearchRun(ideaId: string, mode: "quick" | "deep"): Promise<{ runId?: string; error?: string }> {
  await requireWritableIdea(ideaId);
  if (!aiConfigured()) return { error: "Live webonderzoek is niet verbonden. Voeg bronnen handmatig toe." };
  const supabase = await supabaseServer();
  const { data: running } = await supabase.from("research_runs").select("id").eq("idea_id", ideaId).in("status", ["queued", "running"]).limit(1);
  if (running?.length) return { runId: running[0].id };
  const { data: questions } = await supabase.from("research_questions").select("id, question, position").eq("idea_id", ideaId).order("position");
  const qs = (questions ?? []).slice(0, mode === "quick" ? 3 : 5);
  if (qs.length === 0) return { error: "Maak eerst een onderzoekskaart." };
  const budget = mode === "quick" ? Math.min(1.5, env.researchBudgetUsd) : env.researchBudgetUsd;
  const { data: run, error } = await supabase.from("research_runs").insert({ idea_id: ideaId, mode, budget_usd: budget, status: "queued" }).select("id").single();
  if (error || !run) return { error: "De onderzoeksrun kon niet worden gestart." };
  const tasks: { run_id: string; idea_id: string; position: number; kind: string; question_id: string | null; label: string }[] = [];
  let pos = 1;
  for (const q of qs) {
    tasks.push({ run_id: run.id, idea_id: ideaId, position: pos++, kind: "search", question_id: q.id, label: `Bronnen zoeken: vraag ${q.position}` });
    tasks.push({ run_id: run.id, idea_id: ideaId, position: pos++, kind: "extract", question_id: q.id, label: `Citaten controleren: vraag ${q.position}` });
  }
  if (mode === "deep") tasks.push({ run_id: run.id, idea_id: ideaId, position: pos++, kind: "reality_check", question_id: null, label: "Tegenbewijs en zwakke plekken zoeken" });
  await supabase.from("research_tasks").insert(tasks);
  revalidatePath(`/app/ideas/${ideaId}/research`);
  return { runId: run.id };
}

export async function cancelResearchRun(ideaId: string, runId: string) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  await supabase.from("research_tasks").update({ status: "skipped" }).eq("run_id", runId).eq("status", "pending");
  await supabase.from("research_runs").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", runId).eq("idea_id", ideaId);
  revalidatePath(`/app/ideas/${ideaId}/research`);
}
