import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { countsFromRow, EMPTY_COUNTS, type ActionCounts } from "@/lib/domain/action-counts";

// Fase 2 · punt 4: de telling per persoon van één test (experiment_action_counts). Zonder de migratie (functie
// ontbreekt) of bij een fout: available = false en de bezoekers, klikkers en aanmelders uit experiment_event_counts,
// zodat de pagina en het oordeel blijven werken zoals voorheen.
export async function loadActionCounts(expId: string): Promise<{ counts: ActionCounts; available: boolean }> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("experiment_action_counts", { p_experiment: expId });
  if (!error) return { counts: countsFromRow((data ?? [])[0] as Record<string, unknown> | undefined), available: true };
  const { data: rows } = await supabase.rpc("experiment_event_counts", { p_experiment: expId });
  const counts = { ...EMPTY_COUNTS };
  for (const r of rows ?? []) {
    counts.visitors += Number(r.viewers) || 0;
    counts.clickers += Number(r.clickers) || 0;
    counts.submitters += Number(r.submitters) || 0;
  }
  return { counts, available: false };
}

// De migratie ontbreekt als de database de functie of tabel niet kent.
export function schemaMissing(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "42883" || error.code === "PGRST202" || error.code === "PGRST205" || /does not exist|schema cache|Could not find/i.test(error.message ?? "");
}
