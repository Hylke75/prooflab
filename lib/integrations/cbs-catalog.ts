// CBS StatLine: de vaste, gecureerde catalogus van tabellen die ProofLab kan bevragen, plus de pure regels rond die
// tabellen (URL's bouwen, peildatum uit een periode, eenheden, de letterlijke tabelregel). Bewust zonder imports en
// zonder netwerk, zodat client- en servercode en de tests dit bestand los kunnen laden. Het ophalen staat in
// lib/integrations/cbs.ts (server-only).
//
// Elke tabel, dimensie, code en elk onderwerp hieronder is op 2026-11-05 gecontroleerd tegen de live open data-API
// van CBS (OData v4, https://datasets.cbs.nl/odata/v1/CBS/{tabel}/Dimensions, …/MeasureCodes, …/{dimensie}Codes en
// …/Observations). Een tabel die niet zo is gecontroleerd krijgt verified: null en wordt in de interface als "niet
// geverifieerd" getoond; ProofLab weigert er dan niets op, maar zegt het eerlijk. Verandert CBS een tabel (andere
// dimensies of codes), dan meldt de client dat in plaats van stil verkeerde cijfers te tonen.

export const CBS_HOST = "datasets.cbs.nl";
export const CBS_API = `https://${CBS_HOST}/odata/v1/CBS`;
export const CBS_VERIFIED_ON = "2026-11-05";

export type CbsTopic = "bevolking" | "huishoudens" | "regio" | "bedrijven";

export const CBS_TOPICS: Record<CbsTopic, string> = {
  bevolking: "Bevolking",
  huishoudens: "Huishoudens",
  regio: "Regionale kerncijfers",
  bedrijven: "Bedrijven en vestigingen",
};

export type CbsDimensionDef = {
  // De identifier van de dimensie in de API (bijv. "RegioS", "Geslacht").
  id: string;
  label: string;
  role: "region" | "filter" | "sbi";
  // De code die standaard gekozen is (meestal het totaal).
  default: string;
};

export type CbsTableDef = {
  id: string;
  // De titel zoals CBS hem voert.
  title: string;
  topic: CbsTopic;
  summary: string;
  // Toegestane onderwerpen (MeasureCodes). Alleen onderwerpen met een eenheid die ProofLab kan gebruiken
  // (aantal of procent); bedragen in "1 000 euro" of "x 1 000" zitten er bewust niet in.
  measures: string[];
  defaultMeasure: string;
  // Alle dimensies behalve Perioden, in de volgorde van de tabel.
  dimensions: CbsDimensionDef[];
  periodKind: "jaar" | "kwartaal";
  // "1 januari": het cijfer is een stand op 1 januari van het jaar (peildatum jjjj-01-01). Anders alleen het jaar.
  referenceDay: "1 januari" | null;
  // Wanneer en hoe gecontroleerd; null = niet geverifieerd.
  verified: { on: string; how: string } | null;
};

const LIVE = { on: CBS_VERIFIED_ON, how: "Dimensies, onderwerpen, codes en een voorbeeldwaarde opgehaald uit de live OData v4-API." };

const REGION: CbsDimensionDef = { id: "RegioS", label: "Regio", role: "region", default: "NL01" };
const SBI: CbsDimensionDef = { id: "BedrijfstakkenBranchesSBI2008", label: "Bedrijfstak (SBI 2008)", role: "sbi", default: "T001081" };

export const CBS_CATALOG: CbsTableDef[] = [
  {
    id: "03759ned",
    title: "Bevolking op 1 januari en gemiddeld; geslacht, leeftijd en regio",
    topic: "bevolking",
    summary: "Inwoners per gemeente, COROP-gebied, provincie of heel Nederland, naar geslacht, leeftijd (per jaar) en burgerlijke staat.",
    measures: ["M000352"],
    defaultMeasure: "M000352",
    dimensions: [
      { id: "BurgerlijkeStaat", label: "Burgerlijke staat", role: "filter", default: "T001019" },
      { id: "Geslacht", label: "Geslacht", role: "filter", default: "T001038" },
      { id: "Leeftijd", label: "Leeftijd", role: "filter", default: "10000" },
      REGION,
    ],
    periodKind: "jaar",
    referenceDay: "1 januari",
    verified: LIVE,
  },
  {
    id: "70072ned",
    title: "Regionale kerncijfers Nederland",
    topic: "regio",
    summary: "Kerncijfers per gemeente en provincie: bevolking naar leeftijdsgroep, particuliere huishoudens en bedrijfsvestigingen naar sector.",
    measures: [
      "M000352_3", "3000", "4000",
      "M8413", "M8414", "M8415", "M8416", "M8417", "M8418",
      "TOD275", "TOD276", "TOD277", "TOD278", "TOD253", "TOD279", "TOD280",
      "TOD356", "TOD357", "TOD358", "TOD359", "TOD360", "TOD361", "TOD362", "TOD363", "TOD364",
    ],
    defaultMeasure: "M000352_3",
    dimensions: [REGION],
    periodKind: "jaar",
    referenceDay: null,
    verified: LIVE,
  },
  {
    id: "71486ned",
    title: "Huishoudens; samenstelling, grootte, regio, 1 januari",
    topic: "huishoudens",
    summary: "Particuliere huishoudens per gemeente of provincie naar samenstelling (met of zonder kinderen) en grootte, en naar leeftijd van de referentiepersoon.",
    measures: [
      "1050010_2", "1050015_1", "1016010_2", "1016040", "1016030",
      "1030007_2", "1050100_2", "1050190_2", "1030009",
      "1011450", "1011500", "1011550", "1011600",
    ],
    defaultMeasure: "1050010_2",
    dimensions: [{ id: "LeeftijdReferentiepersoon", label: "Leeftijd referentiepersoon", role: "filter", default: "10000" }, REGION],
    periodKind: "jaar",
    referenceDay: "1 januari",
    verified: LIVE,
  },
  {
    id: "81589NED",
    title: "Bedrijven; bedrijfstak",
    topic: "bedrijven",
    summary: "Aantal bedrijven in heel Nederland per bedrijfstak (SBI 2008, tot vijf cijfers) en grootteklasse (werkzame personen), per kwartaal.",
    measures: [
      "M000201",
      "WP19079", "WP19082", "WP19083", "WP19085", "WP19089", "WP19092", "WP19096", "WP19098", "WP19075", "WP19076",
      "A041716", "A041719",
    ],
    defaultMeasure: "M000201",
    dimensions: [SBI],
    periodKind: "kwartaal",
    referenceDay: null,
    verified: LIVE,
  },
  {
    id: "81578NED",
    title: "Vestigingen van bedrijven; bedrijfstak, regio",
    topic: "bedrijven",
    summary: "Aantal vestigingen per bedrijfstak (SBI 2008, tot vijf cijfers) per provincie, COROP-gebied of grote gemeente.",
    measures: ["M000200"],
    defaultMeasure: "M000200",
    dimensions: [SBI, REGION],
    periodKind: "jaar",
    referenceDay: null,
    verified: LIVE,
  },
  {
    id: "81575NED",
    title: "Vestigingen van bedrijven; bedrijfstak, gemeente",
    topic: "bedrijven",
    summary: "Aantal vestigingen per gemeente, naar hoofdsector (SBI-sectie A tot en met U).",
    measures: ["M000200"],
    defaultMeasure: "M000200",
    dimensions: [SBI, REGION],
    periodKind: "jaar",
    referenceDay: null,
    verified: LIVE,
  },
  {
    id: "81644NED",
    title: "Vestigingen van bedrijven; grootte, rechtsvorm, bedrijfstak, regio",
    topic: "bedrijven",
    summary: "Vestigingen naar grootteklasse (werkzame personen) en rechtsvorm, per hoofdsector (SBI-sectie) en provincie of COROP-gebied.",
    measures: ["M000200", "WP19073", "WP19079", "WP19080", "WP19088", "A028820", "A028836", "A047600", "A047603"],
    defaultMeasure: "M000200",
    dimensions: [SBI, REGION],
    periodKind: "jaar",
    referenceDay: null,
    verified: LIVE,
  },
];

export function cbsTable(id: string): CbsTableDef | null {
  return CBS_CATALOG.find((t) => t.id.toLowerCase() === id.trim().toLowerCase()) ?? null;
}

// De tabel in StatLine (voor mensen); dit is de URL van de bron.
export function statlineUrl(tableId: string): string {
  return `https://opendata.cbs.nl/statline/#/CBS/nl/dataset/${tableId}/table`;
}

export function tableApiUrl(tableId: string): string {
  return `${CBS_API}/${tableId}`;
}

// OData-tekst tussen enkele aanhalingstekens, met verdubbelde aanhalingstekens erin.
export function odataString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

// Codes van CBS zijn korte letters, cijfers, punten, liggende streepjes en underscores. Alles daarbuiten weigeren we
// voordat het in een URL komt.
export function isCbsCode(s: string): boolean {
  return /^[A-Za-z0-9_.-]{1,40}$/.test(s);
}

export type CbsSelection = {
  measure: string;
  // Een periode-code (bijv. "2026JJ00") of "latest": de meest recente periode waarvoor CBS een waarde heeft.
  period: string;
  // Per dimensie (behalve Perioden) één code.
  filters: Record<string, string>;
};

// De Observations-URL voor één onderwerp met één code per dimensie. Met period "latest" zonder periodefilter: dan
// kiest de client de meest recente periode met een echte waarde.
export function observationsUrl(table: CbsTableDef, sel: CbsSelection): string {
  const parts = [`Measure eq ${odataString(sel.measure)}`];
  if (sel.period !== "latest") parts.push(`Perioden eq ${odataString(sel.period)}`);
  for (const d of table.dimensions) parts.push(`${d.id} eq ${odataString(sel.filters[d.id] ?? d.default)}`);
  return `${tableApiUrl(table.id)}/Observations?$filter=${encodeURIComponent(parts.join(" and "))}`;
}

export function codesUrl(tableId: string, dimension: string): string {
  const select = dimension === "Perioden" ? "Identifier,Title,DimensionGroupId,Status" : "Identifier,Title,DimensionGroupId";
  return `${tableApiUrl(tableId)}/${dimension}Codes?$select=${select}`;
}

// Peildatum uit een periode: "2026JJ00" → "2026" (of "2026-01-01" bij een stand op 1 januari), "2026KW04" →
// "2026" (het kwartaal staat in het veld periode). Onbekende vormen → "onbekend".
export function periodReferenceDate(periodId: string, table: Pick<CbsTableDef, "referenceDay">): string {
  const m = /^(\d{4})(JJ00|KW0[1-4]|MM\d\d)$/.exec(periodId);
  if (!m) return "onbekend";
  if (m[2] === "JJ00" && table.referenceDay === "1 januari") return `${m[1]}-01-01`;
  if (m[2].startsWith("MM")) return `${m[1]}-${m[2].slice(2)}`;
  return m[1];
}

export const PERIOD_STATUS: Record<string, string> = { Definitief: "definitief", NaderVoorlopig: "nader voorlopig", Voorlopig: "voorlopig" };

// De eenheid van een CBS-onderwerp als eenheid van een factor in de marktomvang; null als ze niet passen.
export function factorUnitFor(cbsUnit: string | null | undefined): "count" | "percent" | null {
  const u = (cbsUnit ?? "").trim().toLowerCase();
  if (u === "aantal") return "count";
  if (u === "%") return "percent";
  return null;
}

// Wat een ontbrekende waarde betekent, in gewone taal (ValueAttribute van CBS).
export function missingValueReason(attribute: string | null | undefined): string {
  switch (attribute) {
    case "Confidential":
      return "geheim (CBS publiceert deze waarde niet)";
    case "Impossible":
      return "niet beschikbaar voor deze combinatie of periode";
    case "NotAvailable":
    case "Unknown":
      return "onbekend bij CBS";
    default:
      return "onbekend: CBS gaf voor deze combinatie geen waarde";
  }
}

const REGION_GROUPS: Record<string, string> = { NL: "Nederland", LD: "Landsdelen", PV: "Provincies", CR: "COROP-gebieden", GM: "Gemeenten" };

export function regionGroupLabel(code: string): string {
  return REGION_GROUPS[code.slice(0, 2)] ?? "Overige indelingen";
}

export type CbsCellRow = {
  tableId: string;
  tableTitle: string;
  // Per dimensie de titel van de gekozen code, zoals CBS hem levert.
  dims: { label: string; title: string }[];
  period: { id: string; title: string; status: string | null };
  measure: { id: string; title: string; unit: string };
  value: number;
};

// CBS levert getallen als JSON-getal; schrijf ze zonder duizendtallen, met een punt als decimaalteken alleen als er
// decimalen zijn. Zo leest de citaatcontrole precies dit getal terug.
export function cbsNumber(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(6)));
}

// Eén letterlijke regel uit de tabel: elke dimensie met de titel zoals CBS die levert, de periode (met status),
// het onderwerp, de waarde en de eenheid. Dit wordt het fragment van de bron; het getal staat er letterlijk in.
export function cbsCellLine(r: CbsCellRow): string {
  const dims = r.dims.map((d) => `${d.label}: ${d.title}`).join("; ");
  return `CBS ${r.tableId} (${r.tableTitle}); ${dims}; Periode: ${r.period.title}${r.period.status ? ` (${r.period.status})` : ""}; Onderwerp: ${r.measure.title}; Waarde: ${cbsNumber(r.value)} ${r.measure.unit}`;
}

// Het getal voor het invoerveld van een bevinding, of null als ProofLab het niet ondubbelzinnig terugleest: "1.234"
// leest ProofLab (zoals in Nederlandse tekst) als duizendtal. In dat geval zet de aanroeper het getal zelf.
export function cbsNumericInput(v: number): string | null {
  const s = cbsNumber(v);
  if (/^\d+$/.test(s)) return s;
  // Eén decimale lezing: niet precies drie cijfers achter de punt.
  return /\.\d{3}$/.test(s) ? null : s;
}

// De regio van een cel (de titel bij de regiodimensie, zonder het achtervoegsel "(PV)" e.d.), of "Nederland" voor
// een tabel zonder regiodimensie (bijv. 81589NED is landelijk).
export function cbsRegionTitle(table: Pick<CbsTableDef, "dimensions">, row: Pick<CbsCellRow, "dims">): string {
  const i = table.dimensions.findIndex((d) => d.role === "region");
  if (i < 0) return "Nederland";
  return (row.dims[i]?.title ?? "onbekend").replace(/\s*\((PV|CR|LD|GM)\)$/, "");
}

// De bevinding bij een cel: alleen onderdelen uit de letterlijke regel, zodat elk getal erin ook in het citaat
// staat (de citaatcontrole eist dat). Bijv. "CBS 03759ned: Bevolking op 1 januari (…; Regio: Amsterdam), periode
// 2026: 941927 aantal."
export function cbsStatement(row: CbsCellRow): string {
  const dims = row.dims.map((d) => `${d.label}: ${d.title}`).join("; ");
  return `CBS ${row.tableId}: ${row.measure.title} (${dims}), periode ${row.period.title}: ${cbsNumber(row.value)} ${row.measure.unit}.`;
}
