import "server-only";
import { fetchPublic } from "@/lib/fetch-page";

// CBS StatLine via de open data-API (OData v4, https://datasets.cbs.nl/odata/v1/CBS/{tabel}).
//
// Tabel 81589NED "Bedrijven; bedrijfstak": het aantal bedrijven naar SBI 2008-bedrijfstak, met de grootteklassen
// (werkzame personen) als onderwerpen en kwartalen als perioden (gecontroleerd op 2026-11-03: perioden tot en met
// 2026 4e kwartaal, gewijzigd per 15 oktober 2026). ProofLab haalt per branche en grootteklasse het aantal bedrijven
// voor de meest recente periode op. Elk fragment is een letterlijke regel uit de dataset (bedrijfstak, grootteklasse,
// periode, waarde en eenheid, met de titels zoals CBS ze levert), zodat de citaatcontrole werkt. Er wordt niets
// geschat of afgeleid. Alleen datasets.cbs.nl wordt opgehaald, via het SSRF-veilige ophalen.

export const CBS_TABLE = "81589NED";
export const CBS_HOST = "datasets.cbs.nl";
export const CBS_BASE = `https://${CBS_HOST}/odata/v1/CBS/${CBS_TABLE}`;
// De tabel in StatLine (voor mensen); dit is de URL van de bron.
export const CBS_STATLINE_URL = `https://opendata.cbs.nl/statline/#/CBS/nl/dataset/${CBS_TABLE}/table`;
export const CBS_TITLE = `CBS StatLine ${CBS_TABLE}: Bedrijven; bedrijfstak`;

const TOTAL_MEASURE = "M000201";
const SIZE_GROUP = "T001098";
const ALL_BRANCHES_PREFIX = /^A-U\b/;

export type JsonFetcher = (url: string) => Promise<unknown>;

// SSRF-veilig, alleen datasets.cbs.nl, JSON tot 5 MB.
export const fetchCbsJson: JsonFetcher = async (url) => {
  const res = await fetchPublic(url, {
    accept: "application/json",
    allowTypes: /application\/json/,
    maxBytes: () => 5_000_000,
    allowHosts: [CBS_HOST],
  });
  if (res.truncated) throw new Error("Antwoord van CBS is te groot.");
  return JSON.parse(res.body.toString("utf8"));
};

type Code = { Identifier: string; Title: string; Status?: string | null; MeasureGroupId?: string | null; Unit?: string | null };
type Observation = { Measure: string; Value: number | null; ValueAttribute?: string | null; BedrijfstakkenBranchesSBI2008: string; Perioden: string };

export type CbsRow = { branch: string; size: string; period: string; status: string | null; value: number; unit: string };
export type CbsResult = { table: string; url: string; title: string; period: { id: string; title: string; status: string | null }; branches: string[]; rows: CbsRow[] };

const list = <T>(json: unknown): T[] => {
  const v = (json as { value?: unknown })?.value;
  return Array.isArray(v) ? (v as T[]) : [];
};

const STATUS: Record<string, string> = { Definitief: "definitief", NaderVoorlopig: "nader voorlopig", Voorlopig: "voorlopig" };

const STOP = new Set(["zijn", "het", "een", "van", "voor", "met", "naar", "hoeveel", "aantal", "nederland", "bedrijven", "bedrijf", "branche", "sector", "regio", "markt", "klanten", "grootte"]);

// Zoekwoorden uit doelgroep, branche en vraag (zonder lidwoorden en algemene woorden).
export function cbsKeywords(...texts: (string | null | undefined)[]): string[] {
  return [
    ...new Set(
      texts
        .join(" ")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^\p{L}\s-]/gu, " ")
        .split(/[\s-]+/)
        .filter((w) => w.length >= 5 && !STOP.has(w)),
    ),
  ];
}

// De SBI-branches waarvan de titel het best bij de zoekwoorden past (hooguit max), plus altijd het totaal van alle
// economische activiteiten als ijkpunt. Zonder overeenkomst alleen het totaal.
export function pickBranches(codes: Code[], keywords: string[], max = 3): Code[] {
  const total = codes.find((c) => ALL_BRANCHES_PREFIX.test(c.Title)) ?? null;
  // De eerste zeven letters: "congresorganisatoren" vindt zo ook "congressen", "evenementenbureaus" "evenementenhallen".
  const stems = [...new Set(keywords.map((k) => k.slice(0, 7)))];
  const scored = codes
    .filter((c) => c !== total)
    .map((c) => {
      const title = c.Title.toLowerCase().normalize("NFKD");
      return { c, score: stems.filter((s) => title.includes(s)).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.c.Title.length - b.c.Title.length)
    .slice(0, max)
    .map((x) => x.c);
  return total ? [...scored, total] : scored;
}

// Eén letterlijke regel uit de dataset, met de titels zoals CBS ze levert.
export function cbsLine(r: CbsRow): string {
  return `Bedrijfstak: ${r.branch}; Bedrijfsgrootte: ${r.size}; Periode: ${r.period}${r.status ? ` (${r.status})` : ""}; Waarde: ${r.value} ${r.unit} (CBS ${CBS_TABLE})`;
}

const odataString = (s: string) => `'${s.replace(/'/g, "''")}'`;

export async function fetchCbsCompanyCounts(opts: { keywords: string[]; fetchJson?: JsonFetcher }): Promise<CbsResult> {
  const get = opts.fetchJson ?? fetchCbsJson;
  const [periods, measures, branchCodes] = await Promise.all([
    get(`${CBS_BASE}/PeriodenCodes`).then((j) => list<Code>(j)),
    get(`${CBS_BASE}/MeasureCodes`).then((j) => list<Code>(j)),
    get(`${CBS_BASE}/BedrijfstakkenBranchesSBI2008Codes?$select=Identifier,Title`).then((j) => list<Code>(j)),
  ]);
  const latest = [...periods].sort((a, b) => (a.Identifier < b.Identifier ? 1 : -1))[0];
  if (!latest) throw new Error("CBS gaf geen perioden terug.");
  const sizeMeasures = measures.filter((m) => m.Identifier === TOTAL_MEASURE || m.MeasureGroupId === SIZE_GROUP);
  const branches = pickBranches(branchCodes, opts.keywords);
  if (branches.length === 0) throw new Error("CBS gaf geen bedrijfstakken terug.");
  const filter = `Perioden eq ${odataString(latest.Identifier)} and (${branches.map((b) => `BedrijfstakkenBranchesSBI2008 eq ${odataString(b.Identifier)}`).join(" or ")})`;
  const obs = list<Observation>(await get(`${CBS_BASE}/Observations?$filter=${encodeURIComponent(filter)}`));
  const measureById = new Map(sizeMeasures.map((m) => [m.Identifier, m]));
  const branchById = new Map(branches.map((b) => [b.Identifier, b]));
  const status = latest.Status ? (STATUS[latest.Status] ?? latest.Status) : null;
  const rows: CbsRow[] = [];
  for (const b of branches) {
    for (const m of sizeMeasures) {
      const o = obs.find((x) => x.BedrijfstakkenBranchesSBI2008 === b.Identifier && x.Measure === m.Identifier && x.Perioden === latest.Identifier);
      // Alleen echte waarden: geheim, niet van toepassing of ontbrekend telt niet.
      if (!o || o.Value == null || !Number.isFinite(o.Value) || (o.ValueAttribute && o.ValueAttribute !== "None")) continue;
      rows.push({ branch: branchById.get(b.Identifier)!.Title, size: measureById.get(m.Identifier)!.Title, period: latest.Title, status, value: o.Value, unit: m.Unit ?? "aantal" });
    }
  }
  return {
    table: CBS_TABLE,
    url: CBS_STATLINE_URL,
    title: CBS_TITLE,
    period: { id: latest.Identifier, title: latest.Title, status },
    branches: branches.map((b) => b.Title),
    rows,
  };
}

// Vragen over marktomvang (aantallen) waarvoor CBS-bedrijventellingen relevant zijn.
export function isSizeQuestion(question: string): boolean {
  return /\b(hoeveel|aantal|omvang|hoe groot|marktgrootte|marktomvang)\b/i.test(question);
}
