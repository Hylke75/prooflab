"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWritableIdea } from "@/lib/data";
import { TEMPLATE_ASSUMPTIONS } from "@/lib/domain/recommend";
import { aiConfigured } from "@/lib/env";
import { suggestAssumptions } from "@/lib/ai/research";
import { ideaContext } from "@/lib/idea-context";
import { logAiRun } from "@/lib/ai/log";

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
  await supabase.from("assumption_claims").delete().eq("assumption_id", assumptionId).eq("claim_id", claimId);
  refresh(ideaId);
}

export async function seedAssumptions(ideaId: string, _: ActionState): Promise<ActionState> {
  const { idea } = await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  if (aiConfigured()) {
    const { data: claims } = await supabase.from("claims").select("statement, status").eq("idea_id", ideaId).neq("status", "insufficient").limit(40);
    try {
      const res = await suggestAssumptions(ideaContext(idea), (claims ?? []).map((c) => `${c.statement} [${c.status}]`));
      await logAiRun({ ideaId, purpose: "assumptions", outcome: "ok", usage: res.usage });
      await supabase.from("assumptions").insert(res.data.assumptions.map((a) => ({ ...a, idea_id: ideaId, origin: "ai" })));
      refresh(ideaId);
      return { error: null, ok: `${res.data.assumptions.length} aannames voorgesteld. Pas aan of verwijder wat niet klopt.` };
    } catch (e) {
      await logAiRun({ ideaId, purpose: "assumptions", outcome: "error", detail: String(e) });
    }
  }
  await supabase.from("assumptions").insert(TEMPLATE_ASSUMPTIONS.map((a) => ({ ...a, idea_id: ideaId, origin: "template" })));
  refresh(ideaId);
  return { error: null, ok: "Standaardaannames toegevoegd. Maak ze specifiek voor dit idee." };
}
