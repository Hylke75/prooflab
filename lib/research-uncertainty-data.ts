import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { runAi } from "@/lib/ai/guard";
import { proposeUncertaintyFindings } from "@/lib/ai/research";
import { ideaContext } from "@/lib/idea-context";
import { loadRunQuestions } from "@/lib/research-questions-data";
import { MAX_PICKS, rulePicks, uncertaintyCandidates, uncertaintyText, validateAiPicks, type Candidate, type Pick, type UncertaintyEffect } from "@/lib/research-uncertainty";
import type { Idea } from "@/lib/data";
import { log } from "@/lib/log";

// Fase B2, punt 6: de selectie "Wat dit betekent voor je grootste onzekerheid" voorstellen, opslaan en lezen.
// Zonder de B2-migratie (tabel uncertainty_findings) wordt het voorstel alleen in de uitvoer van de runstap
// bewaard en is aanpassen nog niet mogelijk.

type Db = Awaited<ReturnType<typeof supabaseServer>>;

export type StoredPick = Pick & { origin: string };

async function loadCandidates(db: Db, ideaId: string): Promise<Candidate[]> {
  const [{ data: claims }, { data: links }] = await Promise.all([
    db.from("claims").select("id, statement, status, section, question_id").eq("idea_id", ideaId),
    db.from("claim_sources").select("claim_id, stance").eq("idea_id", ideaId),
  ]);
  return (claims ?? []).map((c) => {
    const own = (links ?? []).filter((l) => l.claim_id === c.id);
    return { id: c.id, statement: c.statement, status: c.status, section: c.section, questionId: c.question_id, counter: own.length > 0 && own.every((l) => l.stance === "contradicts") };
  });
}

// Stelt de selectie voor (AI, met de regel als terugval) en slaat hem op. Een selectie van de consultant blijft
// staan als keepConsultant aan staat (een run overschrijft die niet).
export async function proposeUncertainty(
  idea: Idea,
  opts: { keepConsultant: boolean },
): Promise<{ picks: StoredPick[]; origin: "ai" | "rules" | "consultant" | "none"; cost: number; stored: boolean; note: string }> {
  const db = await supabaseServer();
  const existing = await db.from("uncertainty_findings").select("claim_id, effect, reason, rank, origin").eq("idea_id", idea.id).order("rank");
  const stored = !existing.error;
  if (stored && opts.keepConsultant && (existing.data ?? []).some((p) => p.origin === "consultant")) {
    const picks = (existing.data ?? []).map((p) => ({ claimId: p.claim_id, effect: p.effect as UncertaintyEffect, reason: p.reason ?? "", rank: p.rank, origin: p.origin }));
    return { picks, origin: "consultant", cost: 0, stored, note: "De selectie van de consultant blijft staan." };
  }
  const questions = await loadRunQuestions(db, idea.id);
  const decisive = questions.find((q) => q.is_decisive === true) ?? questions[0] ?? null;
  const uncertainty = uncertaintyText(idea.key_uncertainty, decisive?.question);
  const all = await loadCandidates(db, idea.id);
  // De meest relevante kandidaten eerst (regelscore), hooguit 40 naar de AI.
  const ranked = [...uncertaintyCandidates(all)].sort((a, b) => Number(b.questionId === decisive?.id) - Number(a.questionId === decisive?.id) || Number(b.counter) - Number(a.counter));
  const candidates = ranked.slice(0, 40);
  if (!uncertainty || candidates.length === 0) {
    if (stored) await db.from("uncertainty_findings").delete().eq("idea_id", idea.id).neq("origin", "consultant");
    return { picks: [], origin: "none", cost: 0, stored, note: "Nog geen bevindingen met een gecontroleerd citaat om te wegen." };
  }
  let picks: Pick[] = [];
  let origin: "ai" | "rules" = "ai";
  let cost = 0;
  try {
    const refs = new Map(candidates.map((c, i) => [`B${i + 1}`, c.id]));
    const res = await runAi(idea.id, "research:uncertainty", (p) =>
      proposeUncertaintyFindings(
        ideaContext(idea),
        uncertainty,
        candidates.map((c, i) => ({ ref: `B${i + 1}`, statement: c.statement, counter: c.counter, status: c.status })),
        p,
      ),
    );
    cost = res.usage.cost;
    picks = validateAiPicks(res.data.picks, refs);
  } catch (e) {
    await log.warn("research_uncertainty_ai_failed", { ideaId: idea.id }, e);
    origin = "rules";
    picks = rulePicks(candidates, uncertainty, decisive?.id ?? null);
  }
  if (stored) {
    await db.from("uncertainty_findings").delete().eq("idea_id", idea.id);
    if (picks.length) {
      const { error } = await db
        .from("uncertainty_findings")
        .insert(picks.slice(0, MAX_PICKS).map((p) => ({ idea_id: idea.id, claim_id: p.claimId, effect: p.effect, rank: p.rank, reason: p.reason, origin })));
      if (error) await log.warn("research_uncertainty_store_failed", { ideaId: idea.id, code: error.code });
    }
  }
  return { picks: picks.map((p) => ({ ...p, origin })), origin, cost, stored, note: "" };
}

// Wat de kaart toont: de opgeslagen selectie, of (zonder tabel) het voorstel uit de laatste runstap.
export async function loadUncertaintyPicks(db: Db, ideaId: string): Promise<{ picks: StoredPick[]; editable: boolean }> {
  const rows = await db.from("uncertainty_findings").select("claim_id, effect, reason, rank, origin").eq("idea_id", ideaId).order("rank");
  if (!rows.error) {
    return { picks: (rows.data ?? []).map((p) => ({ claimId: p.claim_id, effect: p.effect as UncertaintyEffect, reason: p.reason ?? "", rank: p.rank, origin: p.origin })), editable: true };
  }
  const { data: task } = await db
    .from("research_tasks")
    .select("output")
    .eq("idea_id", ideaId)
    .eq("kind", "uncertainty")
    .eq("status", "done")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const picks = ((task?.output as { picks?: StoredPick[] } | null)?.picks ?? []).filter((p) => p && typeof p.claimId === "string");
  return { picks, editable: false };
}
