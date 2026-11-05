// Fase 1 · punt 1: de twee standen van een dossier, "Snel" en "Grondig".
//
// De stand is ALLEEN weergave. Hij bepaalt wat er standaard in beeld staat (ingeklapt of verborgen), nooit wat er
// berekend wordt: kansen, statussen, beslisregels, de Stand van het bewijs en het rapport zijn in beide standen
// identiek. Daarom staat dit bestand bewust buiten lib/domain: de rekenmodules mogen de stand niet kunnen lezen
// (tests/unit/view-mode-isolation.test.ts dwingt dat af).
//
// Bewust zonder imports, zodat client- en servercomponenten en de tests dit bestand los kunnen laden.

export type DetailLevel = "quick" | "thorough";

export const DETAIL_LEVELS: Record<DetailLevel, { label: string; explain: string }> = {
  quick: {
    label: "Snel",
    explain: "De kern per stap: details, berekeningen en uitleg staan ingeklapt. De berekening is dezelfde als in Grondig.",
  },
  thorough: {
    label: "Grondig",
    explain: "Alles in beeld: berekeningen, bandbreedtes, auditlijsten en alle uitleg.",
  },
};

export const DETAIL_LEVEL_KEYS = ["quick", "thorough"] as const satisfies readonly DetailLevel[];

// De opgeslagen stand van een dossier. Alles wat niet precies 'quick' is (ook een ontbrekende kolom zolang de
// migratie 20261114090000_fase1_weergave.sql niet is toegepast) geldt als Grondig: dan verandert er niets.
export function asDetailLevel(value: unknown): DetailLevel {
  return value === "quick" ? "quick" : "thorough";
}

// Strenge controle voor invoer (de server action): alleen de twee bekende waarden, anders null.
export function parseDetailLevel(value: unknown): DetailLevel | null {
  return value === "quick" || value === "thorough" ? value : null;
}

// Laat een onderdeel met only="thorough" alleen in Grondig zien; only="quick" alleen in Snel; zonder only altijd.
export function isShown(level: DetailLevel, only?: DetailLevel): boolean {
  return !only || only === level;
}

// Hoeveel items een lijst in Snel laat zien (in Grondig alles). Gebruikt voor "max. 3 kritieke aannames",
// "eerste 3 bevindingen per vraag" en "1 test per aanname".
export function visibleCount(level: DetailLevel, total: number, quickMax: number): number {
  return level === "quick" ? Math.min(total, quickMax) : total;
}

// "Eerste keer per pagina de uitleg, daarna alleen de term": bepaalt welk exemplaar (op volgorde in de pagina) de
// volledige uitleg toont. In Grondig staat de uitleg overal, zoals vóór deze fase.
export function explainShowsText(level: DetailLevel, isFirstOnPage: boolean): boolean {
  return level === "thorough" || isFirstOnPage;
}

// Velden die ProofLab standaard kan invullen, per tabel, met het label voor het auditspoor en de Test Card.
// De app zet alleen deze namen in defaulted_fields; onbekende namen vallen weg.
export const DEFAULTABLE_FIELDS = {
  hypotheses: {
    test_method: "Dat toetsen we door",
    metric_label: "En we meten",
    metric_numerator: "Teller",
    metric_denominator: "Noemer",
    success_threshold_pct: "Succesdrempel",
    fail_threshold_pct: "Faaldrempel",
    min_sample: "Minimale steekproef",
    max_duration_days: "Deadline (looptijd)",
    expected_biases: "Verwachte vertekeningen",
    channels: "Wervingskanalen",
    recruitment_group: "Wervingsgroep",
  },
  assumptions: {
    prior: "Startkans (50%)",
  },
  interviews: {
    recruitment_group: "Wervingsgroep (afgeleid uit het kanaal)",
  },
} as const;

export type DefaultableTable = keyof typeof DEFAULTABLE_FIELDS;

// Alleen bekende veldnamen, elk één keer, in de vaste volgorde van DEFAULTABLE_FIELDS.
export function cleanDefaultedFields(table: DefaultableTable, fields: unknown): string[] {
  const list = Array.isArray(fields) ? fields.filter((f): f is string => typeof f === "string") : [];
  return Object.keys(DEFAULTABLE_FIELDS[table]).filter((k) => list.includes(k));
}

// Leesbare labels voor de weergave ("Minimale steekproef, Wervingskanalen").
export function defaultedLabels(table: DefaultableTable, fields: unknown): string[] {
  const labels = DEFAULTABLE_FIELDS[table] as Record<string, string>;
  return cleanDefaultedFields(table, fields).map((f) => labels[f]);
}
