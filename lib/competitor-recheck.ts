import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { recomputeClaim } from "@/lib/claims";
import { fetchPageText } from "@/lib/fetch-page";
import { log } from "@/lib/log";
import { pickDueForRecheck, priceOnPage, recheckChanges, recheckNote, recheckQuotes, RECHECK_DAYS, type CompetitorRecheck, type PageRecheck } from "@/lib/domain/recheck";

// Concurrentiecontrole (onderzoek 7.2): pagina's opnieuw ophalen, citaten en prijs letterlijk vergelijken, nooit iets
// verwijderen. Gedeeld door de knop "Controleer opnieuw" (research/actions.ts) en de automatische maandelijkse controle.
// Draait onder de sessie van de gebruiker (RLS): wie het idee niet mag schrijven, kan niets bijwerken.

export type CompetitorRow = { id: string; name: string; website: string | null; visible_price: string | null; claim_id: string | null };

export async function recheckCompetitorRow(ideaId: string, comp: CompetitorRow) {
  const supabase = await supabaseServer();
  const pages: PageRecheck[] = [];
  const affectedClaims = new Set<string>();
  if (comp.claim_id) {
    affectedClaims.add(comp.claim_id);
    const { data: links } = await supabase.from("claim_sources").select("source_id, sources(id, url)").eq("claim_id", comp.claim_id).eq("idea_id", ideaId);
    const seen = new Set<string>();
    for (const l of links ?? []) {
      const src = l.sources;
      if (!src?.url || seen.has(src.id)) continue;
      seen.add(src.id);
      // Every quote stored from this page is rechecked, also those of other findings.
      const { data: quotes } = await supabase.from("claim_sources").select("id, quote, claim_id").eq("source_id", src.id).eq("idea_id", ideaId);
      try {
        const page = await fetchPageText(src.url);
        const result = recheckQuotes((quotes ?? []).map((q) => ({ id: q.id, quote: q.quote })), page.text);
        pages.push({ url: src.url, reachable: true, quotes: result });
        const checkedAt = new Date().toISOString();
        for (const r of result) {
          await supabase.from("claim_sources").update({ live_found: r.found, live_checked_at: checkedAt }).eq("id", r.id).eq("idea_id", ideaId);
        }
        await supabase.from("sources").update({ live_checked_at: checkedAt, live_error: null }).eq("id", src.id).eq("idea_id", ideaId);
        for (const q of quotes ?? []) affectedClaims.add(q.claim_id);
      } catch (e) {
        const message = e instanceof Error ? e.message.slice(0, 120) : "onbekende fout";
        pages.push({ url: src.url, reachable: false, error: message });
        await supabase.from("sources").update({ live_checked_at: new Date().toISOString(), live_error: message }).eq("id", src.id).eq("idea_id", ideaId);
      }
    }
  }
  let website: CompetitorRecheck["website"] = null;
  if (comp.website) {
    try {
      const page = await fetchPageText(comp.website);
      website = { reachable: true, priceFound: priceOnPage(comp.visible_price, page.text) };
    } catch {
      website = { reachable: false, priceFound: null };
    }
  }
  for (const c of affectedClaims) await recomputeClaim(c);
  await supabase.from("competitors").update({ last_checked_at: new Date().toISOString() }).eq("id", comp.id).eq("idea_id", ideaId);
  return { name: comp.name, checked: pages.length + (website ? 1 : 0), changes: recheckChanges({ name: comp.name, pages, website }) };
}


// Automatische maandelijkse controle: aangeroepen na het tonen van een ideepagina (zie app/app/coach-review-actions.ts),
// voor iemand die het idee mag schrijven. Claimt eerst de aanbieders (last_checked_at nu), zodat twee tegelijk geopende
// pagina's niet dubbel controleren; daarna dezelfde controle als de knop. Verschillen worden een "Let op"-tip.
export async function runAutoRecheck(ideaId: string, now: Date = new Date()): Promise<{ checked: number; changed: number }> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("competitors")
    .select("id, name, website, visible_price, claim_id, kind, origin, last_checked_at, created_at")
    .eq("idea_id", ideaId);
  const due = pickDueForRecheck(
    (data ?? []).map((c) => ({ ...c, hasLinkedSource: !!c.claim_id })),
    now,
  );
  if (!due.length) return { checked: 0, changed: 0 };
  const cutoff = new Date(now.getTime() - RECHECK_DAYS * 86_400_000).toISOString();
  let checked = 0;
  let changed = 0;
  for (const c of due) {
    // Claim: alleen als niemand anders hem net heeft gecontroleerd.
    const { data: claimed } = await supabase
      .from("competitors")
      .update({ last_checked_at: now.toISOString() })
      .eq("id", c.id)
      .eq("idea_id", ideaId)
      .or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`)
      .select("id");
    if (!claimed?.length) continue;
    try {
      const r = await recheckCompetitorRow(ideaId, c);
      checked++;
      if (r.changes.length) {
        changed++;
        const note = recheckNote(c, r.changes, ideaId, now);
        // Eén tip per aanbieder per maand (unieke index op open notities met dezelfde code).
        await supabase.from("coach_notes").insert({ idea_id: ideaId, source: "rules", ...note });
      }
    } catch (e) {
      await log.error("auto_recheck_failed", { ideaId, competitorId: c.id }, e);
    }
  }
  return { checked, changed };
}
