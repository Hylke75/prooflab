"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getIdea } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { runCoachReview } from "@/lib/coach/review";
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

export async function resolveCoachNote(ideaId: string, noteId: string, status: "done" | "dismissed"): Promise<{ error: string | null }> {
  if (!UUID.test(ideaId) || !UUID.test(noteId) || !["done", "dismissed"].includes(status)) return { error: "Ongeldige notitie." };
  const { canWrite } = await getIdea(ideaId);
  if (!canWrite) return { error: "Alleen het onderzoeksteam kan notities afronden." };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("coach_notes").update({ status }).eq("id", noteId).eq("idea_id", ideaId).eq("status", "open").select("id");
  if (error || !data?.length) return { error: "De notitie kon niet worden bijgewerkt." };
  revalidatePath(`/app/ideas/${ideaId}`, "layout");
  return { error: null };
}
