"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { getWorkspace, requireWritableIdea } from "@/lib/data";
import { loadDossier } from "@/lib/dossier";
import { buildSnapshot } from "@/lib/report";
import type { Json } from "@/lib/database.types";

export type ActionState = { error: string | null; ok?: string | null };

export async function createReportVersion(ideaId: string, _: ActionState): Promise<ActionState> {
  const { idea } = await requireWritableIdea(ideaId);
  const ws = await getWorkspace();
  const supabase = await supabaseServer();
  const d = await loadDossier(idea);
  const { count } = await supabase.from("reports").select("id", { count: "exact", head: true }).eq("idea_id", ideaId);
  const version = (count ?? 0) + 1;
  const snapshot = { ...buildSnapshot(d, { orgName: ws.org?.name ?? "", createdBy: ws.user.email }), version };
  const { error } = await supabase.from("reports").insert({ idea_id: ideaId, version, snapshot: snapshot as unknown as Json });
  if (error) return { error: "De rapportversie kon niet worden gemaakt." };
  revalidatePath(`/app/ideas/${ideaId}/report`);
  return { error: null, ok: `Versie ${version} gemaakt.` };
}
