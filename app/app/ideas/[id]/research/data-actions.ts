"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getIdea } from "@/lib/data";
import { loadCbsMetadata, previewCbsCell, saveCbsToFactor, type CbsMetadataView, type CbsPreview } from "@/lib/cbs-factor";
import { cbsTable, isCbsCode, type CbsSelection } from "@/lib/integrations/cbs-catalog";

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
