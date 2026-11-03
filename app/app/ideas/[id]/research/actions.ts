"use server";

import { revalidatePath } from "next/cache";
import { questionDraftText } from "@/lib/domain/ai-draft";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWritableIdea } from "@/lib/data";
import { contentHash, recomputeClaim } from "@/lib/claims";
import { fetchPageText } from "@/lib/fetch-page";
import { checkQuote, normalizeText, numericFromInput, registrableDomain, valueInQuote } from "@/lib/domain/verify";
import { aiConfigured, env } from "@/lib/env";
import { analyzeSignals, planResearch } from "@/lib/ai/research";
import { aiSupportCheck, collectCbsFigures } from "@/lib/research-runner";
import { isSupportCheck } from "@/lib/domain/support";
import { priceOnPage, recheckChanges, recheckQuotes, type CompetitorRecheck, type PageRecheck } from "@/lib/domain/recheck";
import { isSignalSource, painAsAssumption, verifySignalGroups, type SignalExcerpt, type SignalQuote } from "@/lib/domain/customer-signals";
import { ideaContext } from "@/lib/idea-context";
import { aiErrorMessage, runAi } from "@/lib/ai/guard";
import { EXPECTED_SOURCE_KEYS } from "@/lib/domain/research-plan";
import { ensureDecisiveQuestion, loadRunQuestions, markDecisive } from "@/lib/research-questions-data";
import { decisiveFirst } from "@/lib/research-questions";
import { planSteps, runBudgetUsd } from "@/lib/research-steps";
import { kickResearchRun } from "@/lib/research-worker";
import { isProvider, PROVIDER_LABELS, type ProviderId } from "@/lib/ai/providers/config";
import { isUnknown, normalizeReferenceDate, scopeValue, UNKNOWN } from "@/lib/domain/claim-scope";

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
  unit: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((s) => (s ? s : null)),
  expected_source: z
    .union([z.enum(EXPECTED_SOURCE_KEYS), z.literal("")])
    .optional()
    .transform((s) => (s ? s : null)),
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

// While a research run is busy its steps point at the questions; changing the card would silently drop them.
async function runIsActive(supabase: Awaited<ReturnType<typeof supabaseServer>>, ideaId: string): Promise<boolean> {
  const { data } = await supabase.from("research_runs").select("id").eq("idea_id", ideaId).in("status", ["queued", "running"]).limit(1);
  return (data?.length ?? 0) > 0;
}

export async function deleteQuestion(ideaId: string, questionId: string) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  if (await runIsActive(supabase, ideaId)) return;
  await supabase.from("research_questions").delete().eq("id", questionId).eq("idea_id", ideaId);
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
}

// Fase B2, punt 1: de consultant wijst zelf de beslissende vraag aan (hooguit één per idee).
export async function setDecisiveQuestion(ideaId: string, questionId: string) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  if (await runIsActive(supabase, ideaId)) return;
  await markDecisive(supabase, ideaId, questionId);
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
}

// Fase B2, punt 1: sjabloonvragen met de brede doelgroep opnieuw afleiden uit de intake (zelfde rijen, dus
// bevindingen blijven aan hun vraag hangen) en de beslissende vraag bepalen.
export async function refreshQuestionsFromIntake(ideaId: string, _: ActionState): Promise<ActionState> {
  const { idea } = await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  if (await runIsActive(supabase, ideaId)) return { error: "Er loopt nog een onderzoeksrun. Wacht tot die klaar is (of stop hem)." };
  const id = await ensureDecisiveQuestion(ideaId, idea, { refreshTemplates: true });
  if (!id) return { error: "Er zijn nog geen onderzoeksvragen." };
  return done(ideaId, "De vragen volgen nu de intake; de beslissende vraag is gemarkeerd.");
}

export async function aiPlan(ideaId: string, _: ActionState): Promise<ActionState> {
  const { idea } = await requireWritableIdea(ideaId);
  if (!aiConfigured()) return { error: "AI is niet verbonden; pas de vragen handmatig aan." };
  const supabase = await supabaseServer();
  if (await runIsActive(supabase, ideaId)) return { error: "Er loopt nog een onderzoeksrun. Wacht tot die klaar is (of stop hem) voordat je de onderzoekskaart opnieuw laat opstellen." };
  try {
    const res = await runAi(ideaId, "plan", (p) => planResearch(ideaContext(idea), p));
    // Manually edited questions are kept; template and earlier AI questions are replaced.
    const { data: existing } = await supabase.from("research_questions").select("id, position, origin").eq("idea_id", ideaId);
    const manual = (existing ?? []).filter((q) => q.origin === "manual");
    await supabase.from("research_questions").delete().eq("idea_id", ideaId).neq("origin", "manual");
    const free = [1, 2, 3, 4, 5].filter((p) => !manual.some((m) => m.position === p));
    // Het AI-origineel blijft bewaard (golf A, punt 17), zodat zichtbaar is wat de consultant aanpaste.
    const rows = res.data.questions
      .slice(0, free.length)
      .map((q, i) => ({ ...q, idea_id: ideaId, position: free[i], origin: "ai", ai_original: questionDraftText(q).slice(0, 4000) }));
    if (rows.length) await supabase.from("research_questions").insert(rows);
    // Fase B2: de vraag die de grootste onzekerheid raakt, wordt (weer) de beslissende vraag.
    await ensureDecisiveQuestion(ideaId, idea);
    return done(ideaId, "De onderzoekskaart is opnieuw opgesteld. Controleer de vragen en de beslissende vraag.");
  } catch (e) {
    return { error: aiErrorMessage(e, "Het onderzoeksplan kon niet worden gemaakt. De huidige vragen blijven staan.") };
  }
}

// CBS StatLine: officiële bedrijventellingen als bron, zonder AI. Er wordt geen bevinding aangemaakt: de
// consultant legt zelf een bevinding met citaat vast (of een onderzoeksrun leest de tabelregels uit).
export async function fetchCbsFigures(ideaId: string, _: ActionState): Promise<ActionState> {
  const { idea } = await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { data: sizeQuestion } = await supabase.from("research_questions").select("question").eq("idea_id", ideaId).eq("expected_source", "official_statistic").order("position").limit(1).maybeSingle();
  const res = await collectCbsFigures(idea, null, sizeQuestion?.question ?? null);
  if (res.excerptIds.length === 0) return { error: `${res.detail} Voeg de cijfers anders handmatig toe onder Bronnen.` };
  return done(ideaId, `${res.detail} Opgeslagen als bron (officiële statistiek) onder Bronnen; leg zelf de bevinding met citaat vast.`);
}

// ---------------------------------------------------------------------------
// Sources and excerpts
// ---------------------------------------------------------------------------

const SourceSchema = z.object({
  url: z.string().trim().url("Vul een geldige URL in.").max(2000).optional().or(z.literal("")),
  title: z.string().trim().min(2, "Geef de bron een titel.").max(300),
  publisher: z.string().trim().max(200).optional(),
  published_on: z.string().trim().optional(),
  source_type: z.enum(["official_statistic", "primary_document", "company_page", "research_report", "news", "review_site", "blog", "forum", "outreach", "dataset_upload", "interview", "other"]),
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
  // Golf C, punt 7: verplicht, of expliciet "onbekend".
  population: z.string().trim().min(1, "Vul de populatie in, of schrijf \"onbekend\".").max(200),
  region: z.string().trim().min(1, "Vul de regio in, of schrijf \"onbekend\".").max(120),
  reference_date: z
    .string()
    .trim()
    .min(1, "Vul de peildatum in, of schrijf \"onbekend\".")
    .max(40)
    .refine((v) => isUnknown(v) || normalizeReferenceDate(v) !== UNKNOWN, "Schrijf de peildatum als jaartal (2025), maand (2025-06) of datum, of \"onbekend\"."),
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
  const numericRaw = blank(v.numeric_value);
  const numeric = numericFromInput(numericRaw);
  if (numericRaw && numeric == null) return { error: "Het getal is niet leesbaar. Schrijf één getal, bijvoorbeeld 41.230 of 1,5 miljoen." };
  // The stored figure feeds the market sizing, so it must be the figure in the quote.
  if (numeric != null && !valueInQuote(numeric, v.quote)) return { error: "Het getal staat niet in het citaat. Neem het getal over zoals de bron het noemt." };
  const { data: claim, error } = await supabase
    .from("claims")
    .insert({
      idea_id: ideaId,
      question_id: v.question_id && /^[0-9a-f-]{36}$/.test(v.question_id) ? v.question_id : null,
      section: v.section,
      statement: v.statement,
      evidence_type: v.evidence_type,
      population: scopeValue(v.population, 200),
      region: scopeValue(v.region),
      reference_date: normalizeReferenceDate(v.reference_date),
      period: blank(v.period),
      numeric_value: numeric,
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
  const { data: factors } = await supabase.from("sizing_factors").select("id, key, unit, label").eq("scenario_id", scenarioId).eq("idea_id", ideaId);
  const rows: { id: string; value: number; claim_id: string | null; note: string | null; low_value: number | null; high_value: number | null; year: number | null; region: string | null }[] = [];
  // Validate every factor first, so an error never leaves a half-saved scenario.
  for (const f of factors ?? []) {
    // Same reading as quotes: "41.230" is forty-one thousand, "2,5" is two and a half.
    const value = numericFromInput(String(form.get(`value_${f.key}`) ?? ""));
    if (value == null || value < 0) return { error: "Alle waarden moeten positieve getallen zijn." };
    if (f.unit === "percent" && value > 100) return { error: "Percentages liggen tussen 0 en 100." };
    // Optional 90% range for the Monte Carlo simulation: both bounds or neither.
    const rawLow = String(form.get(`low_${f.key}`) ?? "").trim();
    const rawHigh = String(form.get(`high_${f.key}`) ?? "").trim();
    let low: number | null = null;
    let high: number | null = null;
    if (rawLow || rawHigh) {
      low = numericFromInput(rawLow);
      high = numericFromInput(rawHigh);
      if (low == null || high == null) return { error: `${f.label}: vul beide grenzen van de bandbreedte in, of laat ze allebei leeg.` };
      if (low < 0 || high < 0) return { error: `${f.label}: de bandbreedte bestaat uit positieve getallen.` };
      if (f.unit === "percent" && high > 100) return { error: `${f.label}: percentages liggen tussen 0 en 100.` };
      if (low > high) return { error: `${f.label}: de ondergrens is hoger dan de bovengrens.` };
      if (value < low || value > high) return { error: `${f.label}: de waarde ligt buiten de eigen bandbreedte.` };
    }
    // Golf C, punt 8: jaar en regio van het getal (leeg of "onbekend" = onbekend).
    const rawYear = String(form.get(`year_${f.key}`) ?? "").trim();
    const year = rawYear === "" ? null : /^\d{4}$/.test(rawYear) && Number(rawYear) >= 1950 && Number(rawYear) <= 2100 ? Number(rawYear) : NaN;
    if (Number.isNaN(year)) return { error: `${f.label}: schrijf het jaar als vier cijfers, bijvoorbeeld 2025, of laat het leeg.` };
    const rawRegion = blank(form.get(`region_${f.key}`));
    const region = rawRegion == null || isUnknown(rawRegion) ? null : rawRegion.slice(0, 120);
    const claim = String(form.get(`claim_${f.key}`) ?? "");
    rows.push({ id: f.id, value, claim_id: /^[0-9a-f-]{36}$/.test(claim) ? claim : null, note: blank(form.get(`note_${f.key}`)), low_value: low, high_value: high, year, region });
  }
  for (const { id, ...row } of rows) {
    const { error } = await supabase.from("sizing_factors").update(row).eq("id", id).eq("idea_id", ideaId);
    if (error) return { error: "Opslaan mislukt. Probeer het opnieuw." };
  }
  await supabase.from("sizing_scenarios").update({ updated_at: new Date().toISOString() }).eq("id", scenarioId).eq("idea_id", ideaId);
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

// Fase B2, punten 2 en 3: de beslissende vraag gaat altijd eerst (zoeken, citaten, tegenbewijs); daarna de andere
// vragen zolang het budget het toelaat. Elke stap start pas als hij binnen het plafond past (lib/research-runner.ts).
export async function startResearchRun(ideaId: string, mode: "quick" | "deep"): Promise<{ runId?: string; error?: string }> {
  const { idea } = await requireWritableIdea(ideaId);
  if (!aiConfigured()) return { error: "Live webonderzoek is niet verbonden. Voeg bronnen handmatig toe." };
  const supabase = await supabaseServer();
  const { data: running } = await supabase.from("research_runs").select("id").eq("idea_id", ideaId).in("status", ["queued", "running"]).limit(1);
  if (running?.length) {
    // Een lopende run hervatten op de server (stond de keten stil, dan pakt hij hem weer op).
    await kickResearchRun(running[0].id, { refresh: true });
    return { runId: running[0].id };
  }
  await ensureDecisiveQuestion(ideaId, idea);
  const qs = decisiveFirst(await loadRunQuestions(supabase, ideaId));
  if (qs.length === 0) return { error: "Maak eerst een onderzoekskaart." };
  const budget = runBudgetUsd(mode, env.researchBudgetUsd);
  const { data: run, error } = await supabase.from("research_runs").insert({ idea_id: ideaId, mode, budget_usd: budget, status: "queued" }).select("id").single();
  if (error || !run) return { error: "De onderzoeksrun kon niet worden gestart." };
  const tasks = planSteps(qs, mode).map((t, i) => ({ run_id: run.id, idea_id: ideaId, position: i + 1, kind: t.kind, question_id: t.questionId, label: t.label }));
  await supabase.from("research_tasks").insert(tasks);
  // Fase B2, punt 4: de server werkt de stappen af, ook als het tabblad dicht gaat (lib/research-worker.ts).
  await kickResearchRun(run.id, { refresh: true });
  revalidatePath(`/app/ideas/${ideaId}/research`);
  return { runId: run.id };
}

// Fase B2, punt 5: een mislukte aanbieder of stap opnieuw proberen. Loopt er een run, dan komen de herhaalstappen
// achteraan in die run; anders in een nieuwe kleine run met het plafond van de snelle check. Een herhaalde zoekstap
// krijgt zijn uitleesstap mee (de zoekresultaten van eerder worden binnen 7 dagen hergebruikt, niet opnieuw betaald).
export async function retryResearchStep(ideaId: string, taskId: string, provider: string | null): Promise<{ error?: string; ok?: string }> {
  await requireWritableIdea(ideaId);
  if (!aiConfigured()) return { error: "Live webonderzoek is niet verbonden." };
  if (provider !== null && !isProvider(provider)) return { error: "Onbekende aanbieder." };
  const supabase = await supabaseServer();
  const { data: task } = await supabase.from("research_tasks").select("id, kind, question_id, label").eq("id", taskId).eq("idea_id", ideaId).maybeSingle();
  if (!task || !task.question_id || !["search", "extract", "counter"].includes(task.kind)) return { error: "Deze stap kan niet opnieuw." };
  const { data: q } = await supabase.from("research_questions").select("position").eq("id", task.question_id).eq("idea_id", ideaId).maybeSingle();
  if (!q) return { error: "De onderzoeksvraag bestaat niet meer." };
  const only = provider ? { only_providers: [provider] } : null;
  const who = provider ? `${PROVIDER_LABELS[provider as ProviderId].name} ` : "";
  const steps =
    task.kind === "counter"
      ? [{ kind: "counter", label: `Opnieuw: ${who}tegenbewijs zoeken (vraag ${q.position})`, output: only }]
      : [
          { kind: "search", label: `Opnieuw: ${who}bronnen zoeken (vraag ${q.position})`, output: only },
          { kind: "extract", label: `Opnieuw: citaten controleren (vraag ${q.position})`, output: null },
        ];
  const { data: active } = await supabase.from("research_runs").select("id").eq("idea_id", ideaId).in("status", ["queued", "running"]).limit(1).maybeSingle();
  let runId = active?.id ?? null;
  if (!runId) {
    const { data: run } = await supabase.from("research_runs").insert({ idea_id: ideaId, mode: "quick", budget_usd: runBudgetUsd("quick", env.researchBudgetUsd), status: "queued" }).select("id").single();
    runId = run?.id ?? null;
  }
  if (!runId) return { error: "De herhaling kon niet worden gestart." };
  const { data: last } = await supabase.from("research_tasks").select("position").eq("run_id", runId).order("position", { ascending: false }).limit(1).maybeSingle();
  const start = (last?.position ?? 0) + 1;
  const { error } = await supabase
    .from("research_tasks")
    .insert(steps.map((st, i) => ({ run_id: runId, idea_id: ideaId, position: start + i, kind: st.kind, question_id: task.question_id, label: st.label, output: st.output })));
  if (error) return { error: "De herhaling kon niet worden gestart." };
  await kickResearchRun(runId, { refresh: true });
  revalidatePath(`/app/ideas/${ideaId}/research`);
  return { ok: "Opnieuw ingepland; de server pakt het meteen op." };
}

export async function cancelResearchRun(ideaId: string, runId: string) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  await supabase.from("research_tasks").update({ status: "skipped" }).eq("run_id", runId).eq("status", "pending");
  await supabase.from("research_runs").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", runId).eq("idea_id", ideaId);
  revalidatePath(`/app/ideas/${ideaId}/research`);
}

// ---------------------------------------------------------------------------
// Support check: does the quote carry the claim? (research 7.1)
// ---------------------------------------------------------------------------

export async function checkClaimSupport(ideaId: string, claimSourceId: string, _: ActionState): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  if (!aiConfigured()) return { error: "AI is niet verbonden. Beoordeel zelf of het citaat de bewering draagt." };
  const supabase = await supabaseServer();
  const { data: link } = await supabase
    .from("claim_sources")
    .select("id, claim_id, quote, stance, support_checked_by, claims(statement)")
    .eq("id", claimSourceId)
    .eq("idea_id", ideaId)
    .single();
  if (!link?.claims) return { error: "Bronkoppeling niet gevonden." };
  if (link.support_checked_by === "consultant") return { error: "Een consultant heeft dit citaat al beoordeeld; dat oordeel blijft staan." };
  const res = await aiSupportCheck(ideaId, link.claims.statement, link.quote, link.stance as "supports" | "contradicts");
  if (res.verdict === "unchecked") return { error: "De AI-steuncontrole is niet gelukt. Beoordeel het citaat zelf." };
  await supabase
    .from("claim_sources")
    .update({ support_check: res.verdict, ai_support_check: res.verdict, support_checked_by: "ai", support_note: res.reason })
    .eq("id", claimSourceId)
    .eq("idea_id", ideaId);
  const r = await recomputeClaim(link.claim_id);
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  return { error: null, ok: `AI-voorstel: ${res.reason ?? res.verdict} Status: ${r?.reason ?? "bijgewerkt"}` };
}

export async function overrideSupport(ideaId: string, claimSourceId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const verdict = form.get("verdict");
  if (!isSupportCheck(verdict) || verdict === "unchecked") return { error: "Kies een oordeel." };
  const note = z.string().trim().max(500).safeParse(form.get("note") ?? "");
  if (!note.success) return { error: "De toelichting is te lang." };
  const supabase = await supabaseServer();
  const { data: link } = await supabase
    .from("claim_sources")
    .select("id, claim_id")
    .eq("id", claimSourceId)
    .eq("idea_id", ideaId)
    .single();
  if (!link) return { error: "Bronkoppeling niet gevonden." };
  // The AI's own verdict stays in ai_support_check, so agreement can be measured (7.9).
  const { error } = await supabase
    .from("claim_sources")
    .update({ support_check: verdict, support_checked_by: "consultant", support_note: note.data || null })
    .eq("id", claimSourceId)
    .eq("idea_id", ideaId);
  if (error) return { error: "Opslaan mislukt." };
  const r = await recomputeClaim(link.claim_id);
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  return { error: null, ok: `Oordeel vastgelegd. Status: ${r?.reason ?? "bijgewerkt"}` };
}

// ---------------------------------------------------------------------------
// Competitor recheck (research 7.2): re-fetch, re-run the literal check, never delete
// ---------------------------------------------------------------------------

type CompetitorRow = { id: string; name: string; website: string | null; visible_price: string | null; claim_id: string | null };

async function recheckCompetitorRow(ideaId: string, comp: CompetitorRow) {
  const supabase = await supabaseServer();
  const pages: PageRecheck[] = [];
  const affectedClaims = new Set<string>();
  if (comp.claim_id) {
    affectedClaims.add(comp.claim_id);
    const { data: links } = await supabase.from("claim_sources").select("source_id, sources(id, url)").eq("claim_id", comp.claim_id).eq("idea_id", ideaId);
    const seen = new Set<string>();
    for (const l of links ?? []) {
      const src = l.sources;
      if (!src?.url || seen.has(src.id)) continue;
      seen.add(src.id);
      // Every quote stored from this page is rechecked, also those of other findings.
      const { data: quotes } = await supabase.from("claim_sources").select("id, quote, claim_id").eq("source_id", src.id).eq("idea_id", ideaId);
      try {
        const page = await fetchPageText(src.url);
        const result = recheckQuotes((quotes ?? []).map((q) => ({ id: q.id, quote: q.quote })), page.text);
        pages.push({ url: src.url, reachable: true, quotes: result });
        const checkedAt = new Date().toISOString();
        for (const r of result) {
          await supabase.from("claim_sources").update({ live_found: r.found, live_checked_at: checkedAt }).eq("id", r.id).eq("idea_id", ideaId);
        }
        await supabase.from("sources").update({ live_checked_at: checkedAt, live_error: null }).eq("id", src.id).eq("idea_id", ideaId);
        for (const q of quotes ?? []) affectedClaims.add(q.claim_id);
      } catch (e) {
        const message = e instanceof Error ? e.message.slice(0, 120) : "onbekende fout";
        pages.push({ url: src.url, reachable: false, error: message });
        await supabase.from("sources").update({ live_checked_at: new Date().toISOString(), live_error: message }).eq("id", src.id).eq("idea_id", ideaId);
      }
    }
  }
  let website: CompetitorRecheck["website"] = null;
  if (comp.website) {
    try {
      const page = await fetchPageText(comp.website);
      website = { reachable: true, priceFound: priceOnPage(comp.visible_price, page.text) };
    } catch {
      website = { reachable: false, priceFound: null };
    }
  }
  for (const c of affectedClaims) await recomputeClaim(c);
  await supabase.from("competitors").update({ last_checked_at: new Date().toISOString() }).eq("id", comp.id).eq("idea_id", ideaId);
  return { name: comp.name, checked: pages.length + (website ? 1 : 0), changes: recheckChanges({ name: comp.name, pages, website }) };
}

export async function recheckCompetitors(ideaId: string, competitorId: string | null, _: ActionState): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  let query = supabase.from("competitors").select("id, name, website, visible_price, claim_id").eq("idea_id", ideaId);
  if (competitorId) query = query.eq("id", competitorId);
  const { data: comps } = await query.order("last_checked_at", { ascending: true, nullsFirst: true }).limit(25);
  if (!comps?.length) return { error: "Geen aanbieders om te controleren." };
  const results = [];
  for (const c of comps) results.push(await recheckCompetitorRow(ideaId, c));
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  const checked = results.reduce((n, r) => n + r.checked, 0);
  if (checked === 0) return { error: "Er is niets om op te halen: koppel een bevinding met bron-URL of vul de website in." };
  const changed = results.filter((r) => r.changes.length);
  if (!changed.length) return { error: null, ok: `${checked} pagina('s) opnieuw opgehaald. Alle citaten en prijzen teruggevonden.` };
  return {
    error: null,
    ok: `${checked} pagina('s) opnieuw opgehaald. Wat veranderde: ${changed.map((r) => `${r.name}: ${r.changes.join(" ")}`).join(" · ")} Niets is verwijderd; de betrokken bevindingen zijn herberekend.`,
  };
}

// ---------------------------------------------------------------------------
// Customer signals (research 7.3): qualitative signals, never behaviour
// ---------------------------------------------------------------------------

export async function analyzeCustomerSignals(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { idea } = await requireWritableIdea(ideaId);
  if (!aiConfigured()) return { error: "AI is niet verbonden. Leg klantsignalen handmatig vast." };
  const chosen = new Set(form.getAll("source_id").map(String));
  if (chosen.size === 0) return { error: "Kies minstens één bron met klantsignalen." };
  const supabase = await supabaseServer();
  const { data: sources } = await supabase.from("sources").select("id, title, source_type, origin, created_at, source_excerpts(id, text, created_at)").eq("idea_id", ideaId);
  const usable = (sources ?? []).filter((s) => isSignalSource(s) && chosen.has(s.id));
  // Deterministic order (oldest source and fragment first), analysed in batches so a large import is not
  // reduced to an arbitrary sample.
  const all = usable
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .flatMap((s) =>
      (s.source_excerpts ?? [])
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
        .map((e) => ({ id: e.id, source_id: s.id, source_title: s.title, text: e.text })),
    );
  if (all.length === 0) return { error: "Voeg eerst reviews, forumberichten of outreach-antwoorden toe als bron." };
  const BATCH = 60;
  const MAX_BATCHES = 5;
  const analysed = all.slice(0, BATCH * MAX_BATCHES);
  const merged = new Map<string, { kind: "job" | "pain" | "gain" | "objection"; label: string; mentions: number; quotes: SignalQuote[] }>();
  let droppedQuotes = 0;
  let droppedGroups = 0;
  try {
    for (let start = 0; start < analysed.length; start += BATCH) {
      const excerpts: SignalExcerpt[] = analysed.slice(start, start + BATCH).map((e, i) => ({ ...e, ref: `K${i + 1}` }));
      const res = await runAi(ideaId, "customer_signals", (p) =>
        analyzeSignals(ideaContext(idea), excerpts.map((e) => ({ ref: e.ref, title: e.source_title, text: e.text })), p),
      );
      const v = verifySignalGroups(res.data.groups, excerpts);
      droppedQuotes += v.droppedQuotes;
      droppedGroups += v.droppedGroups;
      // The same need found in several batches becomes one group with the summed number of verified quotes.
      for (const g of v.kept) {
        const key = `${g.kind}|${normalizeText(g.label)}`;
        const prev = merged.get(key);
        if (prev) {
          prev.mentions += g.mentions;
          prev.quotes = [...prev.quotes, ...g.quotes].slice(0, 20);
        } else merged.set(key, { kind: g.kind, label: g.label, mentions: g.mentions, quotes: g.quotes.slice(0, 20) });
      }
    }
  } catch (e) {
    if (merged.size === 0) return { error: aiErrorMessage(e, "De analyse is mislukt. Leg klantsignalen handmatig vast.") };
  }
  const kept = [...merged.values()];
  if (kept.length) {
    const { error } = await supabase
      .from("customer_signals")
      .insert(kept.map((g) => ({ idea_id: ideaId, kind: g.kind, label: g.label, mentions: g.mentions, quotes: g.quotes, origin: "ai" })));
    if (error) return { error: "De klantsignalen konden niet worden opgeslagen." };
  }
  const coverage = analysed.length < all.length ? ` Geanalyseerd: de eerste ${analysed.length} van ${all.length} fragmenten; start de analyse opnieuw met minder bronnen voor de rest.` : ` Alle ${all.length} fragmenten zijn geanalyseerd.`;
  return done(
    ideaId,
    `${kept.length} groepen met letterlijke citaten vastgelegd${droppedQuotes ? `; ${droppedQuotes} citaten weggelaten (niet letterlijk teruggevonden)` : ""}${droppedGroups ? `; ${droppedGroups} groepen zonder geldig citaat weggelaten` : ""}.${coverage} Controleer ze en verwijder wat niet klopt.`,
  );
}

const SignalSchema = z.object({
  kind: z.enum(["job", "pain", "gain", "objection"]),
  label: z.string().trim().min(3, "Omschrijf het signaal in een paar woorden.").max(300),
  excerpt_id: z.string().uuid("Kies het fragment waar het citaat uit komt."),
  quote: z.string().trim().min(8, "Neem een letterlijk citaat over (minimaal 8 tekens).").max(1000),
});

export async function addCustomerSignal(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const p = SignalSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await supabaseServer();
  const { data: ex } = await supabase.from("source_excerpts").select("id, text, source_id, sources(title)").eq("id", p.data.excerpt_id).eq("idea_id", ideaId).single();
  if (!ex) return { error: "Fragment niet gevonden." };
  if (checkQuote(p.data.quote, ex.text) !== "exact") return { error: "Dit citaat staat niet letterlijk in het fragment." };
  const { error } = await supabase.from("customer_signals").insert({
    idea_id: ideaId,
    kind: p.data.kind,
    label: p.data.label,
    mentions: 1,
    quotes: [{ text: p.data.quote, excerpt_id: ex.id, source_id: ex.source_id, source_title: ex.sources?.title ?? "" }],
    origin: "manual",
  });
  if (error) return { error: "Opslaan mislukt." };
  return done(ideaId, "Klantsignaal vastgelegd.");
}

export async function deleteCustomerSignal(ideaId: string, signalId: string) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  await supabase.from("customer_signals").delete().eq("id", signalId).eq("idea_id", ideaId);
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
}

// A frequently mentioned pain becomes a candidate assumption (origin "ai" when the grouping came from AI).
export async function assumptionFromSignal(ideaId: string, signalId: string, _: ActionState): Promise<ActionState> {
  const { idea } = await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { data: sig } = await supabase.from("customer_signals").select("label, origin").eq("id", signalId).eq("idea_id", ideaId).single();
  if (!sig) return { error: "Signaal niet gevonden." };
  const statement = painAsAssumption(sig.label, idea.target_audience);
  const { data: existing } = await supabase.from("assumptions").select("id").eq("idea_id", ideaId).eq("statement", statement).limit(1);
  if (existing?.length) return { error: "Deze aanname bestaat al." };
  const { error } = await supabase
    .from("assumptions")
    .insert({ idea_id: ideaId, statement, category: "desirability", importance: 4, origin: sig.origin === "ai" ? "ai" : "manual" });
  if (error) return { error: "De aanname kon niet worden gemaakt." };
  return done(ideaId, "Aanname gemaakt. Scherp hem aan op de pagina Aannames en toets hem met klantinterviews.");
}
