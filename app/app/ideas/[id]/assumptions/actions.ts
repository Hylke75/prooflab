"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWritableIdea } from "@/lib/data";
import { TEMPLATE_ASSUMPTIONS } from "@/lib/domain/recommend";
import { aiConfigured } from "@/lib/env";
import { extractClaims, searchQuestion, suggestAssumptions, type ExcerptRef } from "@/lib/ai/research";
import { storeExtractedClaims, storeFoundSources } from "@/lib/research-runner";
import { ideaContext } from "@/lib/idea-context";
import { aiErrorMessage, runAi } from "@/lib/ai/guard";

export type ActionState = { error: string | null; ok?: string | null };

const refresh = (id: string) => revalidatePath(`/app/ideas/${id}`, "layout");

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
  const { error } = await supabase.from("assumptions").insert({ ...p.data, idea_id: ideaId, origin: "manual" });
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
  const { error } = await supabase.from("assumption_claims").upsert({ assumption_id: assumptionId, claim_id: p.data.claim_id, idea_id: ideaId, relation: p.data.relation });
  if (error) return { error: "Koppelen mislukt." };
  refresh(ideaId);
  return { error: null, ok: "Bevinding gekoppeld; de bewijsas is bijgewerkt." };
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
      const res = await runAi(ideaId, "assumptions", () =>
        suggestAssumptions(ideaContext(idea), (claims ?? []).map((c) => `${c.statement} [${c.status}]`)),
      );
      await supabase.from("assumptions").insert(res.data.assumptions.map((a) => ({ ...a, idea_id: ideaId, origin: "ai" })));
      refresh(ideaId);
      return { error: null, ok: `${res.data.assumptions.length} aannames voorgesteld. Pas aan of verwijder wat niet klopt.` };
    } catch {
      // Logged by runAi; fall back to the template below.
    }
  }
  await supabase.from("assumptions").insert(TEMPLATE_ASSUMPTIONS.map((a) => ({ ...a, idea_id: ideaId, origin: "template" })));
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
    const search = await runAi(ideaId, "red_team:search", () => searchQuestion(ctx, question, 4));
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
    const extract = await runAi(ideaId, "red_team:extract", () => extractClaims(ctx, question, refs));
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
