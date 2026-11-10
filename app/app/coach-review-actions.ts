"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { loadCoachFacts, runCoachReview } from "@/lib/coach/review";
import { runAutoRecheck } from "@/lib/competitor-recheck";
import { checkNoteDone, type DoneCheck } from "@/lib/coach/rules";
import { log } from "@/lib/log";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Lazy review when a consultant opens an idea page. Returns at once; the review runs after the response,
// so it never slows the page. Throttling and the fingerprint check live in runCoachReview.
export async function autoReview(ideaId: string): Promise<void> {
  if (!UUID.test(ideaId)) return;
  const { canWrite } = await getIdea(ideaId);
  if (!canWrite) return;
  after(async () => {
    try {
      await runCoachReview(ideaId);
    } catch (e) {
      await log.error("coach_review_failed", { ideaId }, e);
    }
    // Automatische maandelijkse concurrentiecontrole: alleen aanbieders die meer dan 30 dagen niet gecontroleerd zijn,
    // hooguit drie per keer. Meestal is er niets aan de beurt en kost dit één query.
    try {
      await runAutoRecheck(ideaId);
    } catch (e) {
      await log.error("auto_recheck_failed", { ideaId }, e);
    }
  });
}

export type ReviewNowState = { message: string | null; error: string | null };

export async function reviewNow(ideaId: string, _: ReviewNowState): Promise<ReviewNowState> {
  if (!UUID.test(ideaId)) return { message: null, error: "Onbekend dossier." };
  const { canWrite } = await getIdea(ideaId);
  if (!canWrite) return { message: null, error: "Alleen het onderzoeksteam kan de coach laten meekijken." };
  try {
    const r = await runCoachReview(ideaId, { force: true });
    if (r.status === "throttled") return { message: null, error: `De coach keek net al mee. Probeer het over ${r.waitSeconds} seconden opnieuw.` };
    revalidatePath(`/app/ideas/${ideaId}`, "layout");
    if (r.status === "unchanged") return { message: "Niets nieuws sinds de vorige keer.", error: null };
    const aiNote =
      r.ai === "limit"
        ? " De AI-coach heeft vandaag al drie keer meegekeken; de vaste regels zijn wel bijgewerkt."
        : r.ai === "failed"
          ? " De AI-coach was niet bereikbaar of het budget is op; de vaste regels zijn wel bijgewerkt."
          : "";
    const parts = [
      r.created ? `${r.created} nieuwe ${r.created === 1 ? "notitie" : "notities"}` : "geen nieuwe notities",
      r.closed ? `${r.closed} afgerond omdat het punt is opgelost` : null,
    ].filter(Boolean);
    return { message: `De coach heeft meegekeken: ${parts.join(", ")}.${aiNote}`, error: null };
  } catch {
    return { message: null, error: "De coach kon nu niet meekijken. Probeer het later opnieuw." };
  }
}

export type ResolveResult = { error: string | null; needsConfirm?: boolean; message?: string };

// "Gedaan" controleert eerst of het werk echt gedaan is (checkNoteDone, per regelcode). Zo niet, dan vraagt de
// coach om bevestiging; na bevestiging sluit de notitie alsnog, en de audit legt vast dat dat zonder data was
// (confirmed_without_data). "Niet relevant" sluit altijd direct.
export async function resolveCoachNote(ideaId: string, noteId: string, status: "done" | "dismissed", confirmed = false): Promise<ResolveResult> {
  if (!UUID.test(ideaId) || !UUID.test(noteId) || !["done", "dismissed"].includes(status)) return { error: "Ongeldige notitie." };
  const { canWrite } = await getIdea(ideaId);
  if (!canWrite) return { error: "Alleen het onderzoeksteam kan notities afronden." };
  const supabase = await supabaseServer();
  let withoutData = false;
  if (status === "done") {
    const { data: note } = await supabase.from("coach_notes").select("code, source, kind").eq("id", noteId).eq("idea_id", ideaId).eq("status", "open").maybeSingle();
    if (!note) return { error: "De notitie kon niet worden bijgewerkt." };
    let check: DoneCheck = { done: true };
    try {
      check = checkNoteDone(note, await loadCoachFacts(ideaId));
    } catch (e) {
      // Kan het dossier niet worden gelezen, dan vragen we de consultant om bevestiging in plaats van te raden.
      await log.warn("coach_done_check_failed", { ideaId }, e);
      check = { done: false, message: "We konden niet controleren of dit al gedaan is." };
    }
    if (!check.done) {
      if (!confirmed) return { error: null, needsConfirm: true, message: check.message };
      withoutData = true;
    }
  }
  const update = withoutData ? { status, confirmed_without_data: true } : { status };
  const { data, error } = await supabase.from("coach_notes").update(update).eq("id", noteId).eq("idea_id", ideaId).eq("status", "open").select("id");
  if (error || !data?.length) return { error: "De notitie kon niet worden bijgewerkt." };
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  return { error: null };
}

// "Was deze tip nuttig?": a consultant's vote on a note, kept next to its status for the learning page. The
// database only lets the status and this vote change on a note.
export async function rateCoachNote(ideaId: string, noteId: string, helpful: boolean): Promise<{ error: string | null }> {
  if (!UUID.test(ideaId) || !UUID.test(noteId) || typeof helpful !== "boolean") return { error: "Ongeldige notitie." };
  const { canWrite } = await getIdea(ideaId);
  if (!canWrite) return { error: "Alleen het onderzoeksteam kan tips beoordelen." };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("coach_notes").update({ helpful }).eq("id", noteId).eq("idea_id", ideaId).select("id");
  if (error || !data?.length) return { error: "Je beoordeling kon niet worden bewaard." };
  return { error: null };
}
