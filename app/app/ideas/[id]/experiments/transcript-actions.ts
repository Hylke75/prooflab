"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWritableIdea } from "@/lib/data";
import { KIND_DEFAULTS } from "@/lib/domain/evidence";
import type { ObservationKind } from "@/lib/domain/labels";
import { checkMarkedQuote, displaySegments, LINK_CHANGES_PROBABILITY, locateQuote, PURGED_TRANSCRIPT, replaceInStored, transcriptChangeAllowed } from "@/lib/domain/quote-marking";
import { countTerm, LABEL_RE, PII_KIND_KEYS, type PiiKind } from "@/lib/domain/pseudonymize";
import { missingImportSchema } from "@/lib/domain/interview-import";
import type { Json } from "@/lib/database.types";
import type { FormState } from "@/components/ui/ActionForm";

// Fase 1 · punt 3: markeren om te citeren op de transcriptpagina. Elke observatie is een letterlijk stuk van het
// opgeslagen (gepseudonimiseerde) transcript, met begin, einde en uitspraak. Koppelen aan een aanname is een
// aparte, expliciete keuze per citaat, en alleen bij een gesprek uit een interviewtest; een verkennend interview
// beslist nooit over een aanname (de database weigert die koppeling ook).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MarkSchema = z.object({
  kind: z.enum(["problem_confirmed", "problem_absent", "current_behaviour", "current_spend", "counter_example", "objection", "opinion", "other"]),
  summary: z.string().trim().max(400).min(5, "Vat de observatie kort samen (minstens 5 tekens)."),
  quote: z.string().trim().max(1500).min(8, "Markeer een citaat van minstens 8 tekens."),
  quote_start: z.coerce.number().int().optional(),
  quote_end: z.coerce.number().int().optional(),
  relation: z.enum(["supports", "contradicts", "neutral"]).default("neutral"),
  assumption_id: z.union([z.string().regex(UUID), z.literal("")]).optional(),
});

const refresh = (ideaId: string) => revalidatePath(`/app/ideas/${ideaId}`, "layout");

async function loadInterview(ideaId: string, interviewId: string) {
  if (!UUID.test(ideaId) || !UUID.test(interviewId)) return null;
  const supabase = await supabaseServer();
  // select("*"): segments bestaat pas na de migratie; zonder kolom valt de pagina terug op regels.
  const { data } = await supabase.from("interviews").select("*").eq("id", interviewId).eq("idea_id", ideaId).maybeSingle();
  return data as (typeof data & { segments?: unknown }) | null;
}

export async function addMarkedObservation(ideaId: string, interviewId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireWritableIdea(ideaId);
  const p = MarkSchema.safeParse(Object.fromEntries(form));
  if (!p.success) {
    const issue = p.error.issues[0];
    return { error: issue.message, fieldErrors: { [String(issue.path[0] ?? "quote")]: issue.message } };
  }
  const v = p.data;
  const iv = await loadInterview(ideaId, interviewId);
  if (!iv) return { error: "Interview niet gevonden." };
  if (iv.transcript === PURGED_TRANSCRIPT) return { error: "Het transcript is verwijderd na afloop van de bewaartermijn." };
  const supabase = await supabaseServer();
  let assumptionId: string | null = null;
  if (iv.experiment_id) {
    const { data: exp } = await supabase.from("experiments").select("state, hypotheses(assumption_id)").eq("id", iv.experiment_id).eq("idea_id", ideaId).maybeSingle();
    if (!exp || !["live", "paused"].includes(exp.state)) return { error: "Citaten markeer je terwijl de interviewronde loopt." };
    assumptionId = v.assumption_id || null;
  } else if (v.assumption_id) {
    return { error: "Een verkennend interview beslist niet over een aanname. Markeer het citaat zonder koppeling, of gebruik een thema." };
  }
  if (v.relation !== "neutral" && !assumptionId) return { error: "Kies de aanname waaraan je dit citaat koppelt, of kies 'neutraal'.", fieldErrors: { assumption_id: "Kies een aanname." } };
  if (assumptionId && v.relation === "neutral") return { error: "Kies of deze uitspraak de aanname bevestigt of weerlegt, of koppel niet.", fieldErrors: { relation: "Kies bevestigt of weerlegt." } };

  // Zonder positie (toetsenbord of plakken): ProofLab zoekt het citaat op; het moet precies één keer voorkomen.
  let start = v.quote_start;
  let end = v.quote_end;
  if (start == null || end == null) {
    const loc = locateQuote(iv.transcript, v.quote);
    if ("error" in loc) return { error: loc.error, fieldErrors: { quote: loc.error } };
    start = loc.start;
    end = loc.end;
  }
  const check = checkMarkedQuote(iv.transcript, start, end, v.quote, displaySegments(iv.transcript, iv.segments));
  if (!check.ok) return { error: check.reason, fieldErrors: { quote: check.reason } };

  const dims = KIND_DEFAULTS[v.kind as ObservationKind];
  const base = {
    idea_id: ideaId,
    experiment_id: iv.experiment_id,
    interview_id: interviewId,
    kind: v.kind,
    summary: v.summary,
    quote: check.quote,
    quote_check: "exact",
    is_fact: dims.isFact,
    is_behaviour: dims.isBehaviour,
    is_real_context: dims.isRealContext,
    is_costly: dims.isCostly,
    origin: "manual",
  };
  const withPos = { ...base, quote_start: start, quote_end: end, segment_index: check.segmentIndex };
  let { data: obs, error } = await supabase.from("observations").insert(withPos).select("id").single();
  // Zonder migratie: zonder positie opslaan (het citaat is wel gecontroleerd).
  if (error && missingImportSchema(error)) ({ data: obs, error } = await supabase.from("observations").insert(base).select("id").single());
  if (error || !obs) return { error: "De observatie kon niet worden opgeslagen. Probeer het opnieuw." };

  // Thema's (handmatig, tellen meteen mee in "X van N", nooit in de kans).
  const codeIds = form.getAll("code_ids").map(String).filter((c) => UUID.test(c)).slice(0, 20);
  if (codeIds.length) {
    await supabase.from("observation_codes").insert(codeIds.map((code_id) => ({ observation_id: obs.id, code_id, idea_id: ideaId, origin: "manual" })));
  }

  let linked = false;
  if (assumptionId && v.relation !== "neutral") {
    const { error: linkError } = await supabase.from("assumption_observations").insert({ assumption_id: assumptionId, observation_id: obs.id, idea_id: ideaId, relation: v.relation });
    if (linkError) {
      refresh(ideaId);
      return { error: null, ok: "Observatie vastgelegd.", warning: "De koppeling aan de aanname is niet gelukt; koppel hem opnieuw of controleer de aanname." };
    }
    linked = true;
  }
  refresh(ideaId);
  return {
    error: null,
    ok: linked
      ? `Observatie vastgelegd en gekoppeld (${v.relation === "supports" ? "steunt" : "spreekt tegen"}). De kans van de aanname is bijgewerkt.`
      : "Observatie vastgelegd, zonder koppeling aan een aanname: de kans verandert niet.",
    warning: linked ? LINK_CHANGES_PROBABILITY : null,
  };
}

// Een gemiste naam alsnog vervangen in het opgeslagen transcript. Alleen zolang er geen enkele observatie aan het
// interview hangt (daarna kloppen citaten en posities niet meer); de database bewaakt hetzelfde.
const ReplaceSchema = z.object({
  term: z.string().trim().min(2, "Typ de naam die nog in de tekst staat.").max(80),
  label: z.string().trim().regex(LABEL_RE, "Een label is 2–40 tekens: letters, cijfers en spaties.").max(40),
  kind: z.enum(PII_KIND_KEYS as [PiiKind, ...PiiKind[]]).default("person"),
});

export async function replaceNameInTranscript(ideaId: string, interviewId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireWritableIdea(ideaId);
  const p = ReplaceSchema.safeParse(Object.fromEntries(form));
  if (!p.success) {
    const issue = p.error.issues[0];
    return { error: issue.message, fieldErrors: { [String(issue.path[0] ?? "term")]: issue.message } };
  }
  const { term, label, kind } = p.data;
  if (countTerm(label.toLowerCase(), term.toLowerCase(), "email") > 0) return { error: "Het label mag de naam zelf niet bevatten.", fieldErrors: { label: "Kies een label zonder de naam." } };
  const iv = await loadInterview(ideaId, interviewId);
  if (!iv) return { error: "Interview niet gevonden." };
  const supabase = await supabaseServer();
  const { count } = await supabase.from("observations").select("id", { count: "exact", head: true }).eq("interview_id", interviewId);
  const allowed = transcriptChangeAllowed(count ?? 0);
  if (!allowed.ok) return { error: allowed.reason };
  const r = replaceInStored(iv.transcript, iv.segments, { term, kind, label, enabled: true });
  if (r.count === 0) return { error: `"${term.slice(0, 40)}" staat niet (als heel woord) in het transcript.`, fieldErrors: { term: "Niet gevonden." } };
  const update: { transcript: string; segments?: Json; pseudonym_labels?: Json } = { transcript: r.transcript };
  if (r.segments) update.segments = r.segments as unknown as Json;
  // De labels met aantallen bijwerken (nooit de originele naam).
  const labels = (iv as { pseudonym_labels?: { labels?: { label: string; kind: string; count: number }[]; declined?: number } | null }).pseudonym_labels;
  if (labels && Array.isArray(labels.labels)) {
    const rest = labels.labels.filter((l) => l.label !== label);
    const prev = labels.labels.find((l) => l.label === label)?.count ?? 0;
    update.pseudonym_labels = { ...labels, labels: [...rest, { label, kind, count: prev + r.count }] } as unknown as Json;
  }
  const { error } = await supabase.from("interviews").update(update).eq("id", interviewId).eq("idea_id", ideaId);
  if (error) return { error: error.message.includes("INTERVIEW_MARKED") ? "Er hangen al citaten aan dit transcript: het verandert niet meer." : "Het transcript kon niet worden bijgewerkt." };
  refresh(ideaId);
  return { error: null, ok: `${r.count}× vervangen door "${label}". De originele naam wordt niet bewaard.` };
}
