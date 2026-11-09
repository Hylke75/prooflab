"use server";

// Expandi campaign push for the LinkedIn-DM post of a published test. Consultants only (requireWritableIdea + RLS
// on expandi_campaign_hooks). Profile URLs and names are sent to Expandi and are not stored in ProofLab.

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWritableIdea } from "@/lib/data";
import { env } from "@/lib/env";
import { channelLink } from "@/lib/domain/survey-distribution";
import { PROMO_PLATFORMS, postLink } from "@/lib/domain/promo";
import { MAX_PUSH_CONTACTS, buildExpandiPayload, expandiCsv, parseContacts, validateCampaignUrl } from "@/lib/integrations/expandi-push";
import { postToExpandi } from "@/lib/integrations/expandi-send";
import { sleep } from "@/lib/email";

export type ExpandiState = { error?: string | null; ok?: string | null; errors?: string[]; csv?: string };

const refresh = (ideaId: string, expId: string) => revalidatePath(`/app/ideas/${ideaId}/experiments/${expId}`);
const fail = (error: string): ExpandiState => ({ error });
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

const OPEN_STATES = ["approved", "live", "paused"];

export async function saveExpandiHook(ideaId: string, expId: string, rawUrl: unknown): Promise<ExpandiState> {
  try {
    await requireWritableIdea(ideaId);
    if (!isUuid(expId)) return fail("Experiment niet gevonden.");
    const check = validateCampaignUrl(typeof rawUrl === "string" ? rawUrl : "");
    if (!check.ok) return fail(check.error);
    const supabase = await supabaseServer();
    const { error } = await supabase
      .from("expandi_campaign_hooks")
      .upsert({ experiment_id: expId, idea_id: ideaId, url: check.url, updated_at: new Date().toISOString() }, { onConflict: "experiment_id" });
    if (error) return fail("De campagne-URL kon niet worden opgeslagen.");
    refresh(ideaId, expId);
    return { ok: "Campagne-URL opgeslagen. Alleen consultants van deze werkruimte kunnen hem gebruiken." };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Er ging iets mis.");
  }
}

export async function deleteExpandiHook(ideaId: string, expId: string): Promise<ExpandiState> {
  try {
    await requireWritableIdea(ideaId);
    const supabase = await supabaseServer();
    const { error } = await supabase.from("expandi_campaign_hooks").delete().eq("experiment_id", expId).eq("idea_id", ideaId);
    if (error) return fail("Verwijderen is mislukt.");
    refresh(ideaId, expId);
    return { ok: "Campagne-URL verwijderd." };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Er ging iets mis.");
  }
}

// The DM post with its link (utm_source=outreach, utm_content=<post code>) and the parsed contacts.
async function dmAndContacts(ideaId: string, expId: string, postId: string, contactsText: unknown) {
  await requireWritableIdea(ideaId);
  if (!isUuid(expId) || !isUuid(postId)) throw new Error("Bericht niet gevonden.");
  const supabase = await supabaseServer();
  const [{ data: exp }, { data: post }] = await Promise.all([
    supabase.from("experiments").select("id, type, state, public_slug").eq("id", expId).eq("idea_id", ideaId).maybeSingle(),
    supabase.from("promo_posts").select("id, platform, body, code").eq("id", postId).eq("experiment_id", expId).maybeSingle(),
  ]);
  if (!exp?.public_slug || !OPEN_STATES.includes(exp.state)) throw new Error("De test heeft (nog) geen open publiek adres.");
  if (!post || post.platform !== "linkedin_dm") throw new Error("Alleen het LinkedIn-DM-bericht kan naar de outreachcampagne.");
  const link = postLink(channelLink(env.appUrl, exp.type, exp.public_slug, PROMO_PLATFORMS.linkedin_dm.channel), post.code);
  const parsed = parseContacts(typeof contactsText === "string" ? contactsText.slice(0, 200_000) : "");
  return { supabase, exp, post, link, parsed };
}

// CSV in Expandi's import format; nothing leaves ProofLab.
export async function exportExpandiCsv(ideaId: string, expId: string, postId: string, contactsText: unknown): Promise<ExpandiState> {
  try {
    const { post, link, parsed } = await dmAndContacts(ideaId, expId, postId, contactsText);
    if (parsed.contacts.length === 0) return fail("Er staan geen geldige LinkedIn-profiel-URL's in de lijst (verwacht: https://www.linkedin.com/in/…).");
    return {
      csv: expandiCsv(parsed.contacts.map((c) => buildExpandiPayload(c, post.body, link))),
      ok: `${parsed.contacts.length} contact(en) in de CSV.${parsed.invalid.length ? ` ${parsed.invalid.length} regel(s) overgeslagen (geen profiel-URL).` : ""}`,
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Er ging iets mis.");
  }
}

// Sends each contact to the stored campaign webhook, one by one with a short pause. Expandi then runs the
// campaign's own steps (connection request, messages) with its own daily limits.
export async function pushToExpandi(ideaId: string, expId: string, postId: string, input: { contacts: unknown; confirm: unknown }): Promise<ExpandiState> {
  try {
    if (input.confirm !== true) return fail("Bevestig dat deze mensen benaderd mogen worden en dat de campagne in de outreachtool klaarstaat.");
    const { supabase, post, link, parsed } = await dmAndContacts(ideaId, expId, postId, input.contacts);
    if (parsed.contacts.length === 0) return fail("Er staan geen geldige LinkedIn-profiel-URL's in de lijst (verwacht: https://www.linkedin.com/in/…).");
    if (parsed.contacts.length > MAX_PUSH_CONTACTS) return fail(`Maximaal ${MAX_PUSH_CONTACTS} contacten per keer; gebruik voor grotere lijsten de CSV-import van de outreachtool.`);
    const { data: hook } = await supabase.from("expandi_campaign_hooks").select("url, pushed_count").eq("experiment_id", expId).maybeSingle();
    if (!hook) return fail("Sla eerst de webhook-URL van de outreachcampagne op.");
    let sent = 0;
    const errors: string[] = [];
    for (const c of parsed.contacts) {
      const res = await postToExpandi(hook.url, buildExpandiPayload(c, post.body, link));
      if (res.ok) sent++;
      else {
        if (errors.length < 3) errors.push(res.error);
        if (!res.retryable && sent === 0) break; // a wrong URL fails for everyone: stop at once
      }
      await sleep(250);
    }
    if (sent > 0) {
      await supabase
        .from("expandi_campaign_hooks")
        .update({ pushed_count: (hook.pushed_count ?? 0) + sent, last_push_at: new Date().toISOString() })
        .eq("experiment_id", expId);
      refresh(ideaId, expId);
    }
    const notSent = parsed.contacts.length - sent;
    if (sent === 0) return { error: `Geen contacten doorgezet. ${errors[0] ?? ""}`.trim(), errors };
    return {
      ok: `${sent} contact(en) doorgezet naar de outreachcampagne.${notSent ? ` ${notSent} niet doorgezet.` : ""}${parsed.invalid.length ? ` ${parsed.invalid.length} regel(s) overgeslagen (geen profiel-URL).` : ""} De outreachtool verstuurt de berichten volgens de campagne en zijn eigen daglimieten.`,
      errors,
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Er ging iets mis.");
  }
}
