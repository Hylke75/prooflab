import "server-only";
import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { realInterviewIds } from "@/lib/domain/practice";

// B0, punt 2: de interviews van een idee die als echt gesprek zijn aangegeven. Alleen waarnemingen daaruit
// (of zonder interview) tellen als bewijs; zie lib/domain/practice.ts. Bij het laden van waarnemingen, niet door
// gegevens te wijzigen.
//
// Via de functie real_interview_ids (migratie 20261108100000): opdrachtgevers mogen de tabel interviews niet lezen,
// maar rekenen zo met dezelfde echte gesprekken als de consultant. Bestaat de functie nog niet (oudere database),
// dan valt dit terug op de tabel; een opdrachtgever krijgt daar een lege set (strenge kant).
export const loadRealInterviewIds = cache(async (ideaId: string): Promise<Set<string>> => {
  const supabase = await supabaseServer();
  const rpc = await supabase.rpc("real_interview_ids", { p_idea: ideaId });
  if (!rpc.error) return new Set((rpc.data ?? []).map(String));
  const { data, error } = await supabase.from("interviews").select("id, is_practice").eq("idea_id", ideaId).eq("is_practice", false);
  if (error) return new Set();
  return realInterviewIds(data ?? []);
});

// Filter voor `.or(...)` op observations: geen interview, of een interview dat als echt gesprek is aangegeven.
export function realObservationFilter(realIds: ReadonlySet<string>): string {
  return realIds.size ? `interview_id.is.null,interview_id.in.(${[...realIds].join(",")})` : "interview_id.is.null";
}

// Het aantal waarnemingen uit echte gesprekken: een interview heeft ontdekkingsbewijs opgeleverd.
export const countRealInterviewObservations = cache(async (ideaId: string): Promise<number> => {
  const realIds = await loadRealInterviewIds(ideaId);
  if (realIds.size === 0) return 0;
  const supabase = await supabaseServer();
  const { count } = await supabase
    .from("observations")
    .select("id", { count: "exact", head: true })
    .eq("idea_id", ideaId)
    .eq("is_synthetic", false)
    .in("interview_id", [...realIds]);
  return count ?? 0;
});
