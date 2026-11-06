"use server";

// Fase 2 · punt 5: werving bijhouden. Alleen het onderzoeksteam (requireWritableIdea + RLS). Regels worden alleen
// toegevoegd: een correctie is een nieuwe regel met een negatief aantal en een reden (de database dwingt dat af).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWritableIdea } from "@/lib/data";
import { contentHash } from "@/lib/claims";
import { insertClaimWithQuote } from "@/lib/claim-insert";
import { loadRecruitment, NOT_MIGRATED } from "@/lib/recruitment-data";
import { decisive } from "@/lib/domain/customer-research";
import { todayInNL } from "@/lib/domain/sprint";
import { CHANNELS } from "@/lib/domain/tracking";
import { channelLabel, manualStepsFor, RECRUITMENT_SOURCE_PUBLISHER, responseClaimText, FUNNEL_STEPS } from "@/lib/domain/recruitment-funnel";
import type { FormState } from "@/components/ui/ActionForm";

const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
const fail = (error: string): FormState => ({ error });
const refresh = (ideaId: string, expId: string) => {
  revalidatePath(`/app/ideas/${ideaId}/experiments/${expId}`);
  revalidatePath(`/app/ideas/${ideaId}`);
};

// Database-meldingen in gewone taal. Een ontbrekende tabel = migratie nog niet toegepast.
function dbMessage(message: string | undefined): string {
  const m = message ?? "";
  if (/recruitment_(entries|campaigns)|relation .* does not exist|schema cache/i.test(m) && !/RECRUITMENT_/.test(m)) return NOT_MIGRATED;
  if (m.includes("RECRUITMENT_NEGATIVE")) return "Deze correctie zou het aantal onder nul brengen. Controleer het aantal.";
  if (m.includes("RECRUITMENT_REASON")) return "Geef bij een correctie de reden op (minstens 5 tekens).";
  if (m.includes("RECRUITMENT_STATE")) return "Werving bijhouden kan vanaf een goedgekeurde test.";
  if (m.includes("RECRUITMENT_STEP")) return "Afspraken horen bij een interviewtest.";
  if (m.includes("RECRUITMENT_DATE")) return "De datum ligt in de toekomst of is ongeldig.";
  if (m.includes("RECRUITMENT_CORRECTION")) return "Een tegenboeking hoort bij dezelfde test, hetzelfde kanaal en dezelfde stap.";
  if (m.includes("recruitment_campaigns_uniq") || m.includes("duplicate key")) return "Deze campagne is al aan een test van dit dossier gekoppeld.";
  return "Opslaan is mislukt.";
}

async function loadTest(ideaId: string, expId: string) {
  const supabase = await supabaseServer();
  const { data: exp } = await supabase
    .from("experiments")
    .select("id, idea_id, title, type, state, started_at, ends_at, hypotheses(*)")
    .eq("id", expId)
    .eq("idea_id", ideaId)
    .maybeSingle();
  return { supabase, exp };
}

const EntrySchema = z.object({
  entry_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Kies de datum.")
    .refine((d) => d <= todayInNL(), "De datum ligt in de toekomst."),
  channel: z.enum(Object.keys(CHANNELS) as [string, ...string[]], { message: "Kies een kanaal." }),
  step: z.enum(["approached", "responded", "appointment"], { message: "Kies een stap." }),
  quantity: z.coerce.number({ message: "Vul een aantal in." }).int("Vul een heel aantal in.").min(1, "Vul een aantal van minstens 1 in.").max(10000, "Maximaal 10.000 per regel."),
  kind: z.enum(["add", "correction"]).default("add"),
  note: z.string().trim().max(500, "De notitie is te lang (maximaal 500 tekens).").optional(),
});

export async function addRecruitmentEntry(ideaId: string, expId: string, _: FormState, form: FormData): Promise<FormState> {
  try {
    await requireWritableIdea(ideaId);
    if (!isUuid(expId)) return fail("Test niet gevonden.");
    const p = EntrySchema.safeParse(Object.fromEntries(form));
    if (!p.success) {
      const fieldErrors = Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message]));
      return { error: p.error.issues[0].message, fieldErrors };
    }
    const v = p.data;
    const note = v.note || null;
    if (v.kind === "correction" && (note ?? "").length < 5) return { error: "Geef bij een correctie de reden op (minstens 5 tekens).", fieldErrors: { note: "Reden van de correctie." } };
    const { supabase, exp } = await loadTest(ideaId, expId);
    if (!exp) return fail("Test niet gevonden.");
    if (!(manualStepsFor(exp.type) as string[]).includes(v.step)) return fail("Afspraken horen bij een interviewtest.");
    const { error } = await supabase.from("recruitment_entries").insert({
      idea_id: ideaId,
      experiment_id: expId,
      entry_date: v.entry_date,
      channel: v.channel,
      step: v.step,
      quantity: v.kind === "correction" ? -v.quantity : v.quantity,
      note,
    });
    if (error) return fail(dbMessage(error.message));
    refresh(ideaId, expId);
    const what = `${FUNNEL_STEPS[v.step].label.toLowerCase()} via ${channelLabel(v.channel)}`;
    return { error: null, ok: v.kind === "correction" ? `Correctie vastgelegd: ${v.quantity} minder ${what}.` : `Vastgelegd: ${v.quantity} ${what}.` };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Er ging iets mis.");
  }
}

// Tegenboeking van één eerdere regel: een nieuwe regel met het tegengestelde aantal en een reden.
export async function reverseRecruitmentEntry(ideaId: string, expId: string, entryId: string, _: FormState, form: FormData): Promise<FormState> {
  try {
    await requireWritableIdea(ideaId);
    if (!isUuid(expId) || !isUuid(entryId)) return fail("Regel niet gevonden.");
    const reason = String(form.get("note") ?? "").trim();
    if (reason.length < 5) return { error: "Geef de reden van de tegenboeking op (minstens 5 tekens).", fieldErrors: { note: "Reden van de tegenboeking." } };
    const supabase = await supabaseServer();
    const { data: entry } = await supabase
      .from("recruitment_entries")
      .select("id, channel, step, quantity")
      .eq("id", entryId)
      .eq("experiment_id", expId)
      .eq("idea_id", ideaId)
      .maybeSingle();
    if (!entry) return fail("Regel niet gevonden.");
    if (entry.quantity <= 0) return fail("Een correctie wordt niet tegengeboekt; leg zo nodig een nieuwe regel vast.");
    const { error } = await supabase.from("recruitment_entries").insert({
      idea_id: ideaId,
      experiment_id: expId,
      entry_date: todayInNL(),
      channel: entry.channel,
      step: entry.step,
      quantity: -entry.quantity,
      note: reason.slice(0, 500),
      corrects_id: entry.id,
    });
    if (error) return fail(dbMessage(error.message));
    refresh(ideaId, expId);
    return { error: null, ok: "Tegengeboekt. De oorspronkelijke regel blijft zichtbaar in de registratie en het auditspoor." };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Er ging iets mis.");
  }
}

export async function linkRecruitmentCampaign(ideaId: string, expId: string, _: FormState, form: FormData): Promise<FormState> {
  try {
    await requireWritableIdea(ideaId);
    if (!isUuid(expId)) return fail("Test niet gevonden.");
    const campaign = String(form.get("campaign") ?? "").trim();
    if (!campaign || campaign.length > 200) return { error: "Kies een campagne.", fieldErrors: { campaign: "Kies een campagne." } };
    const { supabase, exp } = await loadTest(ideaId, expId);
    if (!exp) return fail("Test niet gevonden.");
    // Alleen campagnes die echt in de ontvangen Expandi-gebeurtenissen van dit dossier voorkomen.
    const { count } = await supabase.from("outreach_events").select("id", { count: "exact", head: true }).eq("idea_id", ideaId).eq("campaign", campaign);
    if (!count) return fail("Deze campagne komt niet voor in de ontvangen Expandi-gebeurtenissen van dit dossier.");
    const { error } = await supabase.from("recruitment_campaigns").insert({ idea_id: ideaId, experiment_id: expId, campaign });
    if (error) return fail(dbMessage(error.message));
    refresh(ideaId, expId);
    return { error: null, ok: `Campagne "${campaign}" gekoppeld. Benaderd en gereageerd tellen nu automatisch mee onder ${channelLabel("outreach")}.` };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Er ging iets mis.");
  }
}

export async function unlinkRecruitmentCampaign(ideaId: string, expId: string, linkId: string): Promise<void> {
  await requireWritableIdea(ideaId);
  if (!isUuid(expId) || !isUuid(linkId)) return;
  const supabase = await supabaseServer();
  await supabase.from("recruitment_campaigns").delete().eq("id", linkId).eq("experiment_id", expId).eq("idea_id", ideaId);
  refresh(ideaId, expId);
}

const FindingSchema = z.object({
  channel: z.enum(Object.keys(CHANNELS) as [string, ...string[]], { message: "Kies een kanaal." }),
  assumption_id: z.string().optional(),
  relation: z.enum(["supports", "contradicts"]).default("supports"),
});

// "Leg vast als bevinding": de server rekent de respons opnieuw uit (nooit getallen uit het formulier), maakt een bron
// van het type eigen wervingsregistratie met de getallen letterlijk als fragment, en een bevinding met dat citaat.
// De status volgt zoals altijd uit recomputeClaim: één eigen registratie is een schatting, geen geverifieerd feit.
export async function recordResponseFinding(ideaId: string, expId: string, _: FormState, form: FormData): Promise<FormState> {
  try {
    const { idea } = await requireWritableIdea(ideaId);
    if (!isUuid(expId)) return fail("Test niet gevonden.");
    const p = FindingSchema.safeParse(Object.fromEntries(form));
    if (!p.success) return fail(p.error.issues[0].message);
    const { supabase, exp } = await loadTest(ideaId, expId);
    if (!exp) return fail("Test niet gevonden.");
    const h = decisive(exp.hypotheses) ?? exp.hypotheses;
    const view = await loadRecruitment({
      ideaId,
      exp,
      minSample: h?.min_sample ?? 0,
      held: [],
      decisionDeadline: idea.decision_deadline,
    });
    if (!view.available) return fail(NOT_MIGRATED);
    const channel = view.funnel.channels.find((c) => c.channel === p.data.channel);
    const text = channel ? responseClaimText({ channel, testTitle: exp.title }) : null;
    if (!channel || !text) return fail("Voor dit kanaal is nog geen respons te berekenen: registreer eerst hoeveel mensen je benaderde en hoeveel er reageerden.");

    const today = todayInNL();
    const { data: source, error: srcError } = await supabase
      .from("sources")
      .insert({
        idea_id: ideaId,
        url: null,
        domain: null,
        title: `Eigen wervingsregistratie – ${exp.title} – ${channel.label} – ${today}`.slice(0, 300),
        publisher: RECRUITMENT_SOURCE_PUBLISHER,
        published_on: today,
        source_type: "recruitment_log",
        is_primary: false,
        access_note:
          "Eigen meting: telling van benaderde en reagerende mensen in de wervingsregistratie van ProofLab (handmatige regels en gekoppelde Expandi-campagnes). Zegt iets over het kanaal, niet over betalingsbereidheid.",
        origin: "manual",
        content_hash: contentHash(text.fragment),
      })
      .select("id")
      .single();
    if (srcError || !source) return fail(/recruitment_log|sources_source_type_check/.test(srcError?.message ?? "") ? NOT_MIGRATED : "De bron kon niet worden opgeslagen.");
    const { data: excerpt, error: exError } = await supabase
      .from("source_excerpts")
      .insert({ source_id: source.id, idea_id: ideaId, text: text.fragment, location: `kanaal ${channel.channel}` })
      .select("id, text, source_id")
      .single();
    if (exError || !excerpt) {
      // Geen halve bron: zonder fragment zou de bron misleidend zijn.
      await supabase.from("sources").delete().eq("id", source.id);
      return fail("Het bronfragment kon niet worden opgeslagen. Er is niets vastgelegd.");
    }
    const res = await insertClaimWithQuote(
      ideaId,
      {
        statement: text.statement,
        quote: text.quote,
        stance: "supports",
        evidence_type: "observed_action",
        section: "customers",
        freshness_kind: "general",
        population: idea.target_audience?.trim() || "onbekend",
        region: idea.region?.trim() || "onbekend",
        reference_date: channel.period!.to,
        period: text.period.slice(0, 60),
        does_not_prove: "Dat deze mensen het probleem hebben of willen betalen; alleen dat ze op de benadering reageerden.",
        limitations: `Eigen registratie van één test; 95%-interval ${Math.round(channel.response!.interval.low * 100)}% tot ${Math.round(channel.response!.interval.high * 100)}%.`,
      },
      excerpt,
    );
    if (res.error !== null) return fail(res.error);

    let linked = "";
    if (isUuid(p.data.assumption_id)) {
      const { data: a } = await supabase.from("assumptions").select("id").eq("id", p.data.assumption_id).eq("idea_id", ideaId).maybeSingle();
      if (a) {
        const { error } = await supabase.from("assumption_claims").upsert({ assumption_id: a.id, claim_id: res.claimId, idea_id: ideaId, relation: p.data.relation });
        linked = error ? " Koppelen aan de aanname is mislukt; doe het op de pagina Aannames." : " Gekoppeld aan de aanname; kans en rangorde zijn opnieuw berekend.";
      }
    }
    refresh(ideaId, expId);
    revalidatePath(`/app/ideas/${ideaId}/research`);
    revalidatePath(`/app/ideas/${ideaId}/assumptions`);
    return { error: null, ok: `Bevinding vastgelegd: "${text.statement}" Citaatcontrole: ${res.check === "exact" ? "letterlijk teruggevonden" : "niet exact"}.${linked}` };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Er ging iets mis.");
  }
}
