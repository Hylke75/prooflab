import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { newProposals, PROPOSAL_ORIGIN } from "@/lib/domain/competitor-proposals";
import { log } from "@/lib/log";

type Db = Awaited<ReturnType<typeof supabaseServer>>;

// Gebruikerstest D6: alternatieven die de AI in de Reality Check noemt, opslaan als voorstel (origin 'proposal', type
// "huidig alternatief", zonder website, prijs of bron). Bestaande namen worden overgeslagen. Zonder de migratie van
// groep D weigert de database 'proposal'; dan wordt er niets opgeslagen en loopt de Reality Check gewoon door.
export async function storeAlternativeProposals(supabase: Db, ideaId: string, named: { name: string; why?: string | null }[]): Promise<number> {
  if (!named.length) return 0;
  const { data: existing } = await supabase.from("competitors").select("name").eq("idea_id", ideaId);
  const fresh = newProposals(named, existing ?? []);
  if (!fresh.length) return 0;
  const { error } = await supabase.from("competitors").insert(
    fresh.map((p) => ({
      idea_id: ideaId,
      name: p.name,
      kind: "alternative",
      positioning: p.why ? `Genoemd door de AI in de Reality Check: ${p.why}` : "Genoemd door de AI in de Reality Check.",
      origin: PROPOSAL_ORIGIN,
    })),
  );
  if (error) {
    log.warn("competitor_proposals_failed", { ideaId, code: error.code });
    return 0;
  }
  return fresh.length;
}
