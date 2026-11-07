import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { contentHash } from "@/lib/claims";
import { normalizeText, registrableDomain } from "@/lib/domain/verify";

// Eén bron van het type officiële statistiek (bijv. een CBS-tabel) met letterlijke fragmenten. Gedeeld door de
// automatische CBS-stap van de onderzoeksrunner en "Haal uit CBS" bij een factor in het marktpotentieel.
//
// Een bestaande officiële bron met dezelfde URL in dit dossier wordt hergebruikt; een fragment dat er al (na
// normalisatie) letterlijk in staat ook. Zo levert twee keer dezelfde tabelregel opslaan geen tweede bron en geen
// tweede fragment op. Geeft per tekst het fragment-ID terug (in dezelfde volgorde), en het bron-ID.
export async function storeOfficialSource(
  ideaId: string,
  runId: string | null,
  s: { url: string; title: string; publisher: string; accessNote: string; location: string; excerpts: string[]; origin?: "manual" | "ai_search" },
): Promise<{ sourceId: string | null; excerptIds: string[] }> {
  const supabase = await supabaseServer();
  const { data: existing } = await supabase
    .from("sources")
    .select("id")
    .eq("idea_id", ideaId)
    .eq("url", s.url)
    .eq("source_type", "official_statistic")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  let sourceId = existing?.id ?? null;
  if (!sourceId) {
    const { data: created } = await supabase
      .from("sources")
      .insert({
        idea_id: ideaId,
        run_id: runId,
        url: s.url,
        domain: registrableDomain(s.url),
        title: s.title.slice(0, 300),
        publisher: s.publisher,
        source_type: "official_statistic",
        is_primary: true,
        origin: s.origin ?? "ai_search",
        access_note: s.accessNote.slice(0, 500),
        content_hash: contentHash(s.excerpts.join("\n")),
      })
      .select("id")
      .single();
    sourceId = created?.id ?? null;
  }
  if (!sourceId) return { sourceId: null, excerptIds: [] };
  const { data: known } = await supabase.from("source_excerpts").select("id, text").eq("source_id", sourceId);
  const byText = new Map((known ?? []).map((k) => [normalizeText(k.text), k.id]));
  const ids: string[] = [];
  for (const text of s.excerpts) {
    const hit = byText.get(normalizeText(text));
    if (hit) {
      ids.push(hit);
      continue;
    }
    const { data: ex } = await supabase.from("source_excerpts").insert({ source_id: sourceId, idea_id: ideaId, text: text.slice(0, 6000), location: s.location.slice(0, 200) }).select("id").single();
    if (ex) {
      ids.push(ex.id);
      byText.set(normalizeText(text), ex.id);
    }
  }
  return { sourceId, excerptIds: ids };
}
