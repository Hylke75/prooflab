"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWritableIdea } from "@/lib/data";
import { contentHash } from "@/lib/claims";
import { env } from "@/lib/env";
import { fetchPageText } from "@/lib/fetch-page";
import { registrableDomain } from "@/lib/domain/verify";
import { newWebhookToken, tokenHash } from "@/lib/integrations/expandi";
import { NO_CAMPAIGN } from "@/lib/integrations/outreach-stats";
import { dedupeFragments, MAX_FRAGMENTS, MAX_IMPORT_BYTES, pageExcerpts, splitFragments } from "@/lib/signals/import";

export type ActionState = { error: string | null; ok?: string | null };
export type EndpointState = ActionState & { url?: string | null };

type Db = Awaited<ReturnType<typeof supabaseServer>>;

const blank = (s: unknown) => {
  const v = typeof s === "string" ? s.trim() : "";
  return v === "" ? null : v;
};

const today = () => new Date().toISOString().slice(0, 10);
const nlDate = () => new Date().toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });

function done(ideaId: string, msg: string): ActionState {
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  return { error: null, ok: msg };
}

// ---------------------------------------------------------------------------
// Expandi endpoints
// ---------------------------------------------------------------------------

export async function createExpandiEndpoint(ideaId: string, _: EndpointState, form: FormData): Promise<EndpointState> {
  await requireWritableIdea(ideaId);
  const label = z.string().trim().min(2, "Geef de koppeling een naam (minimaal 2 tekens).").max(120).safeParse(form.get("label") ?? "");
  if (!label.success) return { error: label.error.issues[0].message };
  const token = newWebhookToken();
  const supabase = await supabaseServer();
  const { error } = await supabase.from("integration_endpoints").insert({ idea_id: ideaId, provider: "expandi", label: label.data, token_hash: tokenHash(token) });
  if (error) return { error: "De koppeling kon niet worden aangemaakt." };
  revalidatePath(`/app/ideas/${ideaId}/integrations`);
  // The full URL is shown once; only the hash of the token is stored.
  return { error: null, ok: "Koppeling aangemaakt. Kopieer de URL nu: hij wordt niet opnieuw getoond.", url: `${env.appUrl.replace(/\/$/, "")}/api/integrations/expandi/${token}` };
}

export async function deactivateEndpoint(ideaId: string, endpointId: string): Promise<void> {
  await requireWritableIdea(ideaId);
  if (!/^[0-9a-f-]{36}$/i.test(endpointId)) return;
  const supabase = await supabaseServer();
  await supabase.from("integration_endpoints").update({ active: false }).eq("id", endpointId).eq("idea_id", ideaId);
  revalidatePath(`/app/ideas/${ideaId}/integrations`);
}

// ---------------------------------------------------------------------------
// Sources with many excerpts
// ---------------------------------------------------------------------------

const SIGNAL_TYPES = ["review_site", "forum", "blog", "news", "other", "outreach"] as const;

async function existingExcerptTexts(db: Db, ideaId: string): Promise<string[]> {
  const { data } = await db.from("source_excerpts").select("text").eq("idea_id", ideaId).order("created_at", { ascending: false }).limit(5000);
  return (data ?? []).map((e) => e.text);
}

async function createSource(
  db: Db,
  ideaId: string,
  meta: { title: string; source_type: string; publisher: string | null; url: string | null; published_on: string | null; access_note: string },
  excerpts: string[],
): Promise<string | null> {
  const { data: source, error } = await db
    .from("sources")
    .insert({
      idea_id: ideaId,
      url: meta.url,
      domain: registrableDomain(meta.url),
      title: meta.title.slice(0, 300),
      publisher: meta.publisher,
      published_on: meta.published_on,
      source_type: meta.source_type,
      is_primary: false,
      access_note: meta.access_note.slice(0, 600),
      origin: "manual",
      content_hash: contentHash(excerpts.join("\n")),
    })
    .select("id")
    .single();
  if (error || !source) return "De bron kon niet worden opgeslagen.";
  for (let i = 0; i < excerpts.length; i += 500) {
    const { error: e } = await db
      .from("source_excerpts")
      .insert(excerpts.slice(i, i + 500).map((text, j) => ({ source_id: source.id, idea_id: ideaId, text, location: `fragment ${i + j + 1}` })));
    if (e) {
      // No half imports: a source without all its fragments would be misleading.
      await db.from("sources").delete().eq("id", source.id);
      return "De fragmenten konden niet worden opgeslagen. Er is niets geïmporteerd.";
    }
  }
  return null;
}

const ImportSchema = z.object({
  source_type: z.enum(SIGNAL_TYPES),
  title: z.string().trim().min(2, "Geef de import een titel.").max(300),
  publisher: z.string().trim().max(200).optional(),
  url: z.string().trim().url("Vul een geldige URL in of laat het veld leeg.").max(2000).optional().or(z.literal("")),
  published_on: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  mode: z.enum(["paste", "csv"]),
  split: z.enum(["auto", "line", "blank"]).optional(),
  text: z.string().optional(),
  fragments_json: z.string().optional(),
  no_personal_data: z.literal("on", { message: "Bevestig dat persoonsgegevens zijn verwijderd." }),
});

export async function importFragments(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const parsed = ImportSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  let raw: string[];
  if (v.mode === "paste") {
    const text = v.text ?? "";
    if (text.length > MAX_IMPORT_BYTES) return { error: "De geplakte tekst is groter dan 1 MB. Splits de import op." };
    raw = splitFragments(text, v.split ?? "auto");
  } else {
    const json = v.fragments_json ?? "";
    if (json.length > MAX_IMPORT_BYTES) return { error: "De gekozen kolom is groter dan 1 MB. Splits het bestand op." };
    let list: unknown;
    try {
      list = JSON.parse(json);
    } catch {
      return { error: "Kies eerst een CSV-bestand en de kolom met de tekst." };
    }
    if (!Array.isArray(list) || !list.every((x) => typeof x === "string")) return { error: "Kies eerst een CSV-bestand en de kolom met de tekst." };
    raw = list as string[];
  }
  if (raw.length > MAX_FRAGMENTS) return { error: `Maximaal ${MAX_FRAGMENTS.toLocaleString("nl-NL")} fragmenten per import; deze import heeft er ${raw.length.toLocaleString("nl-NL")}.` };
  const supabase = await supabaseServer();
  const result = dedupeFragments(raw, { existing: await existingExcerptTexts(supabase, ideaId) });
  if (result.fragments.length === 0) {
    return { error: result.duplicates ? "Alle fragmenten staan al in de bronnen van dit dossier." : "Er zijn geen bruikbare fragmenten gevonden." };
  }
  const err = await createSource(
    supabase,
    ideaId,
    {
      title: v.title,
      source_type: v.source_type,
      publisher: blank(v.publisher),
      url: blank(v.url),
      published_on: blank(v.published_on),
      access_note: `Bulkimport (${v.mode === "csv" ? "CSV" : "geplakte tekst"}) op ${nlDate()}: ${result.fragments.length} fragmenten. Klantsignalen zijn kwalitatieve observaties, geen gedrag.`,
    },
    result.fragments,
  );
  if (err) return { error: err };
  const skipped = [
    result.duplicates ? `${result.duplicates} dubbel` : null,
    result.tooShort ? `${result.tooShort} te kort` : null,
    result.truncated ? `${result.truncated} ingekort tot 6.000 tekens` : null,
  ].filter(Boolean);
  return done(ideaId, `${result.fragments.length} fragmenten opgeslagen als één bron.${skipped.length ? ` Overgeslagen of aangepast: ${skipped.join(", ")}.` : ""}`);
}

const PageSchema = z.object({
  url: z.string().trim().url("Vul een geldige URL in.").max(2000),
  source_type: z.enum(SIGNAL_TYPES),
  title: z.string().trim().max(300).optional(),
  publisher: z.string().trim().max(200).optional(),
  published_on: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
});

export async function fetchPageSource(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const parsed = PageSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  let page: { url: string; title: string | null; text: string };
  try {
    page = await fetchPageText(v.url);
  } catch (e) {
    return { error: `De pagina kon niet worden opgehaald: ${e instanceof Error ? e.message : "onbekende fout"}` };
  }
  const supabase = await supabaseServer();
  const result = dedupeFragments(pageExcerpts(page.text), { existing: await existingExcerptTexts(supabase, ideaId) });
  if (result.fragments.length === 0) return { error: "Op deze pagina staat geen bruikbare tekst, of de tekst staat al in de bronnen. Sommige sites laden hun inhoud pas in de browser; plak de tekst dan zelf." };
  const err = await createSource(
    supabase,
    ideaId,
    {
      title: blank(v.title) ?? page.title ?? page.url,
      source_type: v.source_type,
      publisher: blank(v.publisher),
      url: page.url,
      published_on: blank(v.published_on),
      access_note: `Paginatekst automatisch opgehaald op ${nlDate()} (${result.fragments.length} fragmenten). Controleer of de voorwaarden van het platform dit toestaan.`,
    },
    result.fragments,
  );
  if (err) return { error: err };
  return done(ideaId, `Pagina opgeslagen als bron met ${result.fragments.length} ${result.fragments.length === 1 ? "fragment" : "fragmenten"}.`);
}

// ---------------------------------------------------------------------------
// Expandi replies → customer signals
// ---------------------------------------------------------------------------

export async function importOutreachReplies(ideaId: string, _: ActionState): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { data: replies, error } = await supabase
    .from("outreach_events")
    .select("campaign, message, received_at")
    .eq("idea_id", ideaId)
    .eq("event_type", "reply")
    .not("message", "is", null)
    .order("received_at")
    .limit(5000);
  if (error) return { error: "De antwoorden konden niet worden opgehaald." };
  const existing = await existingExcerptTexts(supabase, ideaId);
  const byCampaign = new Map<string, string[]>();
  for (const r of replies ?? []) {
    const key = r.campaign?.trim() || NO_CAMPAIGN;
    byCampaign.set(key, [...(byCampaign.get(key) ?? []), r.message ?? ""]);
  }
  let sources = 0;
  let fragments = 0;
  for (const [campaign, texts] of byCampaign) {
    const result = dedupeFragments(texts, { existing });
    if (result.fragments.length === 0) continue;
    existing.push(...result.fragments);
    const err = await createSource(
      supabase,
      ideaId,
      {
        title: `Expandi-antwoorden – ${campaign} – ${nlDate()}`,
        source_type: "outreach",
        publisher: "LinkedIn (via Expandi)",
        url: null,
        published_on: today(),
        access_note:
          "Antwoorden op LinkedIn-outreach, ontvangen via de Expandi-webhook. Namen en profiel-URL's zijn niet opgeslagen. Kwalitatieve signalen: een antwoord is geen bewijs van betalingsbereidheid.",
      },
      result.fragments,
    );
    if (err) return { error: err };
    sources++;
    fragments += result.fragments.length;
  }
  if (sources === 0) return { error: (replies ?? []).length ? "Alle antwoorden staan al als klantsignaal in de bronnen." : "Er zijn nog geen antwoorden met tekst ontvangen." };
  return done(ideaId, `${fragments} ${fragments === 1 ? "antwoord" : "antwoorden"} opgenomen in ${sources} ${sources === 1 ? "bron" : "bronnen"} van het type outreach.`);
}
