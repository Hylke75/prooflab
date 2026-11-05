import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { insertClaimWithQuote } from "@/lib/claim-insert";
import { storeOfficialSource } from "@/lib/official-source";
import { log } from "@/lib/log";
import { CbsError, fetchCbsCell, fetchCbsMetadata, type CbsCell, type CbsMetadata, type JsonFetcher } from "@/lib/integrations/cbs";
import {
  cbsCellLine,
  cbsNumber,
  cbsNumericInput,
  cbsRegionTitle,
  cbsStatement,
  factorUnitFor,
  periodReferenceDate,
  type CbsCellRow,
  type CbsSelection,
} from "@/lib/integrations/cbs-catalog";
import { CLAIM_STATUS, type ClaimStatus } from "@/lib/domain/labels";

// "Haal uit CBS" bij een factor in het marktpotentieel. De server haalt de waarde altijd zelf opnieuw op (wat de
// browser toont, telt niet): bron (officiële statistiek, uitgever CBS, URL naar de tabel), fragment (de letterlijke
// tabelregel), bevinding met citaat via de gewone controleweg (insertClaimWithQuote → checkQuote → recomputeClaim)
// en de koppeling aan de factor (waarde, eenheid, jaar en regio).

export type CbsMetadataView = {
  tableId: string;
  title: string;
  url: string;
  verified: { on: string; how: string } | null;
  measures: { id: string; title: string; unit: string; factorUnit: "count" | "percent" | null }[];
  periods: { id: string; title: string; status: string | null }[];
  dimensions: { id: string; label: string; role: string; default: string; codes: { id: string; title: string; group: string | null }[] }[];
};

export type CbsPreview = {
  line: string | null;
  value: number | null;
  valueText: string | null;
  unit: string;
  factorUnit: "count" | "percent" | null;
  period: { id: string; title: string; status: string | null };
  region: string;
  referenceDate: string;
  missing: string | null;
  url: string;
};

export function cbsErrorText(e: unknown): string {
  if (e instanceof CbsError) {
    if (e.reason === "onbereikbaar") return "CBS is nu niet bereikbaar. Probeer het over een paar minuten opnieuw, of vul de waarde zelf in en koppel een bron onder Bronnen.";
    return e.message;
  }
  return "CBS is nu niet bereikbaar. Probeer het over een paar minuten opnieuw, of vul de waarde zelf in en koppel een bron onder Bronnen.";
}

export function metadataView(meta: CbsMetadata): CbsMetadataView {
  return {
    tableId: meta.table.id,
    title: meta.table.title,
    url: meta.url,
    verified: meta.table.verified,
    measures: meta.measures.map((m) => ({ ...m, factorUnit: factorUnitFor(m.unit) })),
    periods: meta.periods,
    dimensions: meta.dimensions.map((d) => ({ id: d.id, label: d.label, role: d.role, default: d.default, codes: d.codes })),
  };
}

export function previewOf(cell: CbsCell): CbsPreview {
  const row = cell.row;
  return {
    line: row.value == null ? null : cbsCellLine(row as CbsCellRow),
    value: row.value,
    valueText: row.value == null ? null : cbsNumber(row.value),
    unit: row.measure.unit,
    factorUnit: factorUnitFor(row.measure.unit),
    period: row.period,
    region: cbsRegionTitle(cell.table, row),
    referenceDate: periodReferenceDate(row.period.id, cell.table),
    missing: cell.missing,
    url: cell.url,
  };
}

export async function loadCbsMetadata(tableId: string, deps: { fetchJson?: JsonFetcher } = {}): Promise<{ error: string } | { error: null; meta: CbsMetadataView }> {
  try {
    return { error: null, meta: metadataView(await fetchCbsMetadata(tableId, deps)) };
  } catch (e) {
    await log.warn("cbs_metadata_failed", { tableId }, e);
    return { error: cbsErrorText(e) };
  }
}

export async function previewCbsCell(tableId: string, sel: CbsSelection, deps: { fetchJson?: JsonFetcher } = {}): Promise<{ error: string } | { error: null; preview: CbsPreview }> {
  try {
    return { error: null, preview: previewOf(await fetchCbsCell(tableId, sel, deps)) };
  } catch (e) {
    if (!(e instanceof CbsError && e.reason === "ongeldige_keuze")) await log.warn("cbs_cell_failed", { tableId }, e);
    return { error: cbsErrorText(e) };
  }
}

export type SaveCbsResult = { error: string } | { error: null; ok: string; claimId: string; sourceId: string; excerptId: string; status: ClaimStatus | null; reused: boolean };

export async function saveCbsToFactor(
  ideaId: string,
  target: { scenarioId: string; factorKey: string },
  tableId: string,
  sel: CbsSelection,
  deps: { fetchJson?: JsonFetcher } = {},
): Promise<SaveCbsResult> {
  const supabase = await supabaseServer();
  const { data: factor } = await supabase
    .from("sizing_factors")
    .select("id, key, label, unit")
    .eq("idea_id", ideaId)
    .eq("scenario_id", target.scenarioId)
    .eq("key", target.factorKey)
    .maybeSingle();
  if (!factor) return { error: "Deze factor bestaat niet (meer) in dit scenario." };

  let cell: CbsCell;
  try {
    cell = await fetchCbsCell(tableId, sel, deps);
  } catch (e) {
    if (!(e instanceof CbsError && e.reason === "ongeldige_keuze")) await log.warn("cbs_cell_failed", { tableId, ideaId }, e);
    return { error: cbsErrorText(e) };
  }
  if (cell.row.value == null) return { error: `Deze waarde is ${cell.missing ?? "onbekend"}. Kies een andere periode of andere filters; ProofLab vult niets zelf in.` };
  const row = cell.row as CbsCellRow;
  const unit = factorUnitFor(row.measure.unit);
  if (unit !== factor.unit) {
    return { error: `Het onderwerp "${row.measure.title}" is in ${row.measure.unit}; de factor "${factor.label}" vraagt ${factor.unit === "percent" ? "een percentage" : "een aantal"}. Kies een passend onderwerp.` };
  }
  if (unit === "percent" && (row.value < 0 || row.value > 100)) return { error: "Dit percentage ligt buiten 0 tot 100 en past niet in de factor." };

  const line = cbsCellLine(row);
  const { sourceId, excerptIds } = await storeOfficialSource(ideaId, null, {
    url: cell.url,
    title: `CBS StatLine ${cell.table.id}: ${cell.table.title}`,
    publisher: "CBS",
    accessNote: `Opgehaald uit de open data-API van CBS (tabel ${cell.table.id}); elk fragment is een letterlijke tabelregel met de titels zoals CBS ze levert.`,
    location: `Tabel ${cell.table.id}, ${row.period.title}`,
    excerpts: [line],
    origin: "manual",
  });
  const excerptId = excerptIds[0];
  if (!sourceId || !excerptId) return { error: "De CBS-bron kon niet worden opgeslagen. Probeer het opnieuw." };

  const region = cbsRegionTitle(cell.table, row);
  const referenceDate = periodReferenceDate(row.period.id, cell.table);
  const statement = cbsStatement(row);

  // Dezelfde regel twee keer opslaan: de bestaande bevinding bij dit fragment hergebruiken.
  const { data: links } = await supabase.from("claim_sources").select("claim_id").eq("idea_id", ideaId).eq("excerpt_id", excerptId).eq("quote", line);
  const linkedIds = (links ?? []).map((l) => l.claim_id);
  const { data: existing } = linkedIds.length
    ? await supabase.from("claims").select("id, status, numeric_value").in("id", linkedIds).eq("statement", statement).limit(1).maybeSingle()
    : { data: null };

  let claimId: string;
  let status: ClaimStatus | null = null;
  let reused = false;
  if (existing) {
    claimId = existing.id;
    status = existing.status as ClaimStatus;
    reused = true;
  } else {
    if (statement.length > 600 || line.length > 1500) return { error: "Deze tabelregel is te lang om als bevinding vast te leggen. Kies minder specifieke filters." };
    const res = await insertClaimWithQuote(
      ideaId,
      {
        statement,
        quote: line,
        stance: "supports",
        evidence_type: "official_statistic",
        section: "sizing",
        freshness_kind: "statistic",
        population: row.dims.map((d) => d.title).join(", ").slice(0, 200) || "onbekend",
        region,
        reference_date: referenceDate,
        period: row.period.title.slice(0, 60),
        numeric_value: cbsNumericInput(row.value) ?? undefined,
        unit: row.measure.unit.slice(0, 40),
        definition: `CBS-onderwerp "${row.measure.title}" uit tabel ${cell.table.id} (${cell.table.title}).`.slice(0, 400),
        does_not_prove: "Dat deze groep het probleem heeft, klant wil worden of kan betalen: dit is alleen de omvang volgens CBS.",
        limitations: row.period.status && row.period.status !== "definitief" ? `CBS markeert deze periode als ${row.period.status}; het cijfer kan nog wijzigen.` : undefined,
      },
      { id: excerptId, text: line, source_id: sourceId },
    );
    if (res.error !== null) return { error: res.error };
    // Het getal staat letterlijk in de tabelregel; een andere uitkomst betekent dat er iets mis is met de regel.
    if (res.check !== "exact") return { error: "De citaatcontrole vond het getal niet in de tabelregel; er is niets aan de factor gekoppeld." };
    claimId = res.claimId;
    // Een getal dat de invoer niet ondubbelzinnig leest (bijv. 1.234 als decimaal), zetten we zelf; het staat
    // letterlijk in het citaat (dat controleerde checkQuote al).
    if (cbsNumericInput(row.value) == null) await supabase.from("claims").update({ numeric_value: row.value }).eq("id", claimId).eq("idea_id", ideaId);
    const { data: c } = await supabase.from("claims").select("status").eq("id", claimId).maybeSingle();
    status = (c?.status as ClaimStatus | undefined) ?? null;
  }

  const year = /^\d{4}/.test(referenceDate) ? Number(referenceDate.slice(0, 4)) : null;
  const { error } = await supabase
    .from("sizing_factors")
    .update({ value: row.value, claim_id: claimId, year, region: region.slice(0, 120), note: `Uit CBS StatLine ${cell.table.id}, ${row.period.title}.` })
    .eq("id", factor.id)
    .eq("idea_id", ideaId);
  if (error) return { error: "De bron en bevinding zijn opgeslagen, maar de factor kon niet worden bijgewerkt. Kies de bevinding zelf bij de factor." };
  await supabase.from("sizing_scenarios").update({ updated_at: new Date().toISOString() }).eq("id", target.scenarioId).eq("idea_id", ideaId);

  const label = status ? CLAIM_STATUS[status].label.toLowerCase() : "opgeslagen";
  return {
    error: null,
    ok: `${factor.label}: ${row.value.toLocaleString("nl-NL")} ${row.measure.unit} uit CBS ${cell.table.id} (${row.period.title}, ${region}). Bevinding ${reused ? "hergebruikt" : "vastgelegd"}: ${label}.`,
    claimId,
    sourceId,
    excerptId,
    status,
    reused,
  };
}
