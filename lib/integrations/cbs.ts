import "server-only";
import { fetchPublic, PageFetchError } from "@/lib/fetch-page";
import {
  CBS_HOST,
  cbsTable,
  codesUrl,
  isCbsCode,
  missingValueReason,
  observationsUrl,
  odataString,
  PERIOD_STATUS,
  statlineUrl,
  tableApiUrl,
  type CbsCellRow,
  type CbsSelection,
  type CbsTableDef,
} from "@/lib/integrations/cbs-catalog";

// CBS StatLine via de open data-API (OData v4, https://datasets.cbs.nl/odata/v1/CBS/{tabel}).
//
// Generieke client voor de gecureerde tabellen uit lib/integrations/cbs-catalog.ts: metadata (dimensies, codes,
// perioden, onderwerpen) en één waarde met filters. Elke waarde komt terug als letterlijke tabelregel (cbsCellLine)
// met de titels zoals CBS ze levert, zodat de citaatcontrole werkt. Er wordt niets geschat of afgeleid: geen waarde
// is "onbekend". Alleen datasets.cbs.nl wordt opgehaald, via het SSRF-veilige ophalen (time-out 10 s per verzoek,
// één nieuwe poging bij een netwerkfout).
//
// Daarnaast de bestaande automatische stap voor de onderzoeksrunner (tabel 81589NED "Bedrijven; bedrijfstak": per
// passende branche en grootteklasse het aantal bedrijven in de meest recente periode), nu gebouwd op dezelfde client.

export { CBS_HOST };
export const CBS_TABLE = "81589NED";
export const CBS_BASE = tableApiUrl(CBS_TABLE);
export const CBS_STATLINE_URL = statlineUrl(CBS_TABLE);
export const CBS_TITLE = `CBS StatLine ${CBS_TABLE}: Bedrijven; bedrijfstak`;

const TOTAL_MEASURE = "M000201";
const ALL_BRANCHES_PREFIX = /^A-U\b/;

export type JsonFetcher = (url: string) => Promise<unknown>;

export class CbsError extends Error {
  constructor(
    readonly reason: "onbereikbaar" | "onbekende_tabel" | "tabel_gewijzigd" | "ongeldige_keuze",
    message: string,
  ) {
    super(message);
  }
}

// SSRF-veilig, alleen datasets.cbs.nl, JSON tot 5 MB. Bij een netwerkfout of time-out één nieuwe poging.
export const fetchCbsJson: JsonFetcher = async (url) => {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchPublic(url, {
        accept: "application/json",
        allowTypes: /application\/json/,
        maxBytes: () => 5_000_000,
        allowHosts: [CBS_HOST],
      });
      if (res.truncated) throw new CbsError("onbereikbaar", "Antwoord van CBS is te groot.");
      return JSON.parse(res.body.toString("utf8"));
    } catch (e) {
      last = e;
      // Een geweigerde host of een te groot antwoord wordt niet beter van opnieuw proberen.
      if (e instanceof CbsError || (e instanceof PageFetchError && /niet toegestaan/.test(e.message))) break;
    }
  }
  throw last instanceof CbsError ? last : new CbsError("onbereikbaar", "CBS open data is nu niet bereikbaar.");
};

type RawCode = { Identifier: string; Title: string; Status?: string | null; MeasureGroupId?: string | null; Unit?: string | null; DimensionGroupId?: string | null; Decimals?: number | null };
type RawObservation = { Measure: string; Value: number | null; ValueAttribute?: string | null; Perioden: string } & Record<string, unknown>;

const list = <T>(json: unknown): T[] => {
  const v = (json as { value?: unknown })?.value;
  return Array.isArray(v) ? (v as T[]) : [];
};

// ---------------------------------------------------------------------------
// Generieke client
// ---------------------------------------------------------------------------

export type CbsCode = { id: string; title: string; group: string | null };
export type CbsPeriod = { id: string; title: string; status: string | null };
export type CbsMeasure = { id: string; title: string; unit: string };

export type CbsMetadata = {
  table: CbsTableDef;
  url: string;
  measures: CbsMeasure[];
  // Nieuwste periode eerst.
  periods: CbsPeriod[];
  dimensions: { id: string; label: string; role: CbsTableDef["dimensions"][number]["role"]; default: string; codes: CbsCode[] }[];
};

function requireTable(tableId: string): CbsTableDef {
  const table = cbsTable(tableId);
  if (!table) throw new CbsError("onbekende_tabel", "Deze CBS-tabel staat niet in de catalogus van ProofLab.");
  return table;
}

const periodStatus = (s: string | null | undefined) => (s ? (PERIOD_STATUS[s] ?? s) : null);

export async function fetchCbsMetadata(tableId: string, deps: { fetchJson?: JsonFetcher } = {}): Promise<CbsMetadata> {
  const table = requireTable(tableId);
  const get = deps.fetchJson ?? fetchCbsJson;
  const base = tableApiUrl(table.id);
  const [dims, measures, periods, ...codeLists] = await Promise.all([
    get(`${base}/Dimensions`).then((j) => list<{ Identifier: string }>(j)),
    get(`${base}/MeasureCodes`).then((j) => list<RawCode>(j)),
    get(codesUrl(table.id, "Perioden")).then((j) => list<RawCode>(j)),
    ...table.dimensions.map((d) => get(codesUrl(table.id, d.id)).then((j) => list<RawCode>(j))),
  ]);
  // De tabel moet nog dezelfde dimensies hebben als in de catalogus; anders liever een eerlijke melding dan een
  // verkeerd gelezen cel.
  const live = new Set(dims.map((d) => d.Identifier));
  const expected = [...table.dimensions.map((d) => d.id), "Perioden"];
  if (live.size && (expected.some((d) => !live.has(d)) || [...live].some((d) => !expected.includes(d)))) {
    throw new CbsError("tabel_gewijzigd", `CBS heeft tabel ${table.id} gewijzigd (andere indeling). Gebruik de cijfers handmatig of meld het aan de beheerder.`);
  }
  const allowed = measures.filter((m) => table.measures.includes(m.Identifier));
  if (allowed.length === 0) throw new CbsError("tabel_gewijzigd", `CBS gaf voor tabel ${table.id} geen bekende onderwerpen terug.`);
  return {
    table,
    url: statlineUrl(table.id),
    measures: table.measures
      .map((id) => allowed.find((m) => m.Identifier === id))
      .filter((m): m is RawCode => !!m)
      .map((m) => ({ id: m.Identifier, title: m.Title.trim(), unit: (m.Unit ?? "aantal").trim() })),
    periods: [...periods]
      .sort((a, b) => (a.Identifier < b.Identifier ? 1 : -1))
      .map((p) => ({ id: p.Identifier, title: p.Title, status: periodStatus(p.Status) })),
    dimensions: table.dimensions.map((d, i) => ({
      ...d,
      codes: codeLists[i].map((c) => ({ id: c.Identifier, title: c.Title.trim(), group: c.DimensionGroupId ?? null })),
    })),
  };
}

export type CbsCell = {
  table: CbsTableDef;
  url: string;
  apiUrl: string;
  selection: CbsSelection & { period: string };
  // De regel met titels; value is null als CBS geen waarde heeft (dan is er geen fragment).
  row: Omit<CbsCellRow, "value"> & { value: number | null };
  missing: string | null;
};

// Eén waarde: het gekozen onderwerp, één code per dimensie en een periode (of "latest": de meest recente periode
// met een echte waarde). Elke code wordt eerst tegen de metadata van CBS gecontroleerd.
export async function fetchCbsCell(
  tableId: string,
  sel: CbsSelection,
  deps: { fetchJson?: JsonFetcher; metadata?: CbsMetadata } = {},
): Promise<CbsCell> {
  const get = deps.fetchJson ?? fetchCbsJson;
  const meta = deps.metadata ?? (await fetchCbsMetadata(tableId, { fetchJson: get }));
  const table = meta.table;
  const measure = meta.measures.find((m) => m.id === sel.measure);
  if (!measure) throw new CbsError("ongeldige_keuze", "Kies een onderwerp uit de lijst.");
  if (sel.period !== "latest" && !meta.periods.some((p) => p.id === sel.period)) throw new CbsError("ongeldige_keuze", "Kies een periode uit de lijst.");
  const dims = meta.dimensions.map((d) => {
    const code = sel.filters[d.id] ?? d.default;
    const hit = isCbsCode(code) ? d.codes.find((c) => c.id === code) : undefined;
    if (!hit) throw new CbsError("ongeldige_keuze", `Kies een waarde uit de lijst bij "${d.label}".`);
    return { id: d.id, label: d.label, code, title: hit.title };
  });
  const filters = Object.fromEntries(dims.map((d) => [d.id, d.code]));
  const apiUrl = observationsUrl(table, { measure: measure.id, period: sel.period, filters });
  const obs = list<RawObservation>(await get(apiUrl)).filter(
    (o) => o.Measure === measure.id && dims.every((d) => o[d.id] === d.code) && (sel.period === "latest" || o.Perioden === sel.period),
  );
  const real = (o: RawObservation) => o.Value != null && Number.isFinite(o.Value) && (!o.ValueAttribute || o.ValueAttribute === "None");
  const chosen =
    sel.period === "latest"
      ? ([...obs].filter(real).sort((a, b) => (a.Perioden < b.Perioden ? 1 : -1))[0] ?? null)
      : (obs.find((o) => o.Perioden === sel.period) ?? null);
  const periodId = chosen?.Perioden ?? (sel.period === "latest" ? (meta.periods[0]?.id ?? "") : sel.period);
  const period = meta.periods.find((p) => p.id === periodId) ?? { id: periodId, title: periodId, status: null };
  const value = chosen && real(chosen) ? chosen.Value : null;
  return {
    table,
    url: meta.url,
    apiUrl,
    selection: { measure: measure.id, period: period.id, filters },
    row: {
      tableId: table.id,
      tableTitle: table.title,
      dims: dims.map((d) => ({ label: d.label, title: d.title })),
      period,
      measure,
      value,
    },
    missing: value == null ? missingValueReason(chosen?.ValueAttribute ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// Automatische stap van de onderzoeksrunner: bedrijven per branche en grootteklasse (81589NED)
// ---------------------------------------------------------------------------

export type CbsRow = { branch: string; size: string; period: string; status: string | null; value: number; unit: string };
export type CbsResult = { table: string; url: string; title: string; period: { id: string; title: string; status: string | null }; branches: string[]; rows: CbsRow[] };

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
export function pickBranches<C extends { Identifier: string; Title: string }>(codes: C[], keywords: string[], max = 3): C[] {
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

// Eén letterlijke regel uit de dataset, met de titels zoals CBS ze levert. Ongewijzigd ten opzichte van eerdere
// versies, zodat dezelfde regel bij een volgende run hetzelfde fragment hergebruikt.
export function cbsLine(r: CbsRow): string {
  return `Bedrijfstak: ${r.branch}; Bedrijfsgrootte: ${r.size}; Periode: ${r.period}${r.status ? ` (${r.status})` : ""}; Waarde: ${r.value} ${r.unit} (CBS ${CBS_TABLE})`;
}

export async function fetchCbsCompanyCounts(opts: { keywords: string[]; fetchJson?: JsonFetcher }): Promise<CbsResult> {
  const get = opts.fetchJson ?? fetchCbsJson;
  // Dezelfde client als de rest: controleert eerst of de tabel nog de verwachte indeling heeft.
  const meta = await fetchCbsMetadata(CBS_TABLE, { fetchJson: get });
  const latest = meta.periods[0];
  if (!latest) throw new Error("CBS gaf geen perioden terug.");
  // Het totaal en de grootteklassen (werkzame personen); niet de rechtsvormen.
  const sizeMeasures = meta.measures.filter((m) => m.id === TOTAL_MEASURE || m.id.startsWith("WP"));
  const sbi = meta.dimensions[0];
  const branches = pickBranches(sbi.codes.map((c) => ({ Identifier: c.id, Title: c.title })), opts.keywords);
  if (branches.length === 0) throw new Error("CBS gaf geen bedrijfstakken terug.");
  const filter = `Perioden eq ${odataString(latest.id)} and (${branches.map((b) => `${sbi.id} eq ${odataString(b.Identifier)}`).join(" or ")})`;
  const obs = list<RawObservation>(await get(`${CBS_BASE}/Observations?$filter=${encodeURIComponent(filter)}`));
  const rows: CbsRow[] = [];
  for (const b of branches) {
    for (const m of sizeMeasures) {
      const o = obs.find((x) => x[sbi.id] === b.Identifier && x.Measure === m.id && x.Perioden === latest.id);
      // Alleen echte waarden: geheim, niet van toepassing of ontbrekend telt niet.
      if (!o || o.Value == null || !Number.isFinite(o.Value) || (o.ValueAttribute && o.ValueAttribute !== "None")) continue;
      rows.push({ branch: b.Title, size: m.title, period: latest.title, status: latest.status, value: o.Value, unit: m.unit });
    }
  }
  return {
    table: CBS_TABLE,
    url: CBS_STATLINE_URL,
    title: CBS_TITLE,
    period: latest,
    branches: branches.map((b) => b.Title),
    rows,
  };
}

// Vragen over marktomvang (aantallen) waarvoor CBS-bedrijventellingen relevant zijn.
export function isSizeQuestion(question: string): boolean {
  return /\b(hoeveel|aantal|omvang|hoe groot|marktgrootte|marktomvang)\b/i.test(question);
}
