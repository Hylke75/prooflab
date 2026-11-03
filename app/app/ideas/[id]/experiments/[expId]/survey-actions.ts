"use server";

// Distribution of a published test: personal survey invitations by e-mail (Resend) or as a CSV of personal links,
// one reminder, and invitation posts for social media. Consultants only (requireWritableIdea + RLS).

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWritableIdea } from "@/lib/data";
import { aiConfigured, emailConfigured, env, trackingConfigured } from "@/lib/env";
import { SurveyConfigSchema, type SurveyConfig } from "@/lib/domain/survey";
import { MAX_INVITES, canRemind, checkTemplate, isEmail, linksCsv, normalizeEmail, sliceBatches, channelLink } from "@/lib/domain/survey-distribution";
import { emailHash, invitationToken, tokenHash } from "@/lib/domain/survey-tokens";
import { personalLinks } from "@/lib/survey-links";
import { MAX_JOB_IDS, SurveyJobPayloadSchema } from "@/lib/jobs/survey-email";
import { kickWorker, workerConfigured } from "@/lib/jobs/worker";
import { jobNeedsWorker, latestSurveyJob, type StartJobResult, type SurveyJob } from "@/lib/survey-jobs";
import { PROMO_MIN, PROMO_PLATFORMS, PROMO_PLATFORM_KEYS, finalizePost, isPromoPlatform, templatePosts, type PromoInput, type PromoPlatform } from "@/lib/domain/promo";
import { aiErrorMessage, runAi } from "@/lib/ai/guard";
import { draftPromoPosts } from "@/lib/ai/promo";
import type { LandingConfig } from "@/lib/experiment-metrics";

const refresh = (ideaId: string, expId: string) => revalidatePath(`/app/ideas/${ideaId}/experiments/${expId}`);

type Exp = { id: string; idea_id: string; type: string; state: string; public_slug: string | null; config: unknown; target_group: string; org_id: string };

async function loadExp(ideaId: string, expId: string): Promise<Exp> {
  const { idea } = await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("experiments")
    .select("id, idea_id, type, state, public_slug, config, hypotheses(target_group)")
    .eq("id", expId)
    .eq("idea_id", ideaId)
    .maybeSingle();
  if (!data) throw new Error("Experiment niet gevonden.");
  return { ...data, target_group: data.hypotheses?.target_group ?? idea.target_audience, org_id: idea.org_id };
}

function surveyConfig(exp: Exp): SurveyConfig | null {
  const p = SurveyConfigSchema.safeParse(exp.config);
  return p.success ? p.data : null;
}

const fail = (error: string) => ({ error });

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

const RecipientSchema = z.object({ email: z.string().max(254), name: z.string().max(80).nullable() });
const TemplateSchema = z.object({ subject: z.string().max(300), body: z.string().max(5000) });

// Only a live survey is mailed: a link to a survey that is not open would waste the one invitation people get.
async function liveSurvey(ideaId: string, expId: string) {
  const exp = await loadExp(ideaId, expId);
  if (exp.type !== "survey" || !exp.public_slug) throw new Error("Uitnodigen kan alleen bij een enquête.");
  if (exp.state !== "live") throw new Error("Uitnodigen kan zodra de enquête live staat.");
  if (!trackingConfigured()) throw new Error("Persoonlijke links zijn niet geconfigureerd (INGEST_SECRET en TRACKING_SALT ontbreken).");
  const config = surveyConfig(exp);
  if (!config) throw new Error("De enquête is ongeldig.");
  return { exp, config, slug: exp.public_slug };
}

async function suppressedHashes(orgId: string, hashes: string[]): Promise<Set<string>> {
  const supabase = await supabaseServer();
  const out = new Set<string>();
  for (const chunk of sliceBatches(hashes, 200)) {
    const { data, error } = await supabase.from("email_suppressions").select("email_hash").eq("org_id", orgId).in("email_hash", chunk);
    if (error) throw new Error("De afmeldlijst kon niet worden gecontroleerd.");
    for (const r of data ?? []) out.add(r.email_hash);
  }
  return out;
}

export type CreateInvitationsResult = { error?: string; created?: string[]; suppressed?: number; existing?: number; invalid?: number };

// Step 1: one pending invitation per new address. Addresses on the organisation's unsubscribe list and people who
// were already invited for this survey are skipped. Names are not stored (only used in the e-mail greeting).
export async function createInvitations(ideaId: string, expId: string, input: { recipients: unknown; basis: boolean }): Promise<CreateInvitationsResult> {
  try {
    if (input.basis !== true) return fail("Bevestig dat je een grondslag hebt om deze mensen te mailen.");
    const parsed = z.array(RecipientSchema).max(MAX_INVITES).safeParse(input.recipients);
    if (!parsed.success) return fail(`Maximaal ${MAX_INVITES.toLocaleString("nl-NL")} adressen per keer.`);
    const { exp } = await liveSurvey(ideaId, expId);
    const unique = new Map<string, string>();
    let invalid = 0;
    for (const r of parsed.data) {
      if (!isEmail(r.email)) invalid++;
      else unique.set(normalizeEmail(r.email), "");
    }
    const emails = [...unique.keys()];
    if (emails.length === 0) return fail("Er staan geen geldige e-mailadressen in de lijst.");

    const salt = env.trackingSalt;
    const hashOf = new Map(emails.map((e) => [e, emailHash(salt, e)]));
    const suppressed = await suppressedHashes(exp.org_id, [...hashOf.values()]);
    const supabase = await supabaseServer();
    const existing = new Set<string>();
    for (const chunk of sliceBatches(emails, 200)) {
      const { data, error } = await supabase.from("survey_invitations").select("email").eq("experiment_id", expId).in("email", chunk);
      if (error) return fail("Bestaande uitnodigingen konden niet worden gecontroleerd.");
      for (const r of data ?? []) existing.add(r.email);
    }
    const fresh = emails.filter((e) => !existing.has(e) && !suppressed.has(hashOf.get(e)!));
    for (const chunk of sliceBatches(fresh, 500)) {
      const rows = chunk.map((email) => {
        const id = randomUUID();
        return { id, email, email_hash: hashOf.get(email)!, experiment_id: expId, idea_id: ideaId, token_hash: tokenHash(invitationToken(salt, id)) };
      });
      const { error } = await supabase.from("survey_invitations").insert(rows);
      if (error) return fail("De uitnodigingen konden niet worden opgeslagen. Probeer het opnieuw.");
    }
    refresh(ideaId, expId);
    return {
      created: fresh,
      suppressed: emails.filter((e) => suppressed.has(hashOf.get(e)!)).length,
      existing: emails.filter((e) => existing.has(e)).length,
      invalid,
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Er ging iets mis.");
  }
}

// Step 2: sending runs as a durable background job (lib/jobs): one job per send request, holding the invitation
// ids (and names for the greeting, dropped when the job ends). The worker claims each invitation before mailing
// it (pending/failed → sent), so a retry, a second worker or a double click never mails twice. Without a mail
// connection nothing is enqueued.

async function enqueueSurveyJob(
  ideaId: string,
  expId: string,
  kind: "survey_invite" | "survey_reminder",
  payload: { template: { subject: string; body: string }; ids: string[]; names?: Record<string, string> },
): Promise<StartJobResult> {
  if (payload.ids.length === 0) return fail(kind === "survey_invite" ? "Er staan geen uitnodigingen klaar om te versturen." : "Er is niemand aan wie nu een herinnering kan.");
  const body = { experiment_id: expId, ...payload, ids: payload.ids.slice(0, MAX_JOB_IDS) };
  if (!SurveyJobPayloadSchema.safeParse(body).success) return fail("Ongeldige invoer.");
  const supabase = await supabaseServer();
  // One e-mail job per survey at a time: invitations and reminders share the key.
  const { data, error } = await supabase.rpc("enqueue_job", { p_idea: ideaId, p_kind: kind, p_payload: body, p_dedupe: `survey-email:${expId}` });
  if (error || !data) return fail("De verzending kon niet worden ingepland. Probeer het opnieuw.");
  const res = data as { id: string; created: boolean };
  kickWorker();
  refresh(ideaId, expId);
  const job = await latestSurveyJob(expId);
  return { job: job ?? undefined, existing: !res.created };
}

async function sendPreflight(template: unknown): Promise<{ error: string } | { template: { subject: string; body: string } }> {
  if (!emailConfigured()) return fail("E-mail is niet gekoppeld. Download de persoonlijke links en mail ze vanuit je eigen programma.");
  if (!workerConfigured()) return fail("Versturen op de achtergrond is niet geconfigureerd (INGEST_SECRET en TRACKING_SALT ontbreken).");
  const t = TemplateSchema.safeParse(template);
  if (!t.success) return fail("Ongeldige invoer.");
  const problem = checkTemplate(t.data);
  if (problem) return fail(problem);
  return { template: t.data };
}

// Send the first mail to the given addresses (scope "new": the ones just added, with names for the greeting) or
// to everyone not mailed yet (scope "open": pending or failed earlier).
export async function startInvitationSend(
  ideaId: string,
  expId: string,
  input: { scope: "new" | "open"; recipients?: unknown; template: unknown; basis: boolean },
): Promise<StartJobResult> {
  try {
    if (input.basis !== true) return fail("Bevestig dat je een grondslag hebt om deze mensen te mailen.");
    const pre = await sendPreflight(input.template);
    if ("error" in pre) return pre;
    await liveSurvey(ideaId, expId);
    const supabase = await supabaseServer();
    const ids: string[] = [];
    const names: Record<string, string> = {};
    if (input.scope === "new") {
      const recipients = z.array(RecipientSchema).max(MAX_INVITES).safeParse(input.recipients);
      if (!recipients.success) return fail("Ongeldige invoer.");
      const byEmail = new Map(recipients.data.map((r) => [normalizeEmail(r.email), r.name]));
      for (const chunk of sliceBatches([...byEmail.keys()], 200)) {
        const { data, error } = await supabase.from("survey_invitations").select("id, email").eq("experiment_id", expId).in("status", ["pending", "failed"]).in("email", chunk);
        if (error) return fail("De uitnodigingen konden niet worden geladen.");
        for (const r of data ?? []) {
          ids.push(r.id);
          const name = byEmail.get(r.email)?.trim();
          if (name) names[r.id] = name.slice(0, 80);
        }
      }
    } else {
      const { data, error } = await supabase
        .from("survey_invitations")
        .select("id")
        .eq("experiment_id", expId)
        .in("status", ["pending", "failed"])
        .order("created_at")
        .limit(MAX_JOB_IDS);
      if (error) return fail("De uitnodigingen konden niet worden geladen.");
      for (const r of data ?? []) ids.push(r.id);
    }
    return await enqueueSurveyJob(ideaId, expId, "survey_invite", { template: pre.template, ids, names: Object.keys(names).length ? names : undefined });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Er ging iets mis.");
  }
}

// One reminder for people who did not respond, at least three days after the first mail. The reminder reuses the
// personal link; the worker checks the three days and "no reminder yet" again when it claims each invitation.
export async function startReminderSend(ideaId: string, expId: string, input: { template: unknown }): Promise<StartJobResult> {
  try {
    const pre = await sendPreflight(input.template);
    if ("error" in pre) return pre;
    await liveSurvey(ideaId, expId);
    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("survey_invitations")
      .select("id, status, sent_at, reminded_at, error")
      .eq("experiment_id", expId)
      .eq("status", "sent")
      .is("error", null)
      .is("reminded_at", null)
      .order("sent_at")
      .limit(MAX_JOB_IDS);
    if (error) return fail("De uitnodigingen konden niet worden geladen.");
    const now = new Date();
    const ids = (data ?? []).filter((r) => canRemind(r, now)).map((r) => r.id);
    return await enqueueSurveyJob(ideaId, expId, "survey_reminder", { template: pre.template, ids });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Er ging iets mis.");
  }
}

// Polled by the Distribution panel while a job is active. When no cron has picked the job up yet (Vercel Hobby
// has no per-minute cron), the poll kicks the worker after its response.
export async function surveyJobStatus(ideaId: string, expId: string): Promise<{ error?: string; job?: SurveyJob | null }> {
  try {
    await loadExp(ideaId, expId);
    const job = await latestSurveyJob(expId);
    if (job && jobNeedsWorker(job)) kickWorker(20_000);
    return { job };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Er ging iets mis.");
  }
}

// Stop button: cancels the job; mails already handed to the mail service are not recalled.
export async function cancelSurveyJob(ideaId: string, expId: string, jobId: string): Promise<{ error?: string; job?: SurveyJob | null }> {
  try {
    await loadExp(ideaId, expId);
    const supabase = await supabaseServer();
    const { error } = await supabase.rpc("cancel_job", { p_job: jobId });
    if (error) return fail("Stoppen is mislukt.");
    refresh(ideaId, expId);
    return { job: await latestSurveyJob(expId) };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Er ging iets mis.");
  }
}

// Without a mail connection: the personal links of everyone not yet mailed, as CSV (e-mail, link, afmeldlink).
// The links are the same every time (see invitationToken), so exporting twice is harmless.
export async function exportInvitationLinks(ideaId: string, expId: string): Promise<{ error?: string; csv?: string; count?: number }> {
  try {
    const { slug } = await liveSurvey(ideaId, expId);
    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("survey_invitations")
      .select("id, email")
      .eq("experiment_id", expId)
      .in("status", ["pending", "failed"])
      .order("created_at")
      .limit(MAX_INVITES * 5);
    if (error) return fail("De uitnodigingen konden niet worden geladen.");
    const rows = (data ?? []).map((r) => {
      const l = personalLinks(slug, r.id, r.email);
      return { email: r.email, link: l.link, unsubscribe: l.unsubscribe };
    });
    return { csv: linksCsv(rows), count: rows.length };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Er ging iets mis.");
  }
}

// ---------------------------------------------------------------------------
// Invitation posts (any test with a public link)
// ---------------------------------------------------------------------------

function promoInput(exp: Exp, opts: { incentive: string | null; dmIncludesLink: boolean }): PromoInput | null {
  if (exp.type === "survey") {
    const c = surveyConfig(exp);
    if (!c) return null;
    return { kind: "survey", topic: c.title, purpose: c.intro, audience: exp.target_group, researcher: c.researcher, minutes: c.estimated_minutes, ...opts };
  }
  if (exp.type === "landing" || exp.type === "pricing") {
    const c = exp.config as Partial<LandingConfig>;
    return { kind: exp.type, topic: c.headline ?? "", purpose: c.subline ?? "", audience: exp.target_group, researcher: c.researcher ?? "", minutes: null, ...opts };
  }
  return null;
}

function promoLinks(exp: Exp): Record<PromoPlatform, string> {
  return Object.fromEntries(PROMO_PLATFORM_KEYS.map((k) => [k, channelLink(env.appUrl, exp.type, exp.public_slug!, PROMO_PLATFORMS[k].channel)])) as Record<PromoPlatform, string>;
}

const PROMO_STATES = ["approved", "live", "paused"];

export type PromoState = { error?: string | null; ok?: string | null };

const GenerateSchema = z.object({
  mode: z.enum(["ai", "template"]),
  platform: z.string().optional(),
  incentive: z.string().trim().max(160).optional(),
  dmIncludesLink: z.boolean().optional(),
});

// Generates (or regenerates) posts for all platforms or one; replaces the earlier version of those platforms.
export async function generatePromo(ideaId: string, expId: string, raw: unknown): Promise<PromoState> {
  try {
    const parsed = GenerateSchema.safeParse(raw);
    if (!parsed.success) return fail("Ongeldige invoer.");
    const v = parsed.data;
    const exp = await loadExp(ideaId, expId);
    if (!exp.public_slug || !PROMO_STATES.includes(exp.state)) return fail("Berichten maken kan zodra de test is goedgekeurd en een publiek adres heeft.");
    const platforms = v.platform ? (isPromoPlatform(v.platform) ? [v.platform] : null) : PROMO_PLATFORM_KEYS;
    if (!platforms) return fail("Onbekend platform.");
    const input = promoInput(exp, { incentive: v.incentive || null, dmIncludesLink: !!v.dmIncludesLink });
    if (!input) return fail("Deze test heeft geen publieke pagina.");
    const links = promoLinks(exp);

    let posts: { platform: PromoPlatform; body: string }[];
    let origin: "ai" | "template" = "template";
    let note: string | null = null;
    if (v.mode === "ai" && aiConfigured()) {
      try {
        const res = await runAi(ideaId, "promo_posts", () => draftPromoPosts(input, platforms));
        const byPlatform = new Map(res.data.posts.map((p) => [p.platform, p.body]));
        const fallback = templatePosts(input, links, platforms);
        posts = platforms.map((k) => {
          const body = byPlatform.get(k);
          return body && body.trim().length >= PROMO_MIN ? { platform: k, body: finalizePost(k, body, links[k], { includeLink: input.dmIncludesLink }) } : fallback.find((f) => f.platform === k)!;
        });
        origin = "ai";
      } catch (e) {
        posts = templatePosts(input, links, platforms);
        note = `${aiErrorMessage(e, "AI gaf geen bruikbare berichten.")} De sjabloonteksten zijn gebruikt.`;
      }
    } else {
      posts = templatePosts(input, links, platforms);
      if (v.mode === "ai") note = "AI is niet verbonden; de sjabloonteksten zijn gebruikt.";
    }
    const supabase = await supabaseServer();
    const { error: delError } = await supabase.from("promo_posts").delete().eq("experiment_id", expId).in("platform", platforms);
    if (delError) return fail("De vorige berichten konden niet worden vervangen.");
    const { error } = await supabase
      .from("promo_posts")
      .insert(posts.filter((p) => p.body.length >= PROMO_MIN).map((p) => ({ experiment_id: expId, idea_id: ideaId, platform: p.platform, body: p.body.slice(0, 3000), origin })));
    if (error) return fail("De berichten konden niet worden opgeslagen.");
    refresh(ideaId, expId);
    return { ok: note ?? (origin === "ai" ? "AI-concepten gemaakt. Lees ze na voor je ze plaatst." : "Berichten gemaakt.") };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Er ging iets mis.");
  }
}

export async function savePromoPost(ideaId: string, expId: string, postId: string, body: unknown): Promise<PromoState> {
  try {
    const text = typeof body === "string" ? body.trim() : "";
    await requireWritableIdea(ideaId);
    const supabase = await supabaseServer();
    const { data: post } = await supabase.from("promo_posts").select("id, platform").eq("id", postId).eq("experiment_id", expId).maybeSingle();
    if (!post || !isPromoPlatform(post.platform)) return fail("Bericht niet gevonden.");
    const max = PROMO_PLATFORMS[post.platform].max;
    if (text.length < PROMO_MIN) return fail(`Een bericht heeft minstens ${PROMO_MIN} tekens.`);
    if (text.length > max) return fail(`Te lang: ${text.length} van maximaal ${max} tekens voor ${PROMO_PLATFORMS[post.platform].label}.`);
    const { error } = await supabase.from("promo_posts").update({ body: text, origin: "manual" }).eq("id", postId);
    if (error) return fail("Opslaan is mislukt.");
    refresh(ideaId, expId);
    return { ok: "Opgeslagen." };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Er ging iets mis.");
  }
}

export async function deletePromoPost(ideaId: string, expId: string, postId: string): Promise<PromoState> {
  try {
    await requireWritableIdea(ideaId);
    const supabase = await supabaseServer();
    const { error } = await supabase.from("promo_posts").delete().eq("id", postId).eq("experiment_id", expId);
    if (error) return fail("Verwijderen is mislukt.");
    refresh(ideaId, expId);
    return { ok: "Verwijderd." };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Er ging iets mis.");
  }
}
