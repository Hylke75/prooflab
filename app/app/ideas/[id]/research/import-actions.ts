"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/components/ui/ActionForm";
import { getIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { contentHash } from "@/lib/claims";
import { ClaimFieldsSchema, insertClaimWithQuote } from "@/lib/claim-insert";
import { registrableDomain } from "@/lib/domain/verify";
import { BUCKET } from "@/lib/domain/step-files";
import {
  aiWindow,
  blockIndexOf,
  blockRef,
  checkImportFile,
  defaultTitle,
  EXTRACT_ERRORS,
  filterProposals,
  importAccessNote,
  IMPORT_SOURCE_TYPES,
  isImportedReport,
  locateQuote,
  MAX_IMPORT_BYTES,
  parsePublished,
} from "@/lib/domain/report-import";
import { extractReport } from "@/lib/report-extract";
import { aiConfigured } from "@/lib/env";
import { aiErrorMessage, runAi } from "@/lib/ai/guard";
import { ideaContext } from "@/lib/idea-context";
import { proposeReportFindings } from "@/lib/ai/report-findings";
import { log } from "@/lib/log";

// Bestaand onderzoek importeren (stap Markt, tab Bronnen). Alles loopt met de sessie van de gebruiker, dus row level
// security en de storage-policies blijven leidend; de controles hieronder geven daarbovenop een duidelijke melding.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READ_ONLY = "Je kijkt mee als opdrachtgever: onderzoek importeren doet het onderzoeksteam.";
// Hoeveel rapporttekst de AI in één keer leest (ruwweg 15.000 tokens).
const AI_WINDOW_CHARS = 60_000;

async function writable(ideaId: string) {
  if (!UUID.test(ideaId)) return { denied: "Onbekend idee." } as const;
  const access = await getIdea(ideaId);
  return access.canWrite ? ({ denied: null, idea: access.idea } as const) : ({ denied: READ_ONLY } as const);
}

// ---------------------------------------------------------------------------
// 1. Importeren: document uitlezen en als bron met letterlijke blokken opslaan
// ---------------------------------------------------------------------------

const ImportSchema = z.object({
  documentId: z.string().regex(UUID).optional(),
  storagePath: z.string().max(400).optional(),
  title: z.string().trim().max(300).optional(),
  publisher: z.string().trim().max(200).optional(),
  published: z.string().trim().max(40).optional(),
  sourceType: z.enum(IMPORT_SOURCE_TYPES),
  isPrimary: z.boolean().optional(),
  url: z.string().trim().max(2000).optional(),
});
export type ImportInput = z.input<typeof ImportSchema>;

export type ImportResult =
  | { error: string; fieldErrors?: Record<string, string> }
  | { error: null; ok: string; sourceId: string; title: string; blocks: number; pages: number | null };

export async function importReport(ideaId: string, input: ImportInput): Promise<ImportResult> {
  const access = await writable(ideaId);
  if (access.denied) return { error: access.denied };
  const parsed = ImportSchema.safeParse(input);
  if (!parsed.success) return { error: "Controleer de gegevens van het rapport." };
  const v = parsed.data;
  if (!v.documentId && !v.storagePath) return { error: "Kies een document of upload een bestand." };

  const fieldErrors: Record<string, string> = {};
  const published = parsePublished(v.published);
  if (published.error) fieldErrors.published = published.error;
  let url: string | null = null;
  if (v.url) {
    try {
      const u = new URL(v.url);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("protocol");
      url = u.toString();
    } catch {
      fieldErrors.url = "Vul een volledige webadres in (https://…), of laat het veld leeg.";
    }
  }
  if (Object.keys(fieldErrors).length) return { error: "Het rapport is nog niet geïmporteerd.", fieldErrors };

  const supabase = await supabaseServer();
  let query = supabase.from("step_documents").select("id, file_name, size_bytes, storage_path").eq("idea_id", ideaId);
  query = v.documentId ? query.eq("id", v.documentId) : query.eq("storage_path", v.storagePath!);
  const { data: doc, error: docError } = await query.maybeSingle();
  if (docError) return { error: "Documenten zijn nog niet beschikbaar (de database is nog niet bijgewerkt). Voeg het fragment anders handmatig toe als bron." };
  if (!doc) return { error: "Dit document bestaat niet (meer) in dit dossier." };
  const check = checkImportFile({ name: doc.file_name, size: Number(doc.size_bytes) });
  if (!check.ok) return { error: check.error };

  const { data: blob, error: dlError } = await supabase.storage.from(BUCKET).download(doc.storage_path);
  if (dlError || !blob) {
    log.warn("report_import.download_failed", { ideaId, docId: doc.id });
    return { error: "Het bestand kon niet worden geopend. Probeer het opnieuw." };
  }
  if (blob.size > MAX_IMPORT_BYTES) return { error: EXTRACT_ERRORS.too_large };
  const extracted = await extractReport(new Uint8Array(await blob.arrayBuffer()), check.ext);
  if (!extracted.ok) return { error: EXTRACT_ERRORS[extracted.reason] };

  // Hetzelfde rapport twee keer importeren levert geen tweede, onafhankelijke bron op.
  const hash = contentHash(extracted.text);
  const { data: existing } = await supabase.from("sources").select("id, title").eq("idea_id", ideaId).eq("content_hash", hash).limit(1).maybeSingle();
  if (existing) return { error: `Dit rapport staat al bij de bronnen als "${existing.title}". Gebruik die bron.` };

  const title = (v.title || defaultTitle(doc.file_name)).slice(0, 300);
  const { data: source, error } = await supabase
    .from("sources")
    .insert({
      idea_id: ideaId,
      url,
      domain: registrableDomain(url),
      title,
      publisher: v.publisher || null,
      published_on: published.date,
      source_type: v.sourceType,
      is_primary: v.isPrimary === true,
      access_note: importAccessNote({ fileName: doc.file_name, pages: extracted.pages, chars: extracted.text.length, blocks: extracted.blocks.length, precision: published.precision, at: new Date() }),
      origin: "manual",
      content_hash: hash,
    })
    .select("id")
    .single();
  if (error || !source) return { error: "De bron kon niet worden opgeslagen. Probeer het opnieuw." };

  // De blokken in porties; mislukt er één, dan verdwijnt de bron weer (de fragmenten gaan mee).
  for (let i = 0; i < extracted.blocks.length; i += 100) {
    const rows = extracted.blocks.slice(i, i + 100).map((b) => ({ source_id: source.id, idea_id: ideaId, text: b.text, location: b.location }));
    const { error: exError } = await supabase.from("source_excerpts").insert(rows);
    if (exError) {
      await supabase.from("sources").delete().eq("id", source.id).eq("idea_id", ideaId);
      log.warn("report_import.excerpts_failed", { ideaId, code: exError.code });
      return { error: "De tekst van het rapport kon niet worden opgeslagen. Probeer het opnieuw." };
    }
  }
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  const n = extracted.blocks.length;
  return {
    error: null,
    ok: `"${title}" is geïmporteerd als bron: ${extracted.pages ? `${extracted.pages} pagina's, ` : ""}${n} ${n === 1 ? "tekstblok" : "tekstblokken"}. Leg nu bevindingen met een letterlijk citaat vast.`,
    sourceId: source.id,
    title,
    blocks: n,
    pages: extracted.pages,
  };
}

// De blokken van een geïmporteerd rapport, in volgorde (de vindplaats "Rapport, blok N van M" bepaalt de volgorde).
async function reportBlocks(supabase: Awaited<ReturnType<typeof supabaseServer>>, ideaId: string, sourceId: string) {
  const { data: source } = await supabase.from("sources").select("id, title, access_note, source_type").eq("id", sourceId).eq("idea_id", ideaId).maybeSingle();
  if (!source || !isImportedReport(source.access_note)) return null;
  const { data: excerpts } = await supabase.from("source_excerpts").select("id, text, location, source_id").eq("source_id", sourceId).eq("idea_id", ideaId);
  const order = (loc: string | null) => Number(/blok (\d+)/.exec(loc ?? "")?.[1] ?? 1e9);
  const blocks = [...(excerpts ?? [])].sort((a, b) => order(a.location) - order(b.location));
  return { source, blocks };
}

// ---------------------------------------------------------------------------
// 2. Optioneel: de AI stelt bevindingen voor (alleen met letterlijk teruggevonden citaat)
// ---------------------------------------------------------------------------

export type ReportProposalView = {
  key: string;
  quote: string;
  statement: string;
  stance: "supports" | "contradicts";
  questionId: string | null;
  section: string;
  evidenceType: string;
  population: string;
  region: string;
  referenceDate: string;
  numericValue: string;
  unit: string;
  doesNotProve: string;
  freshnessKind: string;
  location: string;
};

export type ProposeResult =
  | { error: string }
  | { error: null; proposals: ReportProposalView[]; read: { from: number; to: number; total: number }; dropped: { notFound: number; numbersMismatch: number } };

export async function proposeFindingsFromReport(ideaId: string, sourceId: string, fromBlock: number): Promise<ProposeResult> {
  const access = await writable(ideaId);
  if (access.denied) return { error: access.denied };
  if (!UUID.test(sourceId)) return { error: "Onbekende bron." };
  if (!aiConfigured()) return { error: "AI is niet verbonden in deze omgeving. Leg de bevindingen zelf vast met een letterlijk citaat." };
  const supabase = await supabaseServer();
  const report = await reportBlocks(supabase, ideaId, sourceId);
  if (!report || report.blocks.length === 0) return { error: "Dit is geen geïmporteerd rapport, of de tekst ontbreekt." };
  const { data: qs } = await supabase.from("research_questions").select("id, position, question").eq("idea_id", ideaId).order("position");
  const questions = (qs ?? []).map((q) => ({ ref: `V${q.position}`, id: q.id, question: q.question }));
  const win = aiWindow(report.blocks, Number.isInteger(fromBlock) ? fromBlock : 0, AI_WINDOW_CHARS);
  if (win.from >= report.blocks.length) return { error: "De AI heeft het hele rapport al gelezen." };
  try {
    const res = await runAi(ideaId, "research:import_findings", (p) =>
      proposeReportFindings(
        ideaContext(access.idea),
        {
          title: report.source.title,
          questions,
          blocks: report.blocks.slice(win.from, win.to).map((b, i) => ({ ref: blockRef(win.from + i), text: b.text, location: b.location ?? "" })),
        },
        p,
      ),
    );
    // Het model mag elk blok noemen; het citaat moet woord voor woord in het rapport staan (alle blokken).
    const filtered = filterProposals(res.data.findings, report.blocks, blockIndexOf);
    const proposals: ReportProposalView[] = filtered.kept.map((p, i) => ({
      key: `${win.from}-${i}`,
      quote: p.quote,
      statement: p.statement.slice(0, 600),
      stance: p.stance,
      questionId: questions.find((q) => q.ref.toLowerCase() === (p.question_ref ?? "").trim().toLowerCase())?.id ?? null,
      section: p.section,
      evidenceType: p.evidence_type,
      population: p.population.slice(0, 200),
      region: p.region.slice(0, 120),
      referenceDate: p.reference_date.slice(0, 40),
      numericValue: p.numeric_value == null ? "" : String(p.numeric_value).replace(".", ","),
      unit: (p.unit ?? "").slice(0, 40),
      doesNotProve: p.does_not_prove.slice(0, 400),
      freshnessKind: p.freshness_kind,
      location: report.blocks[p.blockIndex]?.location ?? "",
    }));
    return { error: null, proposals, read: { from: win.from, to: win.to, total: report.blocks.length }, dropped: { notFound: filtered.notFound, numbersMismatch: filtered.numbersMismatch } };
  } catch (e) {
    return { error: aiErrorMessage(e, "De AI kon het rapport nu niet lezen. Leg de bevindingen zelf vast, of probeer het later opnieuw.") };
  }
}

// ---------------------------------------------------------------------------
// 3. Een bevinding uit het rapport vastleggen (zelf geschreven, of een geaccepteerd AI-voorstel)
// ---------------------------------------------------------------------------

export async function saveReportFinding(ideaId: string, sourceId: string, _: FormState, form: FormData): Promise<FormState> {
  const access = await writable(ideaId);
  if (access.denied) return { error: access.denied };
  if (!UUID.test(sourceId)) return { error: "Onbekende bron." };
  const parsed = ClaimFieldsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue.message, fieldErrors: { [String(issue.path[0] ?? "")]: issue.message } };
  }
  const v = parsed.data;
  const supabase = await supabaseServer();
  const report = await reportBlocks(supabase, ideaId, sourceId);
  if (!report) return { error: "Dit rapport staat niet (meer) bij de bronnen." };
  // ProofLab zoekt zelf het blok waar het citaat in staat; zo kan niemand een citaat aan een verkeerd blok hangen.
  const where = locateQuote(v.quote, report.blocks, v.stance === "supports" ? v.statement : undefined);
  if (where.check === "not_found") {
    return { error: "Dit citaat staat niet letterlijk in het rapport. Kopieer de tekst precies zoals hij in het rapport staat.", fieldErrors: { quote: "Niet letterlijk teruggevonden in het rapport." } };
  }
  if (where.check === "numbers_mismatch") {
    return { error: "De getallen uit je bevinding staan niet in het citaat. Neem de getallen over zoals het rapport ze noemt.", fieldErrors: { statement: "Getallen staan niet in het citaat." } };
  }
  const fromAi = form.get("from_ai") === "1";
  const res = await insertClaimWithQuote(ideaId, v, report.blocks[where.blockIndex], fromAi ? "ai" : "manual");
  if (res.error !== null) return { error: res.error };
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  return { error: null, ok: `Bevinding opgeslagen (${report.blocks[where.blockIndex].location ?? "rapport"}): ${res.reason ?? "status berekend"}` };
}
