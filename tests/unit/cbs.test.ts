import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cbsKeywords, cbsLine, CBS_BASE, CBS_STATLINE_URL, fetchCbsCompanyCounts, isSizeQuestion, pickBranches } from "@/lib/integrations/cbs";
import { checkQuote } from "@/lib/domain/verify";
import { fakeSupabase, runnerRpcs } from "./helpers/fake-supabase";
import { msg, r, s, seedRun } from "./helpers/research-fixtures";

// CBS StatLine-koppeling (tabel 81589NED) met een gemockte OData v4-respons: meest recente periode, branches die
// bij de doelgroep passen plus het totaal, waarden per grootteklasse, letterlijke tabelregels als fragment, en de
// automatische aanroep door de runner bij een vraag over marktomvang met verwacht brontype officiële statistiek.

const state = vi.hoisted(() => ({ client: null as unknown, odata: null as null | ((url: string) => unknown) }));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => state.client, supabaseAnon: () => state.client }));
// Het SSRF-veilige ophalen wordt nagebootst: geen netwerk. Andere hosts dan datasets.cbs.nl worden geweigerd.
vi.mock("@/lib/fetch-page", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/fetch-page")>();
  return {
    ...orig,
    fetchPublic: vi.fn(async (url: string, opts: { allowHosts?: readonly string[] }) => {
      if (!opts.allowHosts?.includes(new URL(url).hostname)) throw new orig.PageFetchError("geblokkeerd", "Host niet toegestaan.");
      return { url, contentType: "application/json", body: Buffer.from(JSON.stringify(state.odata!(url))), truncated: false };
    }),
    fetchPageText: vi.fn(async () => Promise.reject(new orig.PageFetchError("geblokkeerd", "Niet bereikbaar."))),
  };
});

const PERIODS = { value: [{ Identifier: "2026KW03", Title: "2026 3e kwartaal", Status: "Voorlopig" }, { Identifier: "2026KW04", Title: "2026 4e kwartaal", Status: "Voorlopig" }, { Identifier: "2025KW04", Title: "2025 4e kwartaal", Status: "NaderVoorlopig" }] };
const MEASURES = {
  value: [
    { Identifier: "M000201", Title: "Totaal bedrijven", Unit: "aantal", MeasureGroupId: null },
    { Identifier: "WP19079", Title: "1 werkzaam persoon", Unit: "aantal", MeasureGroupId: "T001098" },
    { Identifier: "WP19089", Title: "10 tot 20 werkzame personen", Unit: "aantal", MeasureGroupId: "T001098" },
    { Identifier: "A041716", Title: "Natuurlijke personen", Unit: "aantal", MeasureGroupId: "A047595" },
  ],
};
const BRANCHES = {
  value: [
    { Identifier: "T001081", Title: "A-U Alle economische activiteiten" },
    { Identifier: "354600", Title: "8230 Organisatie van congressen, beurzen" },
    { Identifier: "354700", Title: "9004 Theaters en evenementenhallen" },
    { Identifier: "300100", Title: "4711 Supermarkten" },
  ],
};
const obs = (branch: string, measure: string, value: number | null, attr = "None") => ({ Measure: measure, Value: value, ValueAttribute: attr, BedrijfstakkenBranchesSBI2008: branch, Perioden: "2026KW04" });
const OBS = {
  value: [
    obs("354600", "M000201", 4520),
    obs("354600", "WP19079", 3995),
    obs("354600", "WP19089", null, "Confidential"),
    obs("T001081", "M000201", 2450355),
    obs("T001081", "WP19079", 2027790),
    obs("T001081", "WP19089", 31415),
  ],
};

function odata(urls: string[]) {
  return (url: string) => {
    urls.push(url);
    if (!url.startsWith(CBS_BASE)) throw new Error(`onverwachte host: ${url}`);
    if (url.includes("/PeriodenCodes")) return PERIODS;
    if (url.includes("/MeasureCodes")) return MEASURES;
    if (url.includes("/BedrijfstakkenBranchesSBI2008Codes")) return BRANCHES;
    if (url.includes("/Observations")) return OBS;
    throw new Error(`onbekend pad ${url}`);
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("CBS StatLine 81589NED", () => {
  it("haalt per branche en grootteklasse het aantal bedrijven voor de meest recente periode op", async () => {
    const urls: string[] = [];
    const res = await fetchCbsCompanyCounts({ keywords: cbsKeywords("congresorganisatoren en beurzen"), fetchJson: async (u) => odata(urls)(u) });
    expect(res.period).toEqual({ id: "2026KW04", title: "2026 4e kwartaal", status: "voorlopig" });
    expect(res.branches).toEqual(["8230 Organisatie van congressen, beurzen", "A-U Alle economische activiteiten"]);
    expect(res.url).toBe(CBS_STATLINE_URL);
    // Geen waarde voor geheime cellen; geen onderwerpen buiten de grootteklassen (rechtsvorm).
    expect(res.rows).toEqual([
      { branch: "8230 Organisatie van congressen, beurzen", size: "Totaal bedrijven", period: "2026 4e kwartaal", status: "voorlopig", value: 4520, unit: "aantal" },
      { branch: "8230 Organisatie van congressen, beurzen", size: "1 werkzaam persoon", period: "2026 4e kwartaal", status: "voorlopig", value: 3995, unit: "aantal" },
      { branch: "A-U Alle economische activiteiten", size: "Totaal bedrijven", period: "2026 4e kwartaal", status: "voorlopig", value: 2450355, unit: "aantal" },
      { branch: "A-U Alle economische activiteiten", size: "1 werkzaam persoon", period: "2026 4e kwartaal", status: "voorlopig", value: 2027790, unit: "aantal" },
      { branch: "A-U Alle economische activiteiten", size: "10 tot 20 werkzame personen", period: "2026 4e kwartaal", status: "voorlopig", value: 31415, unit: "aantal" },
    ]);
    const filter = decodeURIComponent(urls.find((u) => u.includes("/Observations"))!);
    expect(filter).toContain("Perioden eq '2026KW04'");
    expect(filter).toContain("BedrijfstakkenBranchesSBI2008 eq '354600'");
  });

  it("maakt van een tabelregel een letterlijk fragment waar de citaatcontrole op werkt", () => {
    const line = cbsLine({ branch: "8230 Organisatie van congressen, beurzen", size: "Totaal bedrijven", period: "2026 4e kwartaal", status: "voorlopig", value: 4520, unit: "aantal" });
    expect(line).toBe("Bedrijfstak: 8230 Organisatie van congressen, beurzen; Bedrijfsgrootte: Totaal bedrijven; Periode: 2026 4e kwartaal (voorlopig); Waarde: 4520 aantal (CBS 81589NED)");
    expect(checkQuote("Periode: 2026 4e kwartaal (voorlopig); Waarde: 4520 aantal", line)).toBe("exact");
  });

  it("valt terug op het totaal als geen branche past, en herkent vragen over omvang", () => {
    expect(pickBranches(BRANCHES.value, cbsKeywords("ruimtevaartingenieurs")).map((b) => b.Identifier)).toEqual(["T001081"]);
    expect(isSizeQuestion("Hoeveel evenementenbureaus zijn er in Nederland?")).toBe(true);
    expect(isSizeQuestion("Wat betalen klanten nu?")).toBe(false);
  });

  it("de runner haalt CBS automatisch op bij een omvangvraag met verwacht brontype officiële statistiek", async () => {
    const db = seedRun(["Hoeveel congresorganisatoren zijn er in Nederland?"]);
    db.research_questions[0].expected_source = "official_statistic";
    db.ideas[0].target_audience = "congresorganisatoren";
    state.client = fakeSupabase(db, runnerRpcs);
    const urls: string[] = [];
    state.odata = odata(urls);
    // Claude vindt niets bruikbaars; de CBS-regels blijven staan.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(msg([s("s1", "congresorganisatoren aantal"), r("s1", [])])), { status: 200, headers: { "content-type": "application/json" } })));
    const { advanceRun } = await import("@/lib/research-runner");
    let st = await advanceRun("run-1");
    for (let i = 0; i < 5 && st.status !== "done"; i++) st = await advanceRun("run-1");
    expect(urls.length).toBeGreaterThan(0);
    const src = db.sources.find((x) => x.url === CBS_STATLINE_URL)!;
    expect(src).toMatchObject({ source_type: "official_statistic", publisher: "CBS", domain: "cbs.nl" });
    const excerpts = db.source_excerpts.filter((e) => e.source_id === src.id);
    expect(excerpts).toHaveLength(5);
    expect(excerpts.every((e) => String(e.text).startsWith("Bedrijfstak: "))).toBe(true);
    const task = db.research_tasks[0];
    expect((task.output as { excerpt_ids: string[] }).excerpt_ids).toHaveLength(5);
    expect(String(task.detail)).toContain("CBS: 5 tabelregels");
    expect(db.research_search_log[0]).toMatchObject({ provider: "prooflab", passages: 5 });
  });
});
