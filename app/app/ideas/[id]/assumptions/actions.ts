"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWritableIdea } from "@/lib/data";
import { selectionError, TEMPLATE_ASSUMPTIONS } from "@/lib/domain/recommend";
import { ASSUMPTION_KINDS } from "@/lib/domain/assumption-kind";
import { aiConfigured } from "@/lib/env";
import { extractClaims, suggestAssumptions, type ExcerptRef } from "@/lib/ai/research";
import { searchAcrossProviders, storeExtractedClaims, storeFoundSources } from "@/lib/research-runner";
import { ideaContext } from "@/lib/idea-context";
import { aiErrorMessage, runAi } from "@/lib/ai/guard";
import { NEUTRAL_PRIOR, priorChangeError, priorDbError } from "@/lib/domain/prior";
import { deskVerdict, DESK_SKIP_REASON } from "@/lib/domain/evidence";
import { CLAIM_STATUS, type ClaimStatus } from "@/lib/domain/labels";
import { METHODS } from "@/lib/domain/method";
import { ideaMethodVersion } from "@/lib/method-data";
import { assumptionDefaults, withDefaultedFallback, withFields } from "@/lib/defaulted-fields";

export type ActionState = { error: string | null; ok?: string | null };

const refresh = (id: string) => revalidatePath(`/app/ideas/${id}`, "layout");
// Gebruikerstest A7/A10: alleen de aannamepagina zelf opnieuw opbouwen waar de wijziging niets elders verandert (kiezen
// om nu te testen, een bevinding koppelen). Andere dossierpagina's zijn dynamisch en laden bij de volgende navigatie vers.
const refreshAssumptions = (id: string) => revalidatePath(`/app/ideas/${id}/assumptions`);

// Nederlands label van een bevindingstatus, ook in AI-prompts (gebruikerstest A4).
const statusLabel = (status: string) => (status in CLAIM_STATUS ? CLAIM_STATUS[status as ClaimStatus].label : status);

const Schema = z.object({
  statement: z.string().trim().min(10, "Formuleer de aanname als één toetsbare bewering.").max(400),
  category: z.enum(["desirability", "feasibility", "viability", "context"]),
  importance: z.coerce.number().int().min(1).max(5),
});

export async function addAssumption(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const p = Schema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await supabaseServer();
  // Fase 1 · punt 1: de startkans van 50% is een standaardwaarde; dat staat in defaulted_fields (en het auditspoor).
  const row = { ...p.data, idea_id: ideaId, origin: "manual" };
  const { error } = await withDefaultedFallback((w) => supabase.from("assumptions").insert(withFields(row, assumptionDefaults(row), w)));
  if (error) return { error: "Opslaan mislukt." };
  refresh(ideaId);
  return { error: null, ok: "Aanname toegevoegd." };
}

export async function setImportance(ideaId: string, assumptionId: string, form: FormData) {
  await requireWritableIdea(ideaId);
  const n = z.coerce.number().int().min(1).max(5).safeParse(form.get("importance"));
  if (!n.success) return;
  const supabase = await supabaseServer();
  await supabase.from("assumptions").update({ importance: n.data }).eq("id", assumptionId).eq("idea_id", ideaId);
  refresh(ideaId);
}

// Fase B4: de soort van een aanname (markt, prijs, gedrag, technisch). Leeg = afleiden uit de tekst.
export async function setKind(ideaId: string, assumptionId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const raw = String(form.get("kind") ?? "");
  const kind = raw === "" ? null : raw in ASSUMPTION_KINDS ? raw : undefined;
  if (kind === undefined) return { error: "Kies markt, prijs, gedrag, technisch, kanaal of regelgeving/context." };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("assumptions").update({ kind }).eq("id", assumptionId).eq("idea_id", ideaId);
  if (error) return { error: "De soort kon niet worden opgeslagen." };
  refresh(ideaId);
  return { error: null, ok: kind ? "Soort opgeslagen; de voorgestelde test en de rangorde zijn bijgewerkt." : "De soort wordt weer afgeleid uit de tekst." };
}

// Fase B4: maximaal drie aannames gekozen om nu te testen; de rest staat op "later". De database dwingt het
// maximum ook af (guard_selected_for_test, migratie 20261110140000).
export async function setSelectedForTest(ideaId: string, assumptionId: string, select: boolean, _: ActionState): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { data: rows, error: readError } = await supabase.from("assumptions").select("id, selected_for_test").eq("idea_id", ideaId);
  if (readError) return { error: "Kiezen kan nog niet: de databasemigratie voor fase B4 is nog niet toegepast." };
  const current = (rows ?? []).find((r) => r.id === assumptionId);
  if (!current) return { error: "Aanname niet gevonden." };
  const problem = selectionError((rows ?? []).filter((r) => r.selected_for_test).length, select, current.selected_for_test);
  if (problem) return { error: problem };
  const { error } = await supabase.from("assumptions").update({ selected_for_test: select }).eq("id", assumptionId).eq("idea_id", ideaId);
  if (error) return { error: error.message.includes("MAX_SELECTED") ? (selectionError(3, true, false) ?? "Kies maximaal drie aannames.") : "Opslaan mislukt." };
  // De keuze verandert alleen deze pagina (de stappenbalk en het menu rekenen niet met de keuze).
  refreshAssumptions(ideaId);
  return { error: null, ok: select ? "Gekozen om nu te testen." : "Op later gezet." };
}

// De startkans vóór enig bewijs ("hoe waarschijnlijk vonden we dit vooraf?"). Een afwijking van 50% vraagt een
// onderbouwing; zodra er bewijs aan de aanname hangt, kan de startkans alleen met een reden veranderen (audit).
// De database controleert hetzelfde (guard_assumption_prior).
export async function setPrior(ideaId: string, assumptionId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const prior = Number(form.get("prior"));
  const rationale = String(form.get("prior_rationale") ?? "");
  const reason = String(form.get("prior_reason") ?? "");
  const supabase = await supabaseServer();
  const { data: a } = await supabase.from("assumptions").select("prior, prior_locked_at").eq("id", assumptionId).eq("idea_id", ideaId).maybeSingle();
  if (!a) return { error: "Aanname niet gevonden." };
  const current = a.prior == null ? NEUTRAL_PRIOR : Number(a.prior);
  const problem = priorChangeError({ current, prior, rationale, reason, locked: !!a.prior_locked_at });
  if (problem) return { error: problem };
  const { error } = await supabase.rpc("change_assumption_prior", { p_assumption: assumptionId, p_prior: prior, p_rationale: rationale, p_reason: reason });
  if (error) return { error: priorDbError(error.message) };
  // Fase 1 · punt 1: de startkans is nu door een mens gekozen, niet meer de standaardwaarde (fout = kolom ontbreekt nog).
  await supabase.from("assumptions").update({ defaulted_fields: [] }).eq("id", assumptionId).eq("idea_id", ideaId);
  refresh(ideaId);
  return { error: null, ok: a.prior_locked_at ? "Startkans gewijzigd; de reden staat in het auditspoor." : "Startkans opgeslagen." };
}

export async function deleteAssumption(ideaId: string, assumptionId: string) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { count } = await supabase.from("hypotheses").select("id", { count: "exact", head: true }).eq("assumption_id", assumptionId).not("locked_at", "is", null);
  if (count) return; // assumptions behind a locked hypothesis are part of the audit trail
  await supabase.from("assumptions").delete().eq("id", assumptionId).eq("idea_id", ideaId);
  refresh(ideaId);
}

export async function linkClaim(ideaId: string, assumptionId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const p = z.object({ claim_id: z.string().uuid(), relation: z.enum(["supports", "contradicts"]) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Kies een bevinding." };
  const supabase = await supabaseServer();
  const [{ error }, { data: claim }, version] = await Promise.all([
    supabase.from("assumption_claims").upsert({ assumption_id: assumptionId, claim_id: p.data.claim_id, idea_id: ideaId, relation: p.data.relation }),
    supabase.from("claims").select("status").eq("id", p.data.claim_id).eq("idea_id", ideaId).maybeSingle(),
    ideaMethodVersion(ideaId),
  ]);
  if (error) return { error: "Koppelen mislukt." };
  // Kans en rangorde staan op de aannamepagina; de stappenbalk hangt niet af van gekoppeld bureauonderzoek.
  refreshAssumptions(ideaId);
  const done = "Bevinding gekoppeld. Kans en rangorde zijn opnieuw berekend.";
  // Gebruikerstest A2/A3: telt de bevinding (nog) niet mee, dan zegt de melding waarom.
  const v = claim && claim.status in CLAIM_STATUS ? deskVerdict({ status: claim.status as ClaimStatus, relation: p.data.relation }, { refutedCounts: METHODS[version].refutedCounts }) : null;
  if (v && !v.counts) return { error: null, ok: `${done} Deze bevinding telt nog niet mee: ${DESK_SKIP_REASON[v.reason]}.` };
  if (v && claim?.status === "refuted") return { error: null, ok: `${done} De bevinding is weerlegd en telt daarom als tegenbewijs voor deze aanname.` };
  return { error: null, ok: done };
}

export async function unlinkClaim(ideaId: string, assumptionId: string, claimId: string) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  await supabase.from("assumption_claims").delete().eq("assumption_id", assumptionId).eq("claim_id", claimId).eq("idea_id", ideaId);
  refresh(ideaId);
}

export async function seedAssumptions(ideaId: string, _: ActionState): Promise<ActionState> {
  const { idea } = await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  if (aiConfigured()) {
    const { data: claims } = await supabase.from("claims").select("statement, status").eq("idea_id", ideaId).neq("status", "insufficient").limit(40);
    try {
      const res = await runAi(ideaId, "assumptions", (p) =>
        suggestAssumptions(ideaContext(idea), (claims ?? []).map((c) => `${c.statement} [${statusLabel(c.status)}]`), p),
      );
      const rows = res.data.assumptions.map((a) => ({ ...a, idea_id: ideaId, origin: "ai" }));
      await withDefaultedFallback((w) => supabase.from("assumptions").insert(rows.map((r) => withFields(r, assumptionDefaults(r), w))));
      refresh(ideaId);
      return { error: null, ok: `${res.data.assumptions.length} aannames voorgesteld. Pas aan of verwijder wat niet klopt.` };
    } catch {
      // Logged by runAi; fall back to the template below.
    }
  }
  const rows = TEMPLATE_ASSUMPTIONS.map((a) => ({ ...a, idea_id: ideaId, origin: "template" }));
  await withDefaultedFallback((w) => supabase.from("assumptions").insert(rows.map((r) => withFields(r, assumptionDefaults(r), w))));
  refresh(ideaId);
  return { error: null, ok: "Standaardaannames toegevoegd. Maak ze specifiek voor dit idee." };
}

// Red team (research 7.8): search only for evidence AGAINST a critical assumption, with the same literal
// quote check and support check as the research run. Counter-findings are linked as "contradicts".
export async function redTeamAssumption(ideaId: string, assumptionId: string, _: ActionState): Promise<ActionState> {
  const { idea } = await requireWritableIdea(ideaId);
  if (!aiConfigured()) return { error: "AI is niet verbonden. Zoek zelf naar tegenbewijs en leg het vast onder Marktverkenning → Bronnen." };
  const supabase = await supabaseServer();
  const { data: a } = await supabase.from("assumptions").select("statement").eq("id", assumptionId).eq("idea_id", ideaId).single();
  if (!a) return { error: "Aanname niet gevonden." };
  const ctx = ideaContext(idea);
  const question = `Welk bewijs spreekt deze aanname tegen: '${a.statement.replace(/["'<>]/g, " ")}'? Zoek alleen naar bronnen die laten zien dat dit niet of maar deels klopt (tegenvoorbeelden, mislukte vergelijkbare initiatieven, tegenvallende cijfers).`;
  try {
    const search = await searchAcrossProviders(ideaId, "red_team:search", ctx, question, 4);
    const excerptIds = (await storeFoundSources(ideaId, null, search.sources)).slice(0, 40);
    if (excerptIds.length === 0) {
      refresh(ideaId);
      return { error: null, ok: "Geen bruikbaar tegenbewijs gevonden. Dat bewijst niet dat de aanname klopt; toets hem met een experiment." };
    }
    const { data: excerpts } = await supabase.from("source_excerpts").select("id, text, source_id, sources(title, url)").in("id", excerptIds);
    const list = excerpts ?? [];
    const refs: ExcerptRef[] = list.map((e, i) => ({
      ref: `F${i + 1}`,
      sourceRef: `B-${e.source_id.slice(0, 8)}`,
      title: e.sources?.title ?? "",
      url: e.sources?.url ?? null,
      text: e.text,
    }));
    const extract = await runAi(ideaId, "red_team:extract", (p) => extractClaims(ctx, question, refs, p));
    const byRef = new Map(refs.map((r, i) => [r.ref, list[i]]));
    // Only counter-findings; each quote must literally carry its own (counter) statement.
    const counter = extract.data.claims.filter((c) => c.stance === "contradicts");
    const stored = await storeExtractedClaims(ideaId, null, byRef, counter, { stance: "supports" });
    if (stored.claimIds.length) {
      await supabase
        .from("assumption_claims")
        .upsert(stored.claimIds.map((claimId) => ({ assumption_id: assumptionId, claim_id: claimId, idea_id: ideaId, relation: "contradicts" })));
    }
    refresh(ideaId);
    const extra = [
      stored.rejected ? `${stored.rejected} afgewezen (citaat niet letterlijk teruggevonden)` : "",
      stored.unsupported ? `${stored.unsupported} afgewezen (citaat draagt de bewering niet)` : "",
      stored.duplicates ? `${stored.duplicates} al bekend` : "",
    ].filter(Boolean);
    const n = stored.claimIds.length;
    return {
      error: null,
      ok: n
        ? `${n} tegenbevinding${n === 1 ? "" : "en"} met gecontroleerd citaat gekoppeld als 'spreekt tegen'${extra.length ? ` (${extra.join(", ")})` : ""}. Lees ze kritisch: het zijn AI-vondsten uit bronnen.`
        : `Geen tegenbevinding met letterlijk citaat gevonden${extra.length ? ` (${extra.join(", ")})` : ""}. Dat bewijst niet dat de aanname klopt.`,
    };
  } catch (e) {
    return { error: aiErrorMessage(e, "Het zoeken naar tegenbewijs is mislukt. Probeer het later opnieuw of zoek handmatig.") };
  }
}

// Voorstel "ProofLab eenvoudiger" (Microsoft HAX G8/G9): voorgestelde aannames (AI of standaardset) neem je één voor
// één over, pas je aan of gooi je weg. Overnemen maakt er een eigen aanname van (origin manual = door jou bevestigd).
export async function confirmAssumption(ideaId: string, assumptionId: string) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  await supabase.from("assumptions").update({ origin: "manual" }).eq("id", assumptionId).eq("idea_id", ideaId).in("origin", ["ai", "template"]);
  refresh(ideaId);
}

export async function confirmAllAssumptions(ideaId: string) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  await supabase.from("assumptions").update({ origin: "manual" }).eq("idea_id", ideaId).in("origin", ["ai", "template"]);
  refresh(ideaId);
}

export async function reviseAssumption(ideaId: string, assumptionId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const p = z.string().trim().min(10, "Schrijf de aanname als een zin van minstens tien tekens.").max(400).safeParse(form.get("statement"));
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("assumptions").update({ statement: p.data, origin: "manual" }).eq("id", assumptionId).eq("idea_id", ideaId);
  if (error) return { error: "Opslaan mislukt." };
  refresh(ideaId);
  return { error: null, ok: "Aangepast en overgenomen." };
}
