"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { getUser } from "@/lib/data";
import { searchWords, type SearchGroup } from "@/lib/domain/dossier-search";
import { runDossierSearch, type SearchDb } from "@/lib/dossier-search";

export type DossierSearchState = {
  query: string;
  words: string[];
  groups: SearchGroup[];
  total: number;
  truncated: boolean;
  notesAvailable: boolean;
  error: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const empty = (query: string, error: string | null = null): DossierSearchState => ({ query, words: [], groups: [], total: 0, truncated: false, notesAvailable: true, error });

// Zoeken binnen één dossier, met de sessie van de gebruiker: row level security bepaalt wat iemand vindt
// (opdrachtgevers alleen-lezen, alleen hun eigen dossiers). Geen schrijfacties, geen AI.
export async function searchDossier(ideaId: string, raw: string): Promise<DossierSearchState> {
  const query = typeof raw === "string" ? raw.slice(0, 200) : "";
  if (typeof ideaId !== "string" || !UUID.test(ideaId)) return empty(query, "Onbekend dossier.");
  const words = searchWords(query);
  if (!words) return empty(query);
  const user = await getUser();
  if (!user) return empty(query, "Je sessie is verlopen. Log opnieuw in om te zoeken.");
  const supabase = await supabaseServer();
  // Mag deze gebruiker het dossier lezen? Zonder rij (RLS) zoeken we nergens.
  const { data: idea, error } = await supabase.from("ideas").select("id").eq("id", ideaId).maybeSingle();
  if (error) return empty(query, "Zoeken lukt nu niet. Probeer het zo opnieuw.");
  if (!idea) return empty(query, "Dit dossier bestaat niet of je hebt er geen toegang toe.");
  // De getypeerde client kent de tabel step_notes (nog) niet; het zoeken gebruikt alleen een smalle interface.
  const result = await runDossierSearch(supabase as unknown as SearchDb, ideaId, words);
  return {
    query,
    words,
    groups: result.groups,
    total: result.total,
    truncated: result.truncated,
    notesAvailable: result.notesAvailable,
    error: result.failed && result.total === 0 ? "Zoeken lukt nu niet. Probeer het zo opnieuw." : null,
  };
}
