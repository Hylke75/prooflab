"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getIdea } from "@/lib/data";
import { loadCbsMetadata, previewCbsCell, saveCbsToFactor, type CbsMetadataView, type CbsPreview } from "@/lib/cbs-factor";
import { cbsTable, isCbsCode, type CbsSelection } from "@/lib/integrations/cbs-catalog";
import { attachRegisterOriginal, importRegisterCsv, linkRegisterToFactor, registerSource } from "@/lib/sector-register-data";
import { REGISTER_MAX_BYTES } from "@/lib/domain/sector-register";
import { checkImportFile, EXTRACT_ERRORS } from "@/lib/domain/report-import";
import { extractReport } from "@/lib/report-extract";
import { fetchPageText, PageFetchError } from "@/lib/fetch-page";

// Nederlandse databronnen in het marktpotentieel (fase 2, punt 6): CBS-waarden aan een factor koppelen. Alles loopt
// met de sessie van de gebruiker (row level security); alleen wie het dossier mag bewerken, haalt op en slaat op.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READ_ONLY = "Je kijkt mee als opdrachtgever: bronnen toevoegen doet het onderzoeksteam.";

async function writable(ideaId: string): Promise<string | null> {
  if (!UUID.test(ideaId)) return "Onbekend idee.";
  const access = await getIdea(ideaId);
  return access.canWrite ? null : READ_ONLY;
}

const code = z.string().refine(isCbsCode, "Ongeldige code.");
const SelectionSchema = z.object({
  measure: code,
  period: z.union([z.literal("latest"), code]),
  filters: z.record(z.string().max(60), code),
});

function parse(tableId: string, sel: unknown): { error: string } | { error: null; tableId: string; sel: CbsSelection } {
  const table = cbsTable(String(tableId ?? ""));
  if (!table) return { error: "Deze CBS-tabel staat niet in de catalogus van ProofLab." };
  const parsed = SelectionSchema.safeParse(sel);
  if (!parsed.success) return { error: "Kies een onderwerp, periode en filters uit de lijsten." };
  return { error: null, tableId: table.id, sel: parsed.data };
}

export async function cbsTableMetadata(ideaId: string, tableId: string): Promise<{ error: string } | { error: null; meta: CbsMetadataView }> {
  const denied = await writable(ideaId);
  if (denied) return { error: denied };
  if (!cbsTable(String(tableId ?? ""))) return { error: "Deze CBS-tabel staat niet in de catalogus van ProofLab." };
  return loadCbsMetadata(tableId);
}

export async function cbsCellPreview(ideaId: string, tableId: string, sel: unknown): Promise<{ error: string } | { error: null; preview: CbsPreview }> {
  const denied = await writable(ideaId);
  if (denied) return { error: denied };
  const p = parse(tableId, sel);
  if (p.error !== null) return { error: p.error };
  return previewCbsCell(p.tableId, p.sel);
}

export async function saveCbsFactor(
  ideaId: string,
  scenarioId: string,
  factorKey: string,
  tableId: string,
  sel: unknown,
): Promise<{ error: string | null; ok?: string | null }> {
  const denied = await writable(ideaId);
  if (denied) return { error: denied };
  if (!UUID.test(scenarioId) || !/^[a-z_]{1,40}$/.test(factorKey)) return { error: "Onbekende factor." };
  const p = parse(tableId, sel);
  if (p.error !== null) return { error: p.error };
  const res = await saveCbsToFactor(ideaId, { scenarioId, factorKey }, p.tableId, p.sel);
  if (res.error !== null) return { error: res.error };
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  return { error: null, ok: res.ok };
}

// ---------------------------------------------------------------------------
// Sectorregisters (CSV): importeren, origineel bijvoegen, aan een factor koppelen
// ---------------------------------------------------------------------------

type FormResult = { error: string | null; ok?: string | null };

export async function importSectorRegister(ideaId: string, _: FormResult, form: FormData): Promise<FormResult> {
  const denied = await writable(ideaId);
  if (denied) return { error: denied };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Kies een CSV-bestand (gebruik het sjabloon)." };
  if (file.size > REGISTER_MAX_BYTES) return { error: "Het bestand is groter dan 1 MB. Splits het register op." };
  if (!/\.(csv|txt|tsv)$/i.test(file.name)) return { error: "Importeer een CSV-bestand (.csv), bijvoorbeeld het ingevulde sjabloon." };
  const res = await importRegisterCsv(ideaId, await file.text(), file.name);
  if (res.error !== null) return { error: res.error };
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  return { error: null, ok: res.ok };
}

export async function attachRegisterFile(ideaId: string, registerSourceId: string, _: FormResult, form: FormData): Promise<FormResult> {
  const denied = await writable(ideaId);
  if (denied) return { error: denied };
  if (!UUID.test(registerSourceId)) return { error: "Onbekend register." };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Kies het originele bestand (PDF, DOCX, TXT, MD of CSV)." };
  const check = checkImportFile({ name: file.name, size: file.size });
  if (!check.ok) return { error: check.error };
  const extracted = await extractReport(new Uint8Array(await file.arrayBuffer()), check.ext);
  if (!extracted.ok) return { error: EXTRACT_ERRORS[extracted.reason] };
  const res = await attachRegisterOriginal(ideaId, registerSourceId, { text: extracted.text, label: file.name.slice(0, 120), kind: "bestand" });
  if (res.error !== null) return { error: res.error };
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  return { error: null, ok: res.ok };
}

export async function fetchRegisterPage(ideaId: string, registerSourceId: string, _: FormResult): Promise<FormResult> {
  const denied = await writable(ideaId);
  if (denied) return { error: denied };
  if (!UUID.test(registerSourceId)) return { error: "Onbekend register." };
  const reg = await registerSource(ideaId, registerSourceId);
  if (!reg?.url) return { error: "Dit register heeft geen bron-URL." };
  let page: { text: string };
  try {
    // SSRF-veilig ophalen (alleen publieke adressen, met time-out en groottegrens).
    page = await fetchPageText(reg.url);
  } catch (e) {
    const why = e instanceof PageFetchError ? e.message : "De pagina kon niet worden opgehaald.";
    return { error: `${why} Voeg het originele bestand anders zelf toe; tot dan blijft het register een schatting.` };
  }
  const res = await attachRegisterOriginal(ideaId, registerSourceId, { text: page.text, label: reg.url, kind: "bronpagina" });
  if (res.error !== null) return { error: res.error };
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  return { error: null, ok: res.ok };
}

export async function linkSectorRegister(ideaId: string, registerSourceId: string, _: FormResult, form: FormData): Promise<FormResult> {
  const denied = await writable(ideaId);
  if (denied) return { error: denied };
  if (!UUID.test(registerSourceId)) return { error: "Onbekend register." };
  const rows = form.getAll("row").map(String).filter((v) => UUID.test(v));
  const [scenarioId, factorKey] = String(form.get("target") ?? "").split(":");
  if (!scenarioId || !UUID.test(scenarioId) || !/^[a-z_]{1,40}$/.test(factorKey ?? "")) return { error: "Kies de factor waaraan je het aantal koppelt." };
  const res = await linkRegisterToFactor(ideaId, registerSourceId, rows, { scenarioId, factorKey });
  if (res.error !== null) return { error: res.error };
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  return { error: null, ok: res.ok };
}
