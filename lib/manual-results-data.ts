import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { schemaMissing } from "@/lib/action-counts-data";
import type { ManualResultRow } from "@/lib/domain/manual-results";

// Bestaat de tabel van de catalogusmigratie? Zo niet, dan kan een handmatig sjabloon niet worden opgeslagen.
export async function manualSchemaAvailable(): Promise<boolean> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("manual_results").select("id").limit(1);
  return !schemaMissing(error);
}

// Experimentencatalogus: de ruwe resultaten van een handmatige test, oudste eerst. Zonder de migratie (tabel ontbreekt)
// available = false: de pagina toont dan een melding en het oordeel telt niets (nooit een geschat aantal).
export async function loadManualResults(expId: string): Promise<{ rows: ManualResultRow[]; available: boolean; error: boolean }> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("manual_results")
    .select("id, observed_on, units, successes, note, evidence_path, evidence_mime, created_at, withdrawn_at, withdraw_reason")
    .eq("experiment_id", expId)
    .order("observed_on")
    .order("created_at")
    .limit(5000);
  if (error) return { rows: [], available: !schemaMissing(error), error: !schemaMissing(error) };
  return { rows: (data ?? []) as ManualResultRow[], available: true, error: false };
}
