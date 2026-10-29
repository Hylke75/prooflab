import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { searchQuestion, extractClaims, challengeDossier, type ExcerptRef } from "@/lib/ai/research";
import { assertAiBudget, runAi } from "@/lib/ai/guard";
import { env } from "@/lib/env";
import { ideaContext } from "@/lib/idea-context";
import { contentHash, recomputeClaim } from "@/lib/claims";
import { aiSourceType, checkQuote, figuresAppearIn, normalizeText, registrableDomain, sourceTypeForDomain } from "@/lib/domain/verify";
import { AiBudgetError, AiRefusedError } from "@/lib/ai/client";
import type { Idea } from "@/lib/data";
import type { Json } from "@/lib/database.types";

type RunState = { status: string; done: number; total: number; current: string | null; cost: number; budget: number; error: string | null };

// Longer than the advance route's maxDuration (300 s), so a task still running is never started twice.
const STALE_MS = 6 * 60 * 1000;

// Executes at most one pending task per call. Each task persists its result before the next
// starts, so a run survives closed browsers, timeouts and retries (idempotent per task).
export async function advanceRun(runId: string): Promise<RunState> {
  const supabase = await supabaseServer();
  const { data: run } = await supabase.from("research_runs").select("*").eq("id", runId).single();
  if (!run) throw new Error("Run niet gevonden");
  const state = async (): Promise<RunState> => {
    const { data: tasks } = await supabase.from("research_tasks").select("status, label").eq("run_id", runId).order("position");
    const { data: r } = await supabase.from("research_runs").select("status, cost_usd, budget_usd, error").eq("id", runId).single();
    const list = tasks ?? [];
    return {
      status: r?.status ?? "failed",
      done: list.filter((t) => ["done", "failed", "skipped"].includes(t.status)).length,
      total: list.length,
      current: list.find((t) => t.status === "running" || t.status === "pending")?.label ?? null,
      cost: Number(r?.cost_usd ?? 0),
      budget: Number(r?.budget_usd ?? 0),
      error: r?.error ?? null,
    };
  };
  if (["done", "failed", "cancelled"].includes(run.status)) return state();

  // Release tasks that were left running by a crashed request.
  const { data: stale } = await supabase.from("research_tasks").select("id, attempts, started_at").eq("run_id", runId).eq("status", "running");
  for (const t of stale ?? []) {
    if (t.started_at && Date.now() - new Date(t.started_at).getTime() > STALE_MS) {
      await supabase.from("research_tasks").update({ status: t.attempts >= 3 ? "failed" : "pending", detail: "Opnieuw geprobeerd na onderbreking." }).eq("id", t.id);
    }
  }
  if ((stale ?? []).some((t) => t.started_at && Date.now() - new Date(t.started_at).getTime() <= STALE_MS)) return state();

  // The run budget is capped by the server setting, whatever is stored on the run.
  const budget = Math.min(Number(run.budget_usd), env.researchBudgetUsd);
  let skipReason: string | null = Number(run.cost_usd) >= budget ? "Budget van deze run bereikt." : null;
  if (!skipReason) {
    try {
      await assertAiBudget(run.idea_id);
    } catch (e) {
      skipReason = e instanceof AiBudgetError ? e.message : "AI-budget kon niet worden gecontroleerd.";
    }
  }
  if (skipReason) {
    await supabase.from("research_tasks").update({ status: "skipped", detail: skipReason }).eq("run_id", runId).eq("status", "pending");
  }
  const { data: next } = await supabase.from("research_tasks").select("*").eq("run_id", runId).eq("status", "pending").order("position").limit(1).maybeSingle();
  // An extraction step only runs once the search for its question has finished.
  if (next?.kind === "extract") {
    const { data: search } = await supabase
      .from("research_tasks")
      .select("status")
      .eq("run_id", runId)
      .eq("kind", "search")
      .eq("question_id", next.question_id!)
      .maybeSingle();
    if (search && !["done", "failed", "skipped"].includes(search.status)) return state();
  }
  if (!next) {
    await supabase.from("research_runs").update({ status: "done", finished_at: new Date().toISOString() }).eq("id", runId);
    return state();
  }
  // Claim the task; a concurrent request that lost the race simply returns the state.
  const { data: claimed } = await supabase
    .from("research_tasks")
    .update({ status: "running", attempts: next.attempts + 1, started_at: new Date().toISOString() })
    .eq("id", next.id)
    .eq("status", "pending")
    .select("id");
  if (!claimed?.length) return state();
  await supabase.from("research_runs").update({ status: "running" }).eq("id", runId);

  const { data: idea } = await supabase.from("ideas").select("*").eq("id", run.idea_id).single();
  try {
    const result = await runTask(next, idea as Idea, run.mode as "quick" | "deep");
    await supabase.from("research_tasks").update({ status: "done", output: result.output, detail: result.detail, finished_at: new Date().toISOString() }).eq("id", next.id);
    if (result.cost > 0) await supabase.rpc("add_research_cost", { p_task: next.id, p_cost: result.cost });
  } catch (e) {
    const refused = e instanceof AiRefusedError;
    const retry = !refused && !(e instanceof AiBudgetError) && next.attempts + 1 < 3;
    // A refusal still used tokens; book them on the run so the budget holds.
    if (refused && e.usage?.cost) await supabase.rpc("add_research_cost", { p_task: next.id, p_cost: e.usage.cost });
    await supabase
      .from("research_tasks")
      .update({
        status: retry ? "pending" : "failed",
        detail: refused ? "Het model weigerde deze stap." : e instanceof AiBudgetError ? e.message : `Fout: ${e instanceof Error ? e.message.slice(0, 200) : "onbekend"}`,
      })
      .eq("id", next.id);
  }
  return state();
}

type TaskRow = { id: string; kind: string; question_id: string | null; run_id: string; idea_id: string };

async function runTask(task: TaskRow, idea: Idea, mode: "quick" | "deep"): Promise<{ output: Json; detail: string; cost: number }> {
  const supabase = await supabaseServer();
  const ctx = ideaContext(idea);

  if (task.kind === "search") {
    const { data: q } = await supabase.from("research_questions").select("question").eq("id", task.question_id!).single();
    const res = await runAi(idea.id, "research:search", () => searchQuestion(ctx, q!.question, mode === "quick" ? 3 : 6));
    const excerptIds: string[] = [];
    for (const s of res.sources) {
      const domain = registrableDomain(s.url);
      const { data: existing } = await supabase.from("sources").select("id").eq("idea_id", idea.id).eq("url", s.url).maybeSingle();
      let sourceId = existing?.id;
      if (!sourceId) {
        const published = parsePageAge(s.pageAge);
        const { data: created } = await supabase
          .from("sources")
          .insert({
            idea_id: idea.id,
            run_id: task.run_id,
            url: s.url,
            domain,
            title: s.title.slice(0, 300),
            published_on: published,
            source_type: sourceTypeForDomain(domain),
            origin: "ai_search",
            access_note: "Gevonden via live webzoekopdracht; alleen geciteerde passages zijn bewaard.",
            content_hash: contentHash(s.excerpts.join("\n")),
          })
          .select("id")
          .single();
        sourceId = created?.id;
      }
      if (!sourceId) continue;
      // A repeated run reuses passages it already stored instead of duplicating them.
      const { data: known } = await supabase.from("source_excerpts").select("id, text").eq("source_id", sourceId);
      const byText = new Map((known ?? []).map((k) => [normalizeText(k.text), k.id]));
      for (const raw of s.excerpts) {
        const text = raw.slice(0, 6000);
        const existingId = byText.get(normalizeText(text));
        if (existingId) {
          excerptIds.push(existingId);
          continue;
        }
        const { data: ex } = await supabase.from("source_excerpts").insert({ source_id: sourceId, idea_id: idea.id, text, location: "geciteerde passage" }).select("id").single();
        if (ex) {
          excerptIds.push(ex.id);
          byText.set(normalizeText(text), ex.id);
        }
      }
    }
    return {
      output: { excerpt_ids: excerptIds },
      detail: `${res.sources.length} bronnen, ${excerptIds.length} letterlijke passages bewaard (${res.usage.searches} zoekopdrachten).`,
      cost: res.usage.cost,
    };
  }

  if (task.kind === "extract") {
    const { data: q } = await supabase.from("research_questions").select("id, question").eq("id", task.question_id!).single();
    const { data: searchTask } = await supabase.from("research_tasks").select("output").eq("run_id", task.run_id).eq("kind", "search").eq("question_id", task.question_id!).single();
    const ids = ((searchTask?.output as { excerpt_ids?: string[] } | null)?.excerpt_ids ?? []).slice(0, 40);
    if (ids.length === 0) return { output: { claims: 0 }, detail: "Geen bruikbare passages gevonden; vraag blijft open.", cost: 0 };
    const { data: excerpts } = await supabase.from("source_excerpts").select("id, text, source_id, sources(title, url)").in("id", ids);
    const refs: ExcerptRef[] = (excerpts ?? []).map((e, i) => ({
      ref: `F${i + 1}`,
      sourceRef: `B-${e.source_id.slice(0, 8)}`,
      title: e.sources?.title ?? "",
      url: e.sources?.url ?? null,
      text: e.text,
    }));
    const res = await runAi(idea.id, "research:extract", () => extractClaims(ctx, q!.question, refs));

    const byRef = new Map(refs.map((r, i) => [r.ref, excerpts![i]]));
    const bySourceRef = new Map(refs.map((r, i) => [r.sourceRef, excerpts![i].source_id]));
    for (const s of res.data.sources) {
      const sourceId = bySourceRef.get(s.source_ref);
      if (!sourceId) continue;
      const allText = (excerpts ?? []).filter((e) => e.source_id === sourceId).map((e) => e.text).join(" ");
      // A publication date is only accepted when its year literally appears in the stored passages.
      const date = s.published_on && /^\d{4}-\d{2}-\d{2}$/.test(s.published_on) && allText.includes(s.published_on.slice(0, 4)) ? s.published_on : null;
      // The model may describe a source, never promote it: official status comes from the domain list
      // and an automatically found page is never marked as a primary document.
      const { data: src } = await supabase.from("sources").select("domain").eq("id", sourceId).single();
      await supabase
        .from("sources")
        .update({ source_type: aiSourceType(src?.domain ?? null, s.source_type), is_primary: false, publisher: s.publisher?.slice(0, 200) ?? null, ...(date ? { published_on: date } : {}) })
        .eq("id", sourceId)
        .eq("origin", "ai_search");
    }

    let kept = 0;
    let rejected = 0;
    let duplicates = 0;
    const { data: knownClaims } = await supabase.from("claims").select("statement").eq("idea_id", idea.id);
    const seenStatements = new Set((knownClaims ?? []).map((c) => normalizeText(c.statement)));
    for (const c of res.data.claims) {
      const ex = byRef.get(c.excerpt_ref);
      if (!ex) {
        rejected++;
        continue;
      }
      const check = checkQuote(c.quote, ex.text, c.stance === "supports" ? c.statement : undefined);
      // Claims whose quote cannot be found verbatim are not stored: an AI paraphrase is not evidence.
      if (check !== "exact") {
        rejected++;
        continue;
      }
      // The same finding from a repeated run is not stored again (it would inflate the evidence count).
      if (seenStatements.has(normalizeText(c.statement))) {
        duplicates++;
        continue;
      }
      seenStatements.add(normalizeText(c.statement));
      const { data: claim } = await supabase
        .from("claims")
        .insert({
          idea_id: idea.id,
          question_id: q!.id,
          section: c.section,
          statement: c.statement,
          evidence_type: c.evidence_type,
          region: c.region,
          period: c.period,
          numeric_value: c.numeric_value,
          unit: c.unit,
          definition: c.definition,
          supports: c.supports,
          does_not_prove: c.does_not_prove,
          limitations: c.limitations,
          freshness_kind: c.freshness_kind,
          origin: "ai",
        })
        .select("id")
        .single();
      if (!claim) continue;
      await supabase.from("claim_sources").insert({ claim_id: claim.id, idea_id: idea.id, source_id: ex.source_id, excerpt_id: ex.id, quote: c.quote, stance: c.stance, quote_check: check });
      await recomputeClaim(claim.id);
      kept++;
    }

    let competitors = 0;
    const { data: knownCompetitors } = await supabase.from("competitors").select("name").eq("idea_id", idea.id);
    const seenNames = new Set((knownCompetitors ?? []).map((c) => normalizeText(c.name)));
    for (const comp of res.data.competitors) {
      const ex = comp.excerpt_ref ? byRef.get(comp.excerpt_ref) : null;
      if (!ex || !comp.quote || checkQuote(comp.quote, ex.text) !== "exact") continue;
      if (seenNames.has(normalizeText(comp.name))) continue;
      seenNames.add(normalizeText(comp.name));
      // A price is only kept when every amount in it literally appears in the verified quote.
      const priceOk = !!comp.visible_price && figuresAppearIn(comp.visible_price, comp.quote);
      await supabase.from("competitors").insert({
        idea_id: idea.id,
        name: comp.name.slice(0, 160),
        website: comp.website,
        kind: comp.kind,
        positioning: comp.positioning,
        pricing_model: comp.pricing_model,
        visible_price: priceOk ? comp.visible_price : null,
        price_checked_on: priceOk ? new Date().toISOString().slice(0, 10) : null,
        origin: "ai",
        last_checked_at: new Date().toISOString(),
      });
      competitors++;
    }
    return {
      output: { claims: kept, rejected, duplicates, competitors },
      detail: `${kept} bevindingen met gecontroleerd citaat${rejected ? `, ${rejected} afgewezen (citaat niet letterlijk teruggevonden)` : ""}${duplicates ? `, ${duplicates} al bekend` : ""}${competitors ? `, ${competitors} aanbieders` : ""}.`,
      cost: res.usage.cost,
    };
  }

  if (task.kind === "reality_check") {
    const { data: claims } = await supabase.from("claims").select("statement, status").eq("idea_id", idea.id).limit(60);
    const { data: comps } = await supabase.from("competitors").select("name, kind").eq("idea_id", idea.id);
    const summary = [
      "Bevindingen:",
      ...(claims ?? []).map((c) => `- [${c.status}] ${c.statement}`),
      "Aanbieders en alternatieven:",
      ...(comps ?? []).map((c) => `- ${c.name} (${c.kind})`),
    ].join("\n");
    const res = await runAi(idea.id, "research:challenge", () => challengeDossier(ctx, summary));
    return { output: { challenges: res.data.challenges }, detail: `${res.data.challenges.length} kritische punten gevonden.`, cost: res.usage.cost };
  }

  return { output: {}, detail: "Overgeslagen.", cost: 0 };
}

function parsePageAge(age: string | null): string | null {
  if (!age) return null;
  const d = new Date(age);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
