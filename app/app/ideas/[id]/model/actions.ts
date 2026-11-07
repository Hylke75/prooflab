"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWritableIdea } from "@/lib/data";
import type { FormState } from "@/components/ui/ActionForm";
import {
  blockCategory,
  blockOf,
  draftsFromSources,
  isBlockOf,
  moveItem,
  nextPosition,
  validateAssumptionStatement,
  validateItem,
  validateNote,
  type CanvasKind,
} from "@/lib/domain/canvas";
import { aiConfigured } from "@/lib/env";
import { aiErrorMessage, runAi } from "@/lib/ai/guard";
import { proposeCanvas } from "@/lib/ai/canvas";
import { ideaContext } from "@/lib/idea-context";
import { assumptionDefaults, withDefaultedFallback, withFields } from "@/lib/defaulted-fields";

const UUID = /^[0-9a-f-]{36}$/i;
const UNAVAILABLE = "Het canvas is nog niet beschikbaar: de databasemigratie 20261118110000_canvas.sql is nog niet toegepast.";

// Alleen de canvaspagina verandert bij de meeste wijzigingen; een nieuwe of gekoppelde aanname raakt ook de
// aannamekaart, de stappenbalk en het overzicht (layout).
const refresh = (id: string) => revalidatePath(`/app/ideas/${id}/model`);
const refreshAll = (id: string) => revalidatePath(`/app/ideas/${id}`, "layout");

const idOf = (form: FormData, name = "item_id") => {
  const v = String(form.get(name) ?? "");
  return UUID.test(v) ? v : null;
};

type ItemRow = { id: string; canvas: string; block: string; body: string; position: number; origin: string; accepted_at: string | null; assumption_id: string | null; created_at: string };

async function loadItem(ideaId: string, itemId: string): Promise<ItemRow | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("canvas_items").select("id, canvas, block, body, position, origin, accepted_at, assumption_id, created_at").eq("id", itemId).eq("idea_id", ideaId).maybeSingle();
  return data;
}

export async function addCanvasItem(ideaId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireWritableIdea(ideaId);
  const v = validateItem({ canvas: form.get("canvas"), block: form.get("block"), body: form.get("body") });
  if (!v.ok) return { error: v.error, fieldErrors: { [v.field]: v.error } };
  const supabase = await supabaseServer();
  const { data: siblings, error: readError } = await supabase.from("canvas_items").select("id, position").eq("idea_id", ideaId).eq("canvas", v.value.canvas).eq("block", v.value.block);
  if (readError) return { error: UNAVAILABLE };
  const { error } = await supabase.from("canvas_items").insert({ idea_id: ideaId, ...v.value, position: nextPosition(siblings ?? []), origin: "manual" });
  if (error) return { error: "Opslaan mislukt. Probeer het opnieuw." };
  refresh(ideaId);
  return { error: null, ok: `Toegevoegd aan ${blockOf(v.value.block)?.label ?? "de bouwsteen"}.` };
}

export async function updateCanvasItem(ideaId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireWritableIdea(ideaId);
  const itemId = idOf(form);
  const item = itemId ? await loadItem(ideaId, itemId) : null;
  if (!item) return { error: "Onderdeel niet gevonden." };
  const v = validateItem({ canvas: item.canvas, block: item.block, body: form.get("body") });
  if (!v.ok) return { error: v.error, fieldErrors: { body: v.error } };
  if (v.value.body === item.body) return { error: null, ok: "Niets gewijzigd." };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("canvas_items").update({ body: v.value.body }).eq("id", item.id).eq("idea_id", ideaId);
  if (error) return { error: "Opslaan mislukt. Probeer het opnieuw." };
  refresh(ideaId);
  return { error: null, ok: "Opgeslagen." };
}

export async function deleteCanvasItem(ideaId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireWritableIdea(ideaId);
  const itemId = idOf(form);
  if (!itemId) return { error: "Onderdeel niet gevonden." };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("canvas_items").delete().eq("id", itemId).eq("idea_id", ideaId).select("id");
  if (error || !data?.length) return { error: "Verwijderen mislukt." };
  refresh(ideaId);
  // Een gekoppelde aanname blijft bestaan op de aannamekaart; eerdere versies bewaren het onderdeel.
  return { error: null, ok: "Verwijderd. De gekoppelde aanname (als die er was) blijft op de aannamekaart; opgeslagen versies houden het onderdeel." };
}

// Eén plek omhoog of omlaag binnen de bouwsteen (toetsenbord: twee knoppen per onderdeel).
export async function moveCanvasItem(ideaId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireWritableIdea(ideaId);
  const itemId = idOf(form);
  const direction = form.get("direction") === "down" ? "down" : "up";
  const item = itemId ? await loadItem(ideaId, itemId) : null;
  if (!item) return { error: "Onderdeel niet gevonden." };
  const supabase = await supabaseServer();
  const { data: siblings } = await supabase.from("canvas_items").select("id, position, created_at").eq("idea_id", ideaId).eq("canvas", item.canvas).eq("block", item.block);
  const changes = moveItem((siblings ?? []).map((s) => ({ id: s.id, position: s.position, createdAt: s.created_at })), item.id, direction);
  if (changes.length === 0) return { error: null, ok: direction === "up" ? "Staat al bovenaan." : "Staat al onderaan." };
  const results = await Promise.all(changes.map((c) => supabase.from("canvas_items").update({ position: c.position }).eq("id", c.id).eq("idea_id", ideaId)));
  if (results.some((r) => r.error)) return { error: "De volgorde kon niet worden opgeslagen." };
  refresh(ideaId);
  return { error: null, ok: direction === "up" ? "Eén plek omhoog." : "Eén plek omlaag." };
}

// Accepteren door een consultant: daarna telt het voorstel als onderdeel van het model (nooit als bewijs).
export async function acceptCanvasItem(ideaId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireWritableIdea(ideaId);
  const itemId = idOf(form);
  const item = itemId ? await loadItem(ideaId, itemId) : null;
  if (!item || item.origin !== "ai") return { error: "Alleen een AI-voorstel kan worden geaccepteerd." };
  if (item.accepted_at) return { error: null, ok: "Al geaccepteerd." };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("canvas_items").update({ accepted_at: new Date().toISOString() }).eq("id", item.id).eq("idea_id", ideaId);
  if (error) return { error: "Accepteren mislukt." };
  refresh(ideaId);
  return { error: null, ok: "Geaccepteerd. Het blijft een aanname: koppel het aan een aanname en toets het." };
}

// Koppelen aan een bestaande aanname (of ontkoppelen met een lege keuze).
export async function linkCanvasItem(ideaId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireWritableIdea(ideaId);
  const itemId = idOf(form);
  const item = itemId ? await loadItem(ideaId, itemId) : null;
  if (!item) return { error: "Onderdeel niet gevonden." };
  const raw = String(form.get("assumption_id") ?? "");
  const assumptionId = raw === "" ? null : UUID.test(raw) ? raw : undefined;
  if (assumptionId === undefined) return { error: "Kies een aanname uit de lijst." };
  if (item.origin === "ai" && !item.accepted_at && assumptionId) return { error: "Accepteer het AI-voorstel eerst; daarna kun je het koppelen." };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("canvas_items").update({ assumption_id: assumptionId }).eq("id", item.id).eq("idea_id", ideaId);
  if (error) return { error: error.message.includes("CANVAS_ASSUMPTION_IDEA") ? "Die aanname hoort niet bij dit idee." : "Koppelen mislukt." };
  refresh(ideaId);
  return { error: null, ok: assumptionId ? "Gekoppeld. Het onderdeel toont nu de bewijsstand van die aanname." : "Koppeling verwijderd." };
}

// Met één klik een nieuwe aanname op de aannamekaart, gekoppeld aan dit onderdeel.
export async function createAssumptionFromItem(ideaId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireWritableIdea(ideaId);
  const itemId = idOf(form);
  const item = itemId ? await loadItem(ideaId, itemId) : null;
  if (!item) return { error: "Onderdeel niet gevonden." };
  if (item.origin === "ai" && !item.accepted_at) return { error: "Accepteer het AI-voorstel eerst; een niet-geaccepteerd voorstel komt niet op de aannamekaart." };
  if (item.assumption_id) return { error: "Dit onderdeel is al gekoppeld aan een aanname." };
  const statement = validateAssumptionStatement(form.get("statement") ?? item.body);
  if (!statement.ok) return { error: statement.error, fieldErrors: { statement: statement.error } };
  const importance = Math.min(5, Math.max(1, Math.round(Number(form.get("importance") ?? 3)) || 3));
  const supabase = await supabaseServer();
  const row = { idea_id: ideaId, statement: statement.value, category: blockCategory(item.block), importance, origin: "manual" };
  const { data, error } = await withDefaultedFallback((w) => supabase.from("assumptions").insert(withFields(row, assumptionDefaults(row), w)).select("id").single());
  if (error || !data) return { error: "De aanname kon niet worden opgeslagen." };
  const { error: linkError } = await supabase.from("canvas_items").update({ assumption_id: data.id }).eq("id", item.id).eq("idea_id", ideaId);
  refreshAll(ideaId);
  if (linkError) return { error: "De aanname staat op de aannamekaart, maar koppelen aan dit onderdeel mislukte. Koppel hem handmatig." };
  return { error: null, ok: "Aanname gemaakt en gekoppeld. Je vindt hem op de aannamekaart." };
}

// Overnemen wat ProofLab al weet: doelgroep en aanbod uit de intake, segmenten en klantsignalen uit het onderzoek.
// Opnieuw overnemen voegt niets dubbel toe (bron per onderdeel, uniek per idee).
export async function importCanvasFromSources(ideaId: string, _: FormState): Promise<FormState> {
  const { idea } = await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const [segments, signals, existing] = await Promise.all([
    supabase.from("segments").select("id, label, role, job_to_be_done, pain").eq("idea_id", ideaId).order("created_at"),
    supabase.from("customer_signals").select("id, kind, label").eq("idea_id", ideaId).order("mentions", { ascending: false }).limit(30),
    supabase.from("canvas_items").select("id, canvas, block, position, source_ref").eq("idea_id", ideaId),
  ]);
  if (existing.error) return { error: UNAVAILABLE };
  const drafts = draftsFromSources({ idea, segments: segments.data ?? [], signals: signals.error ? [] : (signals.data ?? []) });
  const known = new Set((existing.data ?? []).map((r) => r.source_ref).filter(Boolean));
  const fresh = drafts.filter((d) => !known.has(d.sourceRef));
  if (fresh.length === 0) return { error: null, ok: drafts.length ? "Alles uit de intake en het onderzoek staat al in het canvas." : "Er is nog niets over te nemen: vul de intake aan of leg segmenten vast onder Markt › Doelgroepen." };
  const next = new Map<string, number>();
  for (const r of existing.data ?? []) next.set(`${r.canvas}/${r.block}`, Math.max(next.get(`${r.canvas}/${r.block}`) ?? 0, r.position + 1));
  const rows = fresh.map((d) => {
    const key = `${d.canvas}/${d.block}`;
    const position = next.get(key) ?? 0;
    next.set(key, position + 1);
    return { idea_id: ideaId, canvas: d.canvas, block: d.block, body: d.body, position, origin: d.origin, source_ref: d.sourceRef };
  });
  const { error } = await supabase.from("canvas_items").upsert(rows, { onConflict: "idea_id,source_ref", ignoreDuplicates: true });
  if (error) return { error: "Overnemen mislukt. Probeer het opnieuw." };
  refresh(ideaId);
  return { error: null, ok: `${rows.length} onderde${rows.length === 1 ? "el" : "len"} overgenomen uit de intake en het onderzoek. Het blijven aannames tot je ze koppelt en toetst.` };
}

// "Laat de coach een eerste opzet maken": AI-voorstellen, gelabeld tot een consultant ze accepteert.
export async function draftCanvasWithAi(ideaId: string, _: FormState): Promise<FormState> {
  const { idea } = await requireWritableIdea(ideaId);
  if (!aiConfigured()) return { error: "AI is niet verbonden. Vul het canvas handmatig of neem over uit de intake en het onderzoek." };
  const supabase = await supabaseServer();
  const [existing, segments, claims, assumptions] = await Promise.all([
    supabase.from("canvas_items").select("canvas, block, position").eq("idea_id", ideaId),
    supabase.from("segments").select("label, job_to_be_done, pain").eq("idea_id", ideaId).limit(10),
    supabase.from("claims").select("statement").eq("idea_id", ideaId).in("status", ["verified", "estimate"]).limit(25),
    supabase.from("assumptions").select("statement").eq("idea_id", ideaId).limit(25),
  ]);
  if (existing.error) return { error: UNAVAILABLE };
  try {
    const res = await runAi(ideaId, "canvas_draft", (p) =>
      proposeCanvas(
        ideaContext(idea),
        {
          segments: (segments.data ?? []).map((s) => [s.label, s.job_to_be_done, s.pain].filter(Boolean).join(" — ")),
          findings: (claims.data ?? []).map((c) => c.statement),
          assumptions: (assumptions.data ?? []).map((a) => a.statement),
        },
        p,
      ),
    );
    const next = new Map<string, number>();
    for (const r of existing.data ?? []) next.set(`${r.canvas}/${r.block}`, Math.max(next.get(`${r.canvas}/${r.block}`) ?? 0, r.position + 1));
    const rows = res.data.items
      .filter((i) => isBlockOf(i.canvas as CanvasKind, i.block))
      .map((i) => ({ canvas: i.canvas, block: i.block, body: i.text.replace(/\s+/g, " ").trim().slice(0, 500) }))
      .filter((i) => i.body.length >= 2)
      .map((i) => {
        const key = `${i.canvas}/${i.block}`;
        const position = next.get(key) ?? 0;
        next.set(key, position + 1);
        return { idea_id: ideaId, ...i, position, origin: "ai" };
      });
    if (rows.length === 0) return { error: null, ok: "De coach had geen voorstellen. Vul het canvas handmatig." };
    const { error } = await supabase.from("canvas_items").insert(rows);
    if (error) return { error: "De voorstellen konden niet worden opgeslagen." };
    refresh(ideaId);
    return { error: null, ok: `${rows.length} AI-voorstellen toegevoegd, gelabeld als voorstel. Accepteer, pas aan of verwijder ze; een voorstel is nooit bewijs.` };
  } catch (e) {
    return { error: aiErrorMessage(e, "De coach kon geen opzet maken. Werk handmatig verder.") };
  }
}

// Onveranderlijke momentopname met datum, auteur en notitie; de database stelt de inhoud samen.
export async function saveCanvasVersion(ideaId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireWritableIdea(ideaId);
  const note = validateNote(form.get("note"));
  if (!note.ok) return { error: note.error, fieldErrors: { note: note.error } };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("save_canvas_version", { p_idea: ideaId, p_note: note.value });
  if (error) return { error: error.message.includes("CANVAS_NOT_ALLOWED") ? "Je hebt geen schrijfrechten op dit idee." : error.code === "PGRST202" || error.code === "42883" ? UNAVAILABLE : "De versie kon niet worden opgeslagen." };
  refresh(ideaId);
  // De coachregel na een besluit kijkt naar de nieuwste versie.
  revalidatePath(`/app/ideas/${ideaId}`);
  const n = data?.[0]?.version_no;
  return { error: null, ok: n ? `Versie ${n} opgeslagen. Deze versie verandert niet meer.` : "Versie opgeslagen." };
}
