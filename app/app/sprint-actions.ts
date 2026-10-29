"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWritableIdea } from "@/lib/data";

export type SprintState = { error: string | null; ok?: string | null };

const SprintSchema = z.object({
  sprint_start: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Kies een geldige startdatum."),
  sprint_weeks: z.coerce.number().int().min(2, "Een sprint duurt minimaal 2 weken.").max(12, "Een sprint duurt maximaal 12 weken."),
});

// Plans (or re-plans) the validation sprint of one idea: start date and length in weeks.
export async function setSprint(ideaId: string, _: SprintState, form: FormData): Promise<SprintState> {
  await requireWritableIdea(ideaId);
  const p = SprintSchema.safeParse({ sprint_start: form.get("sprint_start"), sprint_weeks: form.get("sprint_weeks") });
  if (!p.success) return { error: p.error.issues[0].message };
  if (Number.isNaN(new Date(`${p.data.sprint_start}T00:00:00Z`).getTime())) return { error: "Kies een geldige startdatum." };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("ideas").update({ sprint_start: p.data.sprint_start, sprint_weeks: p.data.sprint_weeks }).eq("id", ideaId);
  if (error) return { error: "De sprintplanning kon niet worden opgeslagen." };
  revalidatePath("/app", "layout");
  return { error: null, ok: `Sprint gepland: ${p.data.sprint_weeks} weken.` };
}
