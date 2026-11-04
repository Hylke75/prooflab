import { describe, expect, it } from "vitest";
import { PostgrestClient } from "@supabase/postgrest-js";
import {
  groupHits,
  highlightSegments,
  hitHref,
  ilikePattern,
  matchesAll,
  SEARCH_MAX_RESULTS,
  searchWords,
  snippetAround,
  type SearchHit,
  type SearchKind,
} from "@/lib/domain/dossier-search";
import { runDossierSearch, type SearchDb, type SearchQuery } from "@/lib/dossier-search";

const IDEA = "11111111-2222-3333-4444-555555555555";

describe("zoekterm opschonen", () => {
  it("trimt, voegt witruimte samen, maakt kleine letters en ontdubbelt", () => {
    expect(searchWords("  Makelaar   NVM makelaar ")).toEqual(["makelaar", "nvm"]);
  });
  it("te kort of geen tekst geeft null", () => {
    expect(searchWords("a")).toBeNull();
    expect(searchWords("   ")).toBeNull();
    expect(searchWords(undefined)).toBeNull();
    expect(searchWords(42)).toBeNull();
  });
  it("hooguit 5 woorden en 100 tekens; stuurtekens worden spaties", () => {
    expect(searchWords("a1 a2 a3 a4 a5 a6 a7")).toHaveLength(5);
    expect(searchWords("x".repeat(500))![0]).toHaveLength(100);
    expect(searchWords("prijs\u0000test")).toEqual(["prijs", "test"]);
  });
});

describe("veilig LIKE-patroon", () => {
  it("escapet de LIKE-jokers en maakt van * hooguit één teken", () => {
    expect(ilikePattern("deel")).toBe("%deel%");
    expect(ilikePattern("50%")).toBe("%50\\%%");
    expect(ilikePattern("a_b")).toBe("%a\\_b%");
    expect(ilikePattern("c:\\pad")).toBe("%c:\\\\pad%");
    expect(ilikePattern("a*b")).toBe("%a_b%");
  });
  it("komma's, punten en haakjes blijven gewone tekens", () => {
    expect(ilikePattern("a,b).or(id.eq.1")).toBe("%a,b).or(id.eq.1%");
  });
  it("in een echte PostgREST-query wordt de zoekterm nooit een extra filter", () => {
    const db = new PostgrestClient("http://localhost/rest/v1");
    const evil = "x),idea_id.neq.0,or(statement.ilike.*";
    const q = db.from("claims").select("id").eq("idea_id", IDEA).ilike("statement", ilikePattern(evil));
    const url = (q as unknown as { url: URL }).url;
    const keys = [...url.searchParams.keys()];
    expect(keys.sort()).toEqual(["idea_id", "select", "statement"]);
    expect(url.searchParams.get("idea_id")).toBe(`eq.${IDEA}`);
    expect(url.searchParams.getAll("statement")).toEqual(["ilike.%x),idea\\_id.neq.0,or(statement.ilike._%"]);
    expect(url.searchParams.has("or")).toBe(false);
  });
});

describe("matchesAll", () => {
  it("alle woorden, hoofdletterongevoelig, * als één teken", () => {
    expect(matchesAll("Zelfstandige NVM-makelaars", ["nvm", "makelaar"])).toBe(true);
    expect(matchesAll("Zelfstandige NVM-makelaars", ["nvm", "notaris"])).toBe(false);
    expect(matchesAll("prijs 249", ["2*9"])).toBe(true);
    expect(matchesAll("a.b", ["a*b"])).toBe(true);
    expect(matchesAll("(test)", ["(test)"])).toBe(true);
    expect(matchesAll(null, ["x"])).toBe(false);
  });
});

const hit = (kind: SearchKind, id: string): SearchHit => ({ kind, id, title: `${kind} ${id}`, detail: null, badge: null, href: "#" });

describe("groeperen", () => {
  it("vaste volgorde per soort, zonder dubbelen", () => {
    const r = groupHits([hit("source", "s1"), hit("claim", "c1"), hit("source", "s1"), hit("note", "n1"), hit("assumption", "a1")]);
    expect(r.groups.map((g) => g.kind)).toEqual(["claim", "assumption", "source", "note"]);
    expect(r.groups.find((g) => g.kind === "source")!.hits).toHaveLength(1);
    expect(r.groups[0].label).toBe("Bevindingen");
    expect(r.total).toBe(4);
    expect(r.truncated).toBe(false);
  });
  it("hooguit 30 resultaten, eerlijk verdeeld over de soorten", () => {
    const many = [
      ...Array.from({ length: 40 }, (_, i) => hit("claim", `c${i}`)),
      ...Array.from({ length: 3 }, (_, i) => hit("source", `s${i}`)),
      ...Array.from({ length: 20 }, (_, i) => hit("assumption", `a${i}`)),
    ];
    const r = groupHits(many);
    expect(r.total).toBe(SEARCH_MAX_RESULTS);
    expect(r.truncated).toBe(true);
    const count = (k: SearchKind) => r.groups.find((g) => g.kind === k)?.hits.length ?? 0;
    expect(count("source")).toBe(3);
    expect(count("claim") + count("assumption")).toBe(27);
    expect(Math.abs(count("claim") - count("assumption"))).toBeLessThanOrEqual(1);
  });
  it("leeg blijft leeg", () => {
    expect(groupHits([])).toEqual({ groups: [], total: 0, truncated: false });
  });
});

describe("markeren", () => {
  it("markeert elke treffer, hoofdletterongevoelig, met de oorspronkelijke schrijfwijze", () => {
    expect(highlightSegments("NVM-makelaars en nvm", ["nvm"])).toEqual([
      { text: "NVM", match: true },
      { text: "-makelaars en ", match: false },
      { text: "nvm", match: true },
    ]);
  });
  it("voegt overlappende treffers samen", () => {
    expect(highlightSegments("makelaarskantoor", ["makelaar", "laarskan"])).toEqual([
      { text: "makelaarskan", match: true },
      { text: "toor", match: false },
    ]);
  });
  it("zonder treffer: één stuk zonder markering", () => {
    expect(highlightSegments("niets", ["x"])).toEqual([{ text: "niets", match: false }]);
    expect(highlightSegments("", ["x"])).toEqual([]);
  });
  it("een fragment rond de eerste treffer", () => {
    const long = `${"a ".repeat(100)}de treffer staat hier ${"b ".repeat(100)}`;
    const s = snippetAround(long, ["treffer"], 60);
    expect(s).toContain("treffer");
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(snippetAround("kort", ["x"])).toBe("kort");
  });
});

describe("links naar de juiste plek", () => {
  it("bevinding, aanname, bron en notitie", () => {
    expect(hitHref(IDEA, "claim", "c1")).toBe(`/app/ideas/${IDEA}/research?tab=overview#claim-c1`);
    expect(hitHref(IDEA, "assumption", "a1")).toBe(`/app/ideas/${IDEA}/assumptions?select=a1`);
    expect(hitHref(IDEA, "source", "s1")).toBe(`/app/ideas/${IDEA}/research?tab=sources#bron-s1`);
    expect(hitHref(IDEA, "note", "n1", "test")).toBe(`/app/ideas/${IDEA}/experiments`);
    expect(hitHref(IDEA, "note", "n1", "overview")).toBe(`/app/ideas/${IDEA}`);
    expect(hitHref(IDEA, "note", "n1", "onbekend")).toBe(`/app/ideas/${IDEA}`);
  });
});

// Nep-client die elke aanroep vastlegt en per tabel rijen of een fout teruggeeft.
type Call = { table: string; cols: string; ops: [string, ...unknown[]][] };
function fakeDb(tables: Record<string, Record<string, unknown>[] | { error: string }>) {
  const calls: Call[] = [];
  const db: SearchDb = {
    from(table: string) {
      return {
        select(cols: string) {
          const call: Call = { table, cols, ops: [] };
          calls.push(call);
          const q: SearchQuery = {
            eq(col, v) {
              call.ops.push(["eq", col, v]);
              return q;
            },
            ilike(col, p) {
              call.ops.push(["ilike", col, p]);
              return q;
            },
            order(col, opts) {
              call.ops.push(["order", col, opts]);
              return q;
            },
            limit(n) {
              call.ops.push(["limit", n]);
              return q;
            },
            then(res, rej) {
              const t = tables[table];
              const out = !t ? { data: [], error: null } : "error" in t ? { data: null, error: { message: t.error, code: "42P01" } } : { data: t, error: null };
              return Promise.resolve(out).then(res, rej);
            },
          };
          return q;
        },
      };
    },
  };
  return { db, calls };
}

describe("runDossierSearch", () => {
  it("elke query is beperkt tot het dossier, gebruikt per woord een ilike en nooit .or()", async () => {
    const { db, calls } = fakeDb({});
    await runDossierSearch(db, IDEA, ["prijs", "a,b)"]);
    expect(calls.map((c) => `${c.table}`)).toEqual(["claims", "assumptions", "sources", "sources", "sources", "step_notes", "step_notes"]);
    for (const c of calls) {
      expect(c.ops[0]).toEqual(["eq", "idea_id", IDEA]);
      const ilikes = c.ops.filter((o) => o[0] === "ilike");
      expect(ilikes.map((o) => o[2])).toEqual(["%prijs%", "%a,b)%"]);
      expect(c.ops.some((o) => o[0] === "limit")).toBe(true);
      // Nooit teksten die alleen consultants mogen zien.
      expect(c.cols).not.toMatch(/quote|excerpt/);
    }
    expect(calls.map((c) => c.ops.find((o) => o[0] === "ilike")![1])).toEqual(["statement", "statement", "title", "publisher", "url", "title", "body"]);
  });

  it("groepeert resultaten met status en ontdubbelt een bron die op meer kolommen matcht", async () => {
    const { db } = fakeDb({
      claims: [{ id: "c1", statement: "Er zijn 4.100 NVM-makelaars", status: "verified" }],
      assumptions: [{ id: "a1", statement: "NVM-makelaars betalen € 249", status: "testing", importance: 5 }],
      sources: [{ id: "s1", title: "Jaarcijfers NVM", publisher: "NVM", url: "https://nvm.nl" }],
      step_notes: [{ id: "n1", title: "", body: "Gesprek met de NVM over prijzen", step: "market" }],
    });
    const r = await runDossierSearch(db, IDEA, ["nvm"]);
    expect(r.notesAvailable).toBe(true);
    expect(r.failed).toBe(false);
    expect(r.groups.map((g) => [g.kind, g.hits.length])).toEqual([["claim", 1], ["assumption", 1], ["source", 1], ["note", 1]]);
    const [claim, assumption, source, note] = r.groups.map((g) => g.hits[0]);
    expect(claim.badge).toBe("Geverifieerd");
    expect(assumption.detail).toBe("Belangrijkheid 5 (kritiek)");
    expect(assumption.href).toContain("?select=a1");
    expect(source.detail).toBe("NVM · https://nvm.nl");
    expect(note.title).toBe("Notitie zonder titel");
    expect(note.href).toBe(`/app/ideas/${IDEA}/research`);
  });

  it("zonder tabel step_notes zoekt hij gewoon verder, zonder notities", async () => {
    const { db } = fakeDb({ step_notes: { error: 'relation "public.step_notes" does not exist' }, claims: [{ id: "c1", statement: "nvm", status: "estimate" }] });
    const r = await runDossierSearch(db, IDEA, ["nvm"]);
    expect(r.notesAvailable).toBe(false);
    expect(r.failed).toBe(false);
    expect(r.total).toBe(1);
  });

  it("een storing in een vaste tabel wordt gemeld", async () => {
    const { db } = fakeDb({ claims: { error: "timeout" } });
    const r = await runDossierSearch(db, IDEA, ["nvm"]);
    expect(r.failed).toBe(true);
  });

  it("wat de database (bijv. via een joker) teruggeeft maar de woorden niet bevat, valt af", async () => {
    const { db } = fakeDb({ claims: [{ id: "c1", statement: "iets anders", status: "estimate" }] });
    const r = await runDossierSearch(db, IDEA, ["nvm"]);
    expect(r.total).toBe(0);
  });
});
