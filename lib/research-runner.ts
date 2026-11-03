import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { searchQuestion, extractClaims, challengeDossier, checkSupport, type ExcerptRef, type FoundSource, type IdeaContext, type QueryLog, type SearchFocus } from "@/lib/ai/research";
import { mergeFoundSources } from "@/lib/ai/web-evidence";
import { providersFor } from "@/lib/ai/settings";
import { isProvider, PROVIDER_LABELS, type ProviderId } from "@/lib/ai/providers/config";
import { assertAiBudget, runAi } from "@/lib/ai/guard";
import { log } from "@/lib/log";
import { env } from "@/lib/env";
import { ideaContext } from "@/lib/idea-context";
import { contentHash, recomputeClaim } from "@/lib/claims";
import { aiSourceType, checkQuote, figuresAppearIn, normalizeText, registrableDomain, sourceTypeForDomain } from "@/lib/domain/verify";
import { AiBudgetError, AiRefusedError } from "@/lib/ai/client";
import { RunBudget, withRunBudget } from "@/lib/ai/budget";
import { passagesPerRun, twoZeroRunsInARow } from "@/lib/domain/research-health";
import { CBS_STATLINE_URL, CBS_TABLE, cbsKeywords, cbsLine, fetchCbsCompanyCounts, isSizeQuestion, type JsonFetcher } from "@/lib/integrations/cbs";
import type { Idea } from "@/lib/data";
import type { Json } from "@/lib/database.types";
import { keepAfterSupportCheck, type SupportCheck } from "@/lib/domain/support";
import { groundedScope } from "@/lib/domain/claim-scope";

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
    await alertOnZeroSources(run);
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
  // Every model call of this task reserves its estimated cost against what the run may still spend (lib/ai/budget.ts).
  const runBudget = new RunBudget(budget, Number(run.cost_usd));
  try {
    const result = await withRunBudget(runBudget, () => runTask(next, idea as Idea, run.mode as "quick" | "deep"));
    const detail = runBudget.hit ? `${result.detail} ${runBudget.hit}` : result.detail;
    await supabase.from("research_tasks").update({ status: "done", output: result.output, detail: detail.slice(0, 1000), finished_at: new Date().toISOString() }).eq("id", next.id);
    // What the calls really cost (the tracker sees every call, including refused and stopped ones).
    const cost = Math.max(result.cost, runBudget.spent);
    if (cost > 0) await supabase.rpc("add_research_cost", { p_task: next.id, p_cost: cost });
  } catch (e) {
    const refused = e instanceof AiRefusedError;
    const retry = !refused && !(e instanceof AiBudgetError) && next.attempts + 1 < 3;
    await log.error(
      "research_task_failed",
      { runId, taskId: next.id, kind: next.kind, attempt: next.attempts + 1, willRetry: retry, refused, budget: e instanceof AiBudgetError },
      e,
    );
    // Calls that were made still cost money (a refusal uses tokens too); book them on the run so the budget holds.
    const cost = Math.max(runBudget.spent, refused ? (e.usage?.cost ?? 0) : 0);
    if (cost > 0) await supabase.rpc("add_research_cost", { p_task: next.id, p_cost: cost });
    await supabase
      .from("research_tasks")
      .update({
        status: retry ? "pending" : "failed",
        detail: refused ? "Het model weigerde deze stap." : e instanceof AiBudgetError ? e.message : `Fout: ${e instanceof Error ? e.message.slice(0, 200) : "onbekend"}`,
      })
      .eq("id", next.id);
  }
  // Budget reached: no further task starts; the run records why.
  if (runBudget.hit) {
    await supabase.from("research_tasks").update({ status: "skipped", detail: "Budget van deze run bereikt." }).eq("run_id", runId).eq("status", "pending");
    await supabase.from("research_runs").update({ error: runBudget.hit.slice(0, 500) }).eq("id", runId);
  }
  return state();
}

// Two consecutive finished runs of the same idea without a single kept passage: an incident for operations
// (log.error goes to Sentry when SENTRY_DSN is set). Also counted on the system status page.
async function alertOnZeroSources(run: { id: string; idea_id: string; created_at: string }) {
  const supabase = await supabaseServer();
  const { data: previous } = await supabase
    .from("research_runs")
    .select("id")
    .eq("idea_id", run.idea_id)
    .eq("status", "done")
    .neq("id", run.id)
    .lt("created_at", run.created_at)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ids = [run.id, ...(previous ? [previous.id] : [])];
  const { data: tasks } = await supabase.from("research_tasks").select("run_id, kind, output").in("run_id", ids).eq("kind", "search");
  const counts = passagesPerRun(tasks ?? []);
  if (previous && twoZeroRunsInARow(counts.get(run.id), counts.get(previous.id))) {
    await log.error("research_zero_sources", { ideaId: run.idea_id, runId: run.id, previousRunId: previous.id, searchSteps: (tasks ?? []).filter((t) => t.run_id === run.id).length });
  }
}

type TaskRow = { id: string; kind: string; question_id: string | null; run_id: string; idea_id: string };

async function runTask(task: TaskRow, idea: Idea, mode: "quick" | "deep"): Promise<{ output: Json; detail: string; cost: number }> {
  const supabase = await supabaseServer();
  const ctx = ideaContext(idea);

  if (task.kind === "search") {
    const { data: q } = await supabase.from("research_questions").select("question, expected_source").eq("id", task.question_id!).single();
    const question = q!.question;
    // Questions about market size that expect an official statistic: CBS company counts first (free, verbatim rows).
    const cbs = q!.expected_source === "official_statistic" && isSizeQuestion(question) ? await collectCbsFigures(idea, task.run_id, question) : null;
    const providers = await providersFor(idea.id, "research");
    // The same question for the same idea within 7 days: reuse what was found (and paid for) then.
    const cache = await cachedSearch(idea.id, question, providers);
    const fresh = providers.filter((p) => !cache.providers.has(p));
    let res: Awaited<ReturnType<typeof searchAcrossProviders>> | null = null;
    try {
      res = fresh.length
        ? await searchAcrossProviders(idea.id, "research:search", ctx, question, mode === "quick" ? 3 : 6, { providers: fresh, avoidQueries: cache.recentQueries })
        : null;
    } catch (e) {
      // Without CBS rows a failed web search fails the step (and is retried); with them the step keeps those.
      if (!cbs?.excerptIds.length) throw e;
      await log.warn("research_search_failed_kept_cbs", { taskId: task.id }, e);
    }
    const newIds = res ? await storeFoundSources(idea.id, task.run_id, res.sources) : [];
    const excerptIds = [...new Set([...(cbs?.excerptIds ?? []), ...newIds, ...cache.excerptIds])];
    await writeSearchLog(task, question, [...(cbs ? [cbs.log] : []), ...(res?.logs ?? []), ...cache.logs]);
    const reusedText = cache.providers.size
      ? `Hergebruikt van een zoekopdracht van ${new Date(cache.at!).toLocaleDateString("nl-NL", { timeZone: "Europe/Amsterdam" })} (${[...cache.providers].map((p) => PROVIDER_LABELS[p].short).join(", ")}; niet opnieuw betaald): ${cache.excerptIds.length} passages.`
      : "";
    return {
      output: { excerpt_ids: excerptIds, providers: res?.perProvider ?? [], reused_from: [...cache.taskIds] },
      detail: [
        cbs?.detail ?? "",
        res ? `${res.sources.length} bronnen, ${newIds.length} letterlijke passages bewaard (${res.searches} zoekopdrachten). ${res.summary}` : "",
        reusedText,
      ]
        .filter(Boolean)
        .join(" "),
      cost: res?.cost ?? 0,
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
    const res = await runAi(idea.id, "research:extract", (p) => extractClaims(ctx, q!.question, refs, p));

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

    const stored = await storeExtractedClaims(idea.id, q!.id, byRef, res.data.claims);
    const { rejected, duplicates, unsupported } = stored;
    const kept = stored.claimIds.length;

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
      output: { claims: kept, rejected, duplicates, unsupported, competitors },
      detail: `${kept} bevindingen met gecontroleerd citaat${rejected ? `, ${rejected} afgewezen (citaat niet letterlijk teruggevonden)` : ""}${unsupported ? `, ${unsupported} afgewezen (citaat draagt de bewering niet)` : ""}${duplicates ? `, ${duplicates} al bekend` : ""}${competitors ? `, ${competitors} aanbieders` : ""}.`,
      cost: res.usage.cost + stored.cost,
    };
  }

  if (task.kind === "counter") return runCounterTask(task, idea, mode);

  if (task.kind === "reality_check") {
    const { data: claims } = await supabase.from("claims").select("statement, status").eq("idea_id", idea.id).limit(60);
    const { data: comps } = await supabase.from("competitors").select("name, kind").eq("idea_id", idea.id);
    const summary = [
      "Bevindingen:",
      ...(claims ?? []).map((c) => `- [${c.status}] ${c.statement}`),
      "Aanbieders en alternatieven:",
      ...(comps ?? []).map((c) => `- ${c.name} (${c.kind})`),
    ].join("\n");
    const res = await runAi(idea.id, "research:challenge", (p) => challengeDossier(ctx, summary, p));
    return { output: { challenges: res.data.challenges }, detail: `${res.data.challenges.length} kritische punten gevonden.`, cost: res.usage.cost };
  }

  return { output: {}, detail: "Overgeslagen.", cost: 0 };
}

// ---------------------------------------------------------------------------
// Golf C, punt 10: verplichte zoekopdracht naar tegenbewijs per onderzoeksvraag
// ---------------------------------------------------------------------------

// Een eigen stap per vraag, binnen dezelfde budgetbewaking als de andere stappen (de runner draait elke stap in
// withRunBudget). Zoeken en uitlezen gebruiken het goedkope onderzoeksmodel. De zoektermen komen in
// research_search_log met kind 'counter'; gevonden passages worden fragmenten in de bronnenbibliotheek en elke
// tegenbevinding krijgt een koppeling met relatie 'contradicts', met dezelfde citaat- en steuncontrole als
// gewone bevindingen (storeExtractedClaims). Wat de bronnen niet tegenspreekt, wordt niet bewaard.
async function runCounterTask(task: TaskRow, idea: Idea, mode: "quick" | "deep"): Promise<{ output: Json; detail: string; cost: number }> {
  const supabase = await supabaseServer();
  const ctx = ideaContext(idea);
  const { data: q } = await supabase.from("research_questions").select("id, question").eq("id", task.question_id!).single();
  const question = q!.question;
  const providers = await providersFor(idea.id, "research");
  const cache = await cachedSearch(idea.id, question, providers, "counter");
  const fresh = providers.filter((p) => !cache.providers.has(p));
  const res = fresh.length
    ? await searchAcrossProviders(idea.id, "research:counter", ctx, question, mode === "quick" ? 2 : 4, { providers: fresh, avoidQueries: cache.recentQueries, focus: "counter" })
    : null;
  const newIds = res ? await storeFoundSources(idea.id, task.run_id, res.sources) : [];
  const excerptIds = [...new Set([...newIds, ...cache.excerptIds])];
  await writeSearchLog(task, question, [...(res?.logs ?? []), ...cache.logs], "counter");
  let cost = res?.cost ?? 0;
  const base = { excerpt_ids: excerptIds, providers: res?.perProvider ?? [], reused_from: [...cache.taskIds] };
  if (excerptIds.length === 0) {
    return {
      output: { ...base, claims: 0 },
      detail: "Gezocht naar tegenbewijs; geen bruikbare passage gevonden. Dat bewijst niet dat het antwoord klopt.",
      cost,
    };
  }
  const { data: excerpts } = await supabase.from("source_excerpts").select("id, text, source_id, sources(title, url)").in("id", excerptIds.slice(0, 40));
  const list = excerpts ?? [];
  const refs: ExcerptRef[] = list.map((e, i) => ({ ref: `F${i + 1}`, sourceRef: `B-${e.source_id.slice(0, 8)}`, title: e.sources?.title ?? "", url: e.sources?.url ?? null, text: e.text }));
  const extract = await runAi(idea.id, "research:counter_extract", (p) => extractClaims(ctx, question, refs, p, { focus: "counter" }));
  cost += extract.usage.cost;
  const byRef = new Map(refs.map((r, i) => [r.ref, list[i]]));
  // Alleen tegenbevindingen; een bevestigende bewering uit deze zoekopdracht hoort bij de gewone zoekstap.
  const counter = extract.data.claims.filter((c) => c.stance === "contradicts");
  const skipped = extract.data.claims.length - counter.length;
  const stored = await storeExtractedClaims(idea.id, q!.id, byRef, counter);
  cost += stored.cost;
  const n = stored.claimIds.length;
  return {
    output: { ...base, claims: n, claim_ids: stored.claimIds, rejected: stored.rejected, unsupported: stored.unsupported, duplicates: stored.duplicates, not_counter: skipped },
    detail: [
      res ? `${res.sources.length} bronnen, ${newIds.length} passages bewaard (${res.searches} zoekopdrachten naar tegenbewijs).` : "",
      cache.providers.size ? `${cache.excerptIds.length} passages hergebruikt van een eerdere zoekopdracht naar tegenbewijs.` : "",
      `${n} tegenbevinding${n === 1 ? "" : "en"} met gecontroleerd citaat${[
        stored.rejected ? `, ${stored.rejected} afgewezen (citaat niet letterlijk teruggevonden)` : "",
        stored.unsupported ? `, ${stored.unsupported} afgewezen (citaat draagt de bewering niet)` : "",
        stored.duplicates ? `, ${stored.duplicates} al bekend` : "",
      ].join("")}.`,
    ]
      .filter(Boolean)
      .join(" "),
    cost,
  };
}

// ---------------------------------------------------------------------------
// Web search on every provider the organisation uses for research (also used by the red-team search)
// ---------------------------------------------------------------------------

export type ProviderSearch = { provider: ProviderId; ok: boolean; sources: number; detail: string };

// Each provider searches independently (its own runAi: own ledger row, cap checked per call); the found
// sources are merged by URL. A provider that fails does not stop the others; only when all fail is it an error.
// Which provider found which page is recorded (sources.found_by) as information, never as evidence weight.
export async function searchAcrossProviders(
  ideaId: string,
  purpose: string,
  ctx: IdeaContext,
  question: string,
  maxSearches: number,
  opts: { providers?: ProviderId[]; avoidQueries?: string[]; focus?: SearchFocus } = {},
) {
  const providers = opts.providers ?? (await providersFor(ideaId, "research"));
  const settled = await Promise.allSettled(
    providers.map((provider) =>
      runAi(ideaId, purpose, (p) => searchQuestion(ctx, question, maxSearches, p, { avoidQueries: opts.avoidQueries, focus: opts.focus }), { provider }),
    ),
  );
  let cost = 0;
  let searches = 0;
  const lists: FoundSource[][] = [];
  const perProvider: ProviderSearch[] = [];
  const logs: ProviderLog[] = [];
  settled.forEach((r, i) => {
    const provider = providers[i];
    if (r.status === "fulfilled") {
      cost += r.value.usage.cost;
      searches += r.value.usage.searches;
      lists.push(r.value.sources);
      logs.push({ provider, entries: r.value.log });
      perProvider.push({ provider, ok: true, sources: r.value.sources.length, detail: r.value.detail });
    } else {
      // A refusal still used tokens: book them on the run.
      if (r.reason instanceof AiRefusedError) cost += r.reason.usage?.cost ?? 0;
      perProvider.push({ provider, ok: false, sources: 0, detail: r.reason instanceof AiRefusedError ? "geweigerd" : "mislukt" });
    }
  });
  if (lists.length === 0) {
    const first = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
    throw first?.reason ?? new Error("Zoeken mislukt.");
  }
  const sources = mergeFoundSources(lists);
  const shared = sources.filter((s) => s.foundBy.length > 1).length;
  const summary =
    providers.length > 1
      ? `${perProvider.map((x) => `${PROVIDER_LABELS[x.provider].short}: ${x.detail}`).join("; ")}.${shared ? ` ${shared} ${shared === 1 ? "bron" : "bronnen"} door meer dan één aanbieder gevonden (ter informatie, geen extra bewijs).` : ""}`
      : `${PROVIDER_LABELS[providers[0]].short}: ${perProvider[0].detail}.`;
  return { sources, cost, searches, perProvider, summary, logs };
}

export type ProviderLog = { provider: ProviderId | "prooflab"; entries: QueryLog[]; reused?: boolean };

// ---------------------------------------------------------------------------
// CBS StatLine: officiële bedrijventellingen als bron (geen AI, geen kosten)
// ---------------------------------------------------------------------------

// Haalt het aantal bedrijven per grootteklasse op voor de branches die bij de doelgroep passen, en bewaart elke
// tabelregel letterlijk als fragment van één bron (type officiële statistiek). Returns the excerpt ids and a log
// entry for research_search_log. Errors never break a research step; they are logged.
export async function collectCbsFigures(
  idea: Pick<Idea, "id" | "target_audience" | "audience_detail">,
  runId: string | null,
  question: string | null,
  deps: { fetchJson?: JsonFetcher } = {},
): Promise<{ excerptIds: string[]; log: ProviderLog; detail: string }> {
  const query = `CBS StatLine ${CBS_TABLE}: bedrijven naar bedrijfstak en grootteklasse`;
  try {
    const res = await fetchCbsCompanyCounts({ keywords: cbsKeywords(idea.target_audience, idea.audience_detail, question), fetchJson: deps.fetchJson });
    if (res.rows.length === 0) {
      return {
        excerptIds: [],
        log: { provider: "prooflab", entries: [{ query, passages: 0, urls: [{ url: res.url, title: res.title, status: "geen_relevante_alinea", reason: "CBS gaf geen waarden voor deze branches en periode." }] }] },
        detail: "CBS gaf geen waarden voor deze branches.",
      };
    }
    const excerptIds = await storeOfficialSource(idea.id, runId, {
      url: res.url,
      title: res.title,
      publisher: "CBS",
      accessNote: `Automatisch opgehaald uit de open data-API van CBS (tabel ${res.table}, ${res.period.title}${res.period.status ? `, ${res.period.status}` : ""}); elk fragment is een letterlijke tabelregel.`,
      location: `Tabel ${res.table}, ${res.period.title}`,
      excerpts: res.rows.map(cbsLine),
    });
    return {
      excerptIds,
      log: {
        provider: "prooflab",
        entries: [{ query, passages: excerptIds.length, urls: [{ url: res.url, title: res.title, status: "bewaard", reason: `${res.rows.length} tabelregels (${res.branches.join("; ")}), ${res.period.title}` }] }],
      },
      detail: `CBS: ${res.rows.length} tabelregels over ${res.branches.join("; ")} (${res.period.title}).`,
    };
  } catch (e) {
    await log.warn("cbs_fetch_failed", { ideaId: idea.id }, e);
    return {
      excerptIds: [],
      log: { provider: "prooflab", entries: [{ query, passages: 0, urls: [{ url: CBS_STATLINE_URL, title: CBS_TABLE, status: "geblokkeerd", reason: "CBS open data niet bereikbaar." }] }] },
      detail: "CBS-cijfers konden niet worden opgehaald.",
    };
  }
}

// One source (official statistic) with verbatim excerpts; an existing source with the same URL is reused and only
// new excerpts are added.
async function storeOfficialSource(
  ideaId: string,
  runId: string | null,
  s: { url: string; title: string; publisher: string; accessNote: string; location: string; excerpts: string[] },
): Promise<string[]> {
  const supabase = await supabaseServer();
  const { data: existing } = await supabase.from("sources").select("id").eq("idea_id", ideaId).eq("url", s.url).maybeSingle();
  let sourceId = existing?.id;
  if (!sourceId) {
    const { data: created } = await supabase
      .from("sources")
      .insert({
        idea_id: ideaId,
        run_id: runId,
        url: s.url,
        domain: registrableDomain(s.url),
        title: s.title.slice(0, 300),
        publisher: s.publisher,
        source_type: "official_statistic",
        is_primary: true,
        origin: "ai_search",
        access_note: s.accessNote.slice(0, 500),
        content_hash: contentHash(s.excerpts.join("\n")),
      })
      .select("id")
      .single();
    sourceId = created?.id;
  }
  if (!sourceId) return [];
  const { data: known } = await supabase.from("source_excerpts").select("id, text").eq("source_id", sourceId);
  const byText = new Map((known ?? []).map((k) => [normalizeText(k.text), k.id]));
  const ids: string[] = [];
  for (const text of s.excerpts) {
    const hit = byText.get(normalizeText(text));
    if (hit) {
      ids.push(hit);
      continue;
    }
    const { data: ex } = await supabase.from("source_excerpts").insert({ source_id: sourceId, idea_id: ideaId, text: text.slice(0, 6000), location: s.location }).select("id").single();
    if (ex) {
      ids.push(ex.id);
      byText.set(normalizeText(text), ex.id);
    }
  }
  return ids;
}

const REUSE_DAYS = 7;
const sameQuestion = (a: string | null, b: string) => !!a && normalizeText(a) === normalizeText(b);

// Earlier searches for the same question of this idea within REUSE_DAYS (per provider, the latest one): their
// passages are reused and their log rows copied (marked reused), so the same search is not paid for twice. Also
// returns the other search terms of the last week, which the model is asked not to repeat.
// `kind` houdt gewone zoekopdrachten en zoekopdrachten naar tegenbewijs gescheiden (golf C, punt 10).
export async function cachedSearch(ideaId: string, question: string, providers: ProviderId[], kind: SearchLogKind = "search") {
  const supabase = await supabaseServer();
  const since = new Date(Date.now() - REUSE_DAYS * 24 * 3600 * 1000).toISOString();
  const { data } = await supabase
    .from("research_search_log")
    .select("task_id, provider, query, question, urls, passages, reused, created_at")
    .eq("idea_id", ideaId)
    .eq("kind", kind)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(300);
  const rows = (data ?? []).filter((r) => !r.reused);
  const taskFor = new Map<ProviderId, string>();
  let at: string | null = null;
  for (const r of rows) {
    if (!r.task_id || !sameQuestion(r.question, question) || !isProvider(r.provider) || !providers.includes(r.provider) || taskFor.has(r.provider)) continue;
    taskFor.set(r.provider, r.task_id);
    at ??= r.created_at;
  }
  const taskIds = new Set(taskFor.values());
  let excerptIds: string[] = [];
  if (taskIds.size) {
    const { data: tasks } = await supabase.from("research_tasks").select("id, output").in("id", [...taskIds]);
    const ids = [...new Set((tasks ?? []).flatMap((t) => (t.output as { excerpt_ids?: string[] } | null)?.excerpt_ids ?? []))].slice(0, 60);
    // Passages that were deleted since (with their source) are not reused.
    const { data: still } = ids.length ? await supabase.from("source_excerpts").select("id").in("id", ids) : { data: [] };
    excerptIds = (still ?? []).map((e) => e.id);
  }
  // An earlier search that kept nothing is not reused: searching again is then the only way to find sources.
  const reusedProviders = new Set(excerptIds.length ? taskFor.keys() : []);
  if (!reusedProviders.size) taskIds.clear();
  const logs: ProviderLog[] = [...reusedProviders].map((p) => ({
    provider: p,
    reused: true,
    entries: rows
      .filter((r) => r.provider === p && r.task_id === taskFor.get(p))
      .reverse()
      .map((r) => ({ query: r.query, urls: (Array.isArray(r.urls) ? r.urls : []) as unknown as QueryLog["urls"], passages: r.passages })),
  }));
  const recentQueries = [...new Set(rows.filter((r) => !sameQuestion(r.question, question)).map((r) => r.query))].slice(0, 15);
  return { providers: reusedProviders, taskIds, excerptIds, logs, recentQueries, at };
}

export type SearchLogKind = "search" | "counter";

// One row per search query in research_search_log. A failing insert never fails the research step, but is logged.
async function writeSearchLog(task: TaskRow, question: string, logs: ProviderLog[], kind: SearchLogKind = "search") {
  const rows = logs.flatMap((l) =>
    l.entries.map((e) => ({
      run_id: task.run_id,
      task_id: task.id,
      idea_id: task.idea_id,
      question_id: task.question_id,
      question: question.slice(0, 400),
      provider: l.provider,
      query: e.query.slice(0, 500) || "(geen zoekterm)",
      urls: e.urls as unknown as Json,
      passages: e.passages,
      reused: !!l.reused,
      kind,
    })),
  );
  if (rows.length === 0) return;
  const supabase = await supabaseServer();
  const { error } = await supabase.from("research_search_log").insert(rows);
  if (error) await log.warn("research_search_log_insert_failed", { runId: task.run_id, taskId: task.id, code: error.code });
}

// ---------------------------------------------------------------------------
// Shared storage steps (also used by the red-team search on the assumptions page)
// ---------------------------------------------------------------------------

// Stores found sources and their verbatim passages; a repeated search reuses what is already stored.
export async function storeFoundSources(ideaId: string, runId: string | null, found: FoundSource[]): Promise<string[]> {
  const supabase = await supabaseServer();
  const excerptIds: string[] = [];
  for (const s of found) {
    const domain = registrableDomain(s.url);
    const { data: existing } = await supabase.from("sources").select("id, found_by").eq("idea_id", ideaId).eq("url", s.url).maybeSingle();
    let sourceId = existing?.id;
    // Remember every provider that led to this page (information only).
    const missing = s.foundBy.filter((p) => !(existing?.found_by ?? []).includes(p));
    if (existing && missing.length) {
      await supabase.from("sources").update({ found_by: [...(existing.found_by ?? []), ...missing] }).eq("id", existing.id).eq("origin", "ai_search");
    }
    if (!sourceId) {
      const published = parsePageAge(s.pageAge);
      const { data: created } = await supabase
        .from("sources")
        .insert({
          idea_id: ideaId,
          run_id: runId,
          url: s.url,
          domain,
          title: s.title.slice(0, 300),
          published_on: published,
          source_type: sourceTypeForDomain(domain),
          origin: "ai_search",
          found_by: s.foundBy,
          access_note: "Gevonden via live webzoekopdracht; alleen letterlijke passages van de pagina zijn bewaard.",
          content_hash: contentHash(s.excerpts.join("\n")),
        })
        .select("id")
        .single();
      sourceId = created?.id;
    }
    if (!sourceId) continue;
    const { data: known } = await supabase.from("source_excerpts").select("id, text").eq("source_id", sourceId);
    const byText = new Map((known ?? []).map((k) => [normalizeText(k.text), k.id]));
    for (const raw of s.excerpts) {
      const text = raw.slice(0, 6000);
      const existingId = byText.get(normalizeText(text));
      if (existingId) {
        excerptIds.push(existingId);
        continue;
      }
      const { data: ex } = await supabase.from("source_excerpts").insert({ source_id: sourceId, idea_id: ideaId, text, location: "geciteerde passage" }).select("id").single();
      if (ex) {
        excerptIds.push(ex.id);
        byText.set(normalizeText(text), ex.id);
      }
    }
  }
  return excerptIds;
}

// The independent support check for one quote. A failed or refused check leaves the claim "unchecked"
// (the literal check already passed); its cost is booked either way.
export async function aiSupportCheck(
  ideaId: string,
  statement: string,
  quote: string,
  relation: "supports" | "contradicts" = "supports",
): Promise<{ verdict: SupportCheck; reason: string | null; cost: number }> {
  try {
    const res = await runAi(ideaId, "research:support", (p) => checkSupport(statement, quote, relation, p));
    return { verdict: res.data.verdict, reason: res.data.reason.slice(0, 500), cost: res.usage.cost };
  } catch (e) {
    return { verdict: "unchecked", reason: null, cost: e instanceof AiRefusedError ? (e.usage?.cost ?? 0) : 0 };
  }
}

type ExtractedClaim = Awaited<ReturnType<typeof extractClaims>>["data"]["claims"][number];
type StoredExcerpt = { id: string; text: string; source_id: string };

// Stores extracted claims whose quote is literally in the excerpt (same figures) and that the support
// check does not reject. `stance` overrides the link direction (red team: the quote carries a counter-finding).
export async function storeExtractedClaims(
  ideaId: string,
  questionId: string | null,
  byRef: Map<string, StoredExcerpt>,
  claims: ExtractedClaim[],
  opts: { stance?: "supports" | "contradicts" } = {},
): Promise<{ claimIds: string[]; rejected: number; duplicates: number; unsupported: number; cost: number }> {
  const supabase = await supabaseServer();
  let rejected = 0;
  let duplicates = 0;
  let unsupported = 0;
  let cost = 0;
  const claimIds: string[] = [];
  const { data: knownClaims } = await supabase.from("claims").select("statement").eq("idea_id", ideaId);
  const seenStatements = new Set((knownClaims ?? []).map((c) => normalizeText(c.statement)));
  for (const c of claims) {
    const ex = byRef.get(c.excerpt_ref);
    if (!ex) {
      rejected++;
      continue;
    }
    const stance = opts.stance ?? c.stance;
    const check = checkQuote(c.quote, ex.text, stance === "supports" ? c.statement : undefined);
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
    // Second, independent check: does the literal quote actually carry the statement?
    const support = await aiSupportCheck(ideaId, c.statement, c.quote);
    cost += support.cost;
    if (!keepAfterSupportCheck(support.verdict)) {
      unsupported++;
      continue;
    }
    seenStatements.add(normalizeText(c.statement));
    const { data: claim } = await supabase
      .from("claims")
      .insert({
        idea_id: ideaId,
        question_id: questionId,
        section: c.section,
        statement: c.statement,
        evidence_type: c.evidence_type,
        // Alleen wat uit het citaat of fragment blijkt; anders expliciet "onbekend" (golf C, punt 7).
        population: groundedScope("population", c.population, `${c.quote}\n${ex.text}`),
        region: groundedScope("region", c.region, `${c.quote}\n${ex.text}`),
        reference_date: groundedScope("referenceDate", c.reference_date, `${c.quote}\n${ex.text}`),
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
    await supabase.from("claim_sources").insert({
      claim_id: claim.id,
      idea_id: ideaId,
      source_id: ex.source_id,
      excerpt_id: ex.id,
      quote: c.quote,
      stance,
      quote_check: check,
      support_check: support.verdict,
      ai_support_check: support.verdict === "unchecked" ? null : support.verdict,
      support_checked_by: support.verdict === "unchecked" ? null : "ai",
      support_note: support.reason,
    });
    await recomputeClaim(claim.id);
    claimIds.push(claim.id);
  }
  return { claimIds, rejected, duplicates, unsupported, cost };
}

function parsePageAge(age: string | null): string | null {
  if (!age) return null;
  const d = new Date(age);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
