// Zoeken binnen een dossier: de queries. Draait altijd met de sessie van de gebruiker (row level security), dus
// een opdrachtgever vindt alleen wat hij ook op de pagina's mag zien. Er wordt bewust niet gezocht in teksten die
// alleen consultants mogen zien: letterlijke citaten van waarnemingen (observations.quote), bewaarde fragmenten
// van persoonlijke bronnen (source_excerpts) en klantuitspraken. Alleen: bevindingen (claims.statement),
// aannames (assumptions.statement), bronnen (title, publisher, url) en eigen notities (step_notes.title/body,
// als die tabel er al is).
//
// Geen .or("…")-filterstring: elke kolom krijgt een eigen query met .ilike(kolom, patroon) per woord (zie
// lib/domain/dossier-search.ts). Zo kan een komma of haakje in de zoekterm nooit een extra filter worden.

import { CLAIM_STATUS, ASSUMPTION_STATUS, type ClaimStatus, type AssumptionStatus } from "@/lib/domain/labels";
import { groupHits, hitHref, ilikePattern, matchesAll, snippetAround, type SearchGroup, type SearchHit } from "@/lib/domain/dossier-search";

// Het deel van de Supabase-querybouwer dat het zoeken gebruikt; zo kan de unit-test een nep-client meegeven.
export type SearchQuery = PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> & {
  eq(col: string, v: string): SearchQuery;
  ilike(col: string, pattern: string): SearchQuery;
  order(col: string, opts: { ascending: boolean }): SearchQuery;
  limit(n: number): SearchQuery;
};
export type SearchDb = { from(table: string): { select(cols: string): SearchQuery } };

// Per kolom hooguit zoveel rijen ophalen; het totaal wordt daarna begrensd op SEARCH_MAX_RESULTS.
const PER_QUERY = 30;

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : null);

async function rowsMatching(db: SearchDb, table: string, cols: string, column: string, ideaId: string, words: string[], orderBy = "created_at") {
  let q = db.from(table).select(cols).eq("idea_id", ideaId);
  for (const w of words) q = q.ilike(column, ilikePattern(w));
  const { data, error } = await q.order(orderBy, { ascending: false }).limit(PER_QUERY);
  return { rows: (Array.isArray(data) ? data : []) as Row[], error };
}

export type DossierSearchResult = {
  groups: SearchGroup[];
  total: number;
  truncated: boolean;
  notesAvailable: boolean; // false als de tabel step_notes (nog) niet bestaat of niet leesbaar is
  failed: boolean; // een van de vaste zoekopdrachten mislukte (storing); het resultaat is dan onvolledig
};

export async function runDossierSearch(db: SearchDb, ideaId: string, words: string[]): Promise<DossierSearchResult> {
  const [claims, assumptions, srcTitle, srcPublisher, srcUrl, noteTitle, noteBody] = await Promise.all([
    rowsMatching(db, "claims", "id, statement, status", "statement", ideaId, words),
    rowsMatching(db, "assumptions", "id, statement, status, importance", "statement", ideaId, words),
    rowsMatching(db, "sources", "id, title, publisher, url, source_type", "title", ideaId, words),
    rowsMatching(db, "sources", "id, title, publisher, url, source_type", "publisher", ideaId, words),
    rowsMatching(db, "sources", "id, title, publisher, url, source_type", "url", ideaId, words),
    rowsMatching(db, "step_notes", "id, title, body, step", "title", ideaId, words),
    rowsMatching(db, "step_notes", "id, title, body, step", "body", ideaId, words),
  ]);

  // Elk resultaat met de volledige tekst waarin gezocht is (voor de controle hieronder).
  const hits: { hit: SearchHit; hay: string }[] = [];
  const push = (hit: SearchHit, ...texts: (string | null)[]) => hits.push({ hit, hay: texts.filter(Boolean).join(" ") });
  for (const r of claims.rows) {
    const id = str(r.id);
    if (!id) continue;
    const status = str(r.status) as ClaimStatus | null;
    push(
      { kind: "claim", id, title: str(r.statement) ?? "", detail: null, badge: status && status in CLAIM_STATUS ? CLAIM_STATUS[status].label : null, href: hitHref(ideaId, "claim", id) },
      str(r.statement),
    );
  }
  for (const r of assumptions.rows) {
    const id = str(r.id);
    if (!id) continue;
    const status = str(r.status) as AssumptionStatus | null;
    const imp = typeof r.importance === "number" ? r.importance : null;
    push(
      {
        kind: "assumption",
        id,
        title: str(r.statement) ?? "",
        detail: imp != null ? `Belangrijkheid ${imp}${imp >= 4 ? " (kritiek)" : ""}` : null,
        badge: status && status in ASSUMPTION_STATUS ? ASSUMPTION_STATUS[status].label : null,
        href: hitHref(ideaId, "assumption", id),
      },
      str(r.statement),
    );
  }
  // Bronnen: drie kolommen, één resultaat per bron (de volgorde van titel, uitgever, adres blijft).
  for (const r of [...srcTitle.rows, ...srcPublisher.rows, ...srcUrl.rows]) {
    const id = str(r.id);
    if (!id) continue;
    push(
      {
        kind: "source",
        id,
        title: str(r.title) || str(r.url) || "Bron zonder titel",
        detail: [str(r.publisher), str(r.url)].filter(Boolean).join(" · ") || null,
        badge: null,
        href: hitHref(ideaId, "source", id),
      },
      str(r.title),
      str(r.publisher),
      str(r.url),
    );
  }
  // Notities: de tabel komt uit een andere wijziging en kan ontbreken. Dan zoeken we gewoon zonder.
  const notesAvailable = !noteTitle.error && !noteBody.error;
  if (notesAvailable) {
    for (const r of [...noteTitle.rows, ...noteBody.rows]) {
      const id = str(r.id);
      if (!id) continue;
      const title = str(r.title)?.trim() || "Notitie zonder titel";
      const body = str(r.body) ?? "";
      push({ kind: "note", id, title, detail: body ? snippetAround(body, words) : null, badge: null, href: hitHref(ideaId, "note", id, str(r.step)) }, str(r.title), body);
    }
  }
  // Extra controle aan onze kant: alleen wat echt alle woorden bevat, met dezelfde betekenis als het patroon.
  const strict = hits.filter((h) => matchesAll(h.hay, words)).map((h) => h.hit);
  const failed = !!(claims.error || assumptions.error || srcTitle.error || srcPublisher.error || srcUrl.error);
  return { ...groupHits(strict), notesAvailable, failed };
}
