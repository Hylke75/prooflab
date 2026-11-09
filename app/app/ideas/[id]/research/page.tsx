import { describeDraftEdit, draftEdit, questionDraftText } from "@/lib/domain/ai-draft";
import type { Metadata } from "next";
import Link from "next/link";
import { plural } from "@/lib/text";
import { PageFrame } from "@/components/shell/PageFrame";
import { InsightCard, type ClaimView } from "@/components/ui/InsightCard";
import { Term } from "@/components/ui/Term";
import { ActionForm } from "@/components/ui/ActionForm";
import { Tabs } from "@/components/research/Tabs";
import { ideaTasks } from "@/lib/domain/tasks";
import { loadProgress } from "@/lib/progress";
import { TaskFooter, TaskHeader } from "@/components/tasks/TaskHeader";
import { TabJumpLink } from "@/components/research/TabJumpLink";
import { ResearchRunPanel, SearchLogList, type QuestionLog, type SearchLogUrl } from "@/components/research/ResearchRunPanel";
import { EXPECTED_SOURCES, isExpectedSource } from "@/lib/domain/research-plan";
import { AddClaimForm, AddSourceForm } from "@/components/research/SourceForms";
import { ReportImport, type ImportableDoc, type ImportedReport } from "@/components/research/ReportImport";
import { importExt, isImportedReport } from "@/lib/domain/report-import";
import { isNoteStep } from "@/lib/domain/step-files";
import { CompetitorPanel, type CompetitorView } from "@/components/research/CompetitorPanel";
import { isProposal, withoutProposals } from "@/lib/domain/competitor-proposals";
import { SizingPanel } from "@/components/research/SizingPanel";
import { attachRegisterFile, cbsCellPreview, cbsTableMetadata, fetchRegisterPage, importSectorRegister, linkSectorRegister, saveCbsFactor } from "./data-actions";
import { SupportControls } from "@/components/research/SupportControls";
import { AiQualityCard } from "@/components/research/AiQualityCard";
import { CustomerSignals, type SignalView } from "@/components/research/CustomerSignals";
import { loadAiQuality } from "@/lib/ai-quality";
import { isSignalSource, parseSignalQuotes, type SignalKind } from "@/lib/domain/customer-signals";
import { SUPPORT_LABEL, isSupportCheck, type SupportCheck } from "@/lib/domain/support";
import { UnitEconomicsPanel } from "@/components/research/UnitEconomicsPanel";
import { getIdea, getViewMode, getWorkspace } from "@/lib/data";
import { Detail } from "@/components/shell/ViewMode";
import { supabaseServer } from "@/lib/supabase/server";
import { aiConfigured, configuredProviders, env } from "@/lib/env";
import { isProvider, modelFor, PROVIDER_KEY_ENV, PROVIDER_LABELS, PROVIDERS, providerLabel } from "@/lib/ai/providers/config";
import { estimateRun, estimateText, planSteps, runBudgetUsd } from "@/lib/research-steps";
import { ensembleProviders } from "@/lib/ai/providers/select";
import { aiSettingsForOrg } from "@/lib/ai/settings";
import { CLAIM_STATUS, SOURCE_TYPES, type ClaimStatus, type CompetitorKind, type EvidenceType, type SourceType } from "@/lib/domain/labels";
import { breakEvenRevenue, SCENARIO_LABELS, type ScenarioKind, type SizingModel } from "@/lib/domain/sizing";
import { loadRegisters } from "@/lib/sector-register-data";
import { SectorRegisterPanel } from "@/components/research/SectorRegisterPanel";
import { compareWithIntake, intakeScope } from "@/lib/domain/claim-scope";
import type { FreshnessKind } from "@/lib/domain/verify";
import {
  addClaim, addSource, adoptIntakePrice, aiPlan, fetchCbsFigures, checkClaimSupport, deleteClaim, deleteCompetitor, deleteQuestion, deleteSegment, deleteSource,
  overrideSupport, recheckCompetitors, refreshQuestionsFromIntake, saveCompetitor, saveQuestion, saveScenario, saveSegment, saveUnitEconomics,
  setDecisiveQuestion,
} from "./actions";
import { decisiveFirst, isGenericTemplate, priceFromIntake } from "@/lib/research-questions";
import { annualPriceFromOffer } from "@/lib/intake-proposal";
import { FAILURE_TEXT, failedProviders, retryable } from "@/lib/research-failures";
import { loadUncertaintyPicks } from "@/lib/research-uncertainty-data";
import { uncertaintyText } from "@/lib/research-uncertainty";
import { UncertaintyCard } from "@/components/research/UncertaintyCard";
import { FormPendingOverlay } from "@/components/ui/SavingOverlay";
import { OpenOnHash } from "@/components/ui/OpenOnHash";
import { CustomerResearchPanel } from "@/components/research/CustomerResearchPanel";
import { loadStudies } from "@/lib/customer-research-data";
import { createStudy } from "./study-actions";

export const metadata: Metadata = { title: "Marktverkenning" };

// Systeemcontrole: per onderzoeksvraag eerst de sterkste bevindingen (geverifieerd, dan onderbouwde schatting, …).
const FIRST_FINDINGS = 3;
const STATUS_ORDER: Record<string, number> = { verified: 0, estimate: 1, contested: 2, refuted: 3, outdated: 4, insufficient: 5 };
const byStrength = <T extends { status: string }>(list: T[]): T[] => [...list].sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
// Gebruikerstest A10: van een geïmporteerd rapport (vaak honderden tekstblokken) laadt de pagina alleen het aantal blokken
// en de eerste paar als voorbeeld; bevindingen uit het rapport legt de consultant vast in het importblok.
const IMPORT_PREVIEW_BLOCKS = 3;
type ExcerptRow = { id: string; text: string; location: string | null; source_id: string };

const METHOD = { desk: "Bureauonderzoek", customer: "Klantonderzoek", both: "Bureau- en klantonderzoek" } as const;
const QSTATUS = { open: ["Open", "gray"], answered: ["Beantwoord", "green"], needs_customer_research: ["Vraagt klantonderzoek", "orange"] } as const;
const ROLE = { user: ["Gebruiker", "blue"], buyer: ["Betaler / beslisser", "coral"], supplier: ["Aanbodzijde", "green"], other: ["Overig", "gray"] } as const;

export default async function ResearchPage({ params, searchParams }: PageProps<"/app/ideas/[id]/research">) {
  const { id } = await params;
  const sp = await searchParams;
  const { idea, canWrite } = await getIdea(id);
  // Fase 1 · punt 1: in Snel geen kengetallen, zoeklogboek, tegenargumenten, AI-kwaliteit, steuncontrole per citaat
  // (de statuspil blijft), financiële haalbaarheid en simulatie. Bevindingen, statussen en tabs zijn gelijk.
  const quick = (await getViewMode(id)) === "quick";
  const isOwner = (await getWorkspace()).org?.role === "owner";
  const supabase = await supabaseServer();
  const [qs, claimsRes, sourcesRes, compRes, segRes, scenRes, ueRes, runRes, signalsRes] = await Promise.all([
    supabase.from("research_questions").select("*").eq("idea_id", id).order("position"),
    supabase
      .from("claims")
      .select("*, claim_sources(id, source_id, quote, stance, quote_check, support_check, support_checked_by, support_note, live_found, live_checked_at, sources(title, url, publisher, published_on, source_type, domain, access_note))")
      .eq("idea_id", id)
      .order("created_at"),
    supabase.from("sources").select("*").eq("idea_id", id).order("created_at", { ascending: false }),
    supabase.from("competitors").select("*, claims(statement, status, claim_sources(quote, live_found, live_checked_at, sources(url, live_error)))").eq("idea_id", id).order("created_at"),
    supabase.from("segments").select("*").eq("idea_id", id).order("created_at"),
    supabase.from("sizing_scenarios").select("*, sizing_factors(*)").eq("idea_id", id),
    supabase.from("unit_economics").select("*").eq("idea_id", id).maybeSingle(),
    supabase.from("research_runs").select("*").eq("idea_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("customer_signals").select("*").eq("idea_id", id).order("mentions", { ascending: false }),
  ]);
  // Documenten die als onderzoek te importeren zijn (zonder de migratie voor documenten: geen lijst, wel uploaden-melding).
  const { data: docRows } = canWrite
    ? await supabase.from("step_documents").select("id, file_name, size_bytes, description, step").eq("idea_id", id).order("created_at", { ascending: false })
    : { data: [] };
  const importableDocs: ImportableDoc[] = (docRows ?? []).flatMap((d) =>
    importExt(d.file_name) && isNoteStep(d.step) ? [{ id: d.id, fileName: d.file_name, size: Number(d.size_bytes), description: d.description, step: d.step }] : [],
  );
  const quality = canWrite ? await loadAiQuality() : null;
  // Fase 2, punt 6: sectorregisters (bronnen van het type dataset met een vaste markering) en hun originelen.
  const registers = await loadRegisters(id);
  const registerTargets = (scenRes.data ?? []).flatMap((s) =>
    (s.sizing_factors ?? [])
      .filter((f) => f.unit === "count")
      .map((f) => ({ value: `${s.id}:${f.key}`, label: `${SCENARIO_LABELS[s.kind as ScenarioKind]?.label ?? s.kind} scenario: ${f.label}` })),
  );
  // Klantonderzoek: alle enquêtes en interviews van dit dossier (verkennend vanuit Markt en tests uit stap 3).
  const studies = await loadStudies(id);
  const run = runRes.data;
  const { data: tasks } = run
    ? await supabase.from("research_tasks").select("id, label, status, detail, kind, output, question_id").eq("run_id", run.id).order("position")
    : { data: [] };
  // Zoeklogboek van de laatste run (RLS: alleen het onderzoeksteam leest het).
  const { data: logRows } =
    run && canWrite
      ? await supabase.from("research_search_log").select("id, question_id, question, provider, query, urls, passages, reused, kind").eq("run_id", run.id).order("created_at")
      : { data: [] };
  // Fase B2, punt 4: werkt er nu een serverportie aan de run (lease)? Zonder de B2-migratie: onbekend.
  const lease =
    run && canWrite && (run.status === "queued" || run.status === "running")
      ? await supabase.from("research_run_leases").select("lease_until").eq("run_id", run.id).maybeSingle()
      : null;
  const worker = workerState(lease);
  const counterTasks = (tasks ?? []).filter((t) => t.kind === "counter");
  const challenges =
    ((tasks ?? []).find((t) => t.kind === "reality_check" && t.status === "done")?.output as { challenges?: { title: string; detail: string }[] } | null)?.challenges ?? [];

  const questions = qs.data ?? [];
  const counterLog = groupSearchLog((logRows ?? []).filter((r) => r.kind === "counter"), questions);
  const intake = intakeScope(idea);
  const claims: (ClaimView & { question_id: string | null; section: string; numeric_value: number | null })[] = (claimsRes.data ?? []).map((c) => ({
    id: c.id,
    statement: c.statement,
    status: c.status as ClaimStatus,
    status_reason: c.status_reason,
    evidence_type: c.evidence_type as EvidenceType,
    supports: c.supports,
    does_not_prove: c.does_not_prove,
    region: c.region,
    period: c.period,
    scope: (() => {
      // Golf C, punt 7: dezelfde vergelijking als bij het opslaan, zodat de waarschuwing altijd zichtbaar is.
      const check = compareWithIntake({ population: c.population, region: c.region, referenceDate: c.reference_date, freshness: c.freshness_kind as FreshnessKind }, intake);
      return { population: c.population, region: c.region, referenceDate: c.reference_date, relevance: check.relevance, warnings: check.warnings };
    })(),
    definition: c.definition,
    limitations: c.limitations,
    origin: c.origin,
    question_id: c.question_id,
    section: c.section,
    numeric_value: c.numeric_value,
    evidence: (c.claim_sources ?? []).map((e) => ({
      id: e.id,
      source_id: e.source_id,
      support_check: e.support_check,
      support_checked_by: e.support_checked_by,
      support_note: e.support_note,
      live_found: e.live_found,
      live_checked_at: e.live_checked_at,
      quote: e.quote,
      stance: e.stance,
      quote_check: e.quote_check,
      source: e.sources ? { ...e.sources, source_type: e.sources.source_type as SourceType } : null,
    })),
  }));
  // Gebruikerstest A10: fragmenttekst alleen voor gewone bronnen (en klantsignalen); van geïmporteerde rapporten alleen het
  // aantal blokken en een kort voorbeeld. Dat scheelt bij een rapport van 300 blokken ~300 tekstblokken in elke paginalading.
  const sourceRows = sourcesRes.data ?? [];
  const isHeavy = (s: (typeof sourceRows)[number]) => isImportedReport(s.access_note) && !isSignalSource(s);
  const plainIds = sourceRows.filter((s) => !isHeavy(s)).map((s) => s.id);
  const importedIds = sourceRows.filter(isHeavy).map((s) => s.id);
  const [plainExcerpts, importedCounts, ...previews] = await Promise.all([
    plainIds.length ? supabase.from("source_excerpts").select("id, text, location, source_id").in("source_id", plainIds).order("created_at") : Promise.resolve({ data: [] as ExcerptRow[] }),
    importedIds.length ? supabase.from("source_excerpts").select("source_id").in("source_id", importedIds) : Promise.resolve({ data: [] as { source_id: string }[] }),
    ...importedIds.map((sid) => supabase.from("source_excerpts").select("id, text, location, source_id").eq("source_id", sid).order("created_at").limit(IMPORT_PREVIEW_BLOCKS)),
  ]);
  const excerptsBySource = new Map<string, ExcerptRow[]>();
  for (const e of [...(plainExcerpts.data ?? []), ...previews.flatMap((p) => p.data ?? [])]) excerptsBySource.set(e.source_id, [...(excerptsBySource.get(e.source_id) ?? []), e]);
  const blockCount = new Map<string, number>();
  for (const e of importedCounts.data ?? []) blockCount.set(e.source_id, (blockCount.get(e.source_id) ?? 0) + 1);
  const sources = sourceRows.map((s) => {
    const source_excerpts = excerptsBySource.get(s.id) ?? [];
    return { ...s, source_excerpts, excerptCount: blockCount.get(s.id) ?? source_excerpts.length };
  });
  // Geïmporteerde rapporten hebben veel tekstblokken: daarvoor legt de consultant bevindingen vast in het importblok,
  // waar ProofLab zelf het blok bij het citaat zoekt. Het gewone formulier toont de overige fragmenten.
  const excerpts = sources
    .filter((s) => !isImportedReport(s.access_note))
    .flatMap((s) => (s.source_excerpts ?? []).map((e) => ({ id: e.id, text: e.text, sourceTitle: s.title, sourceType: s.source_type })));
  const allCompetitors: CompetitorView[] = (compRes.data ?? []).map((c) => ({
    ...c,
    kind: c.kind as CompetitorKind,
    claim: c.claims ? { statement: c.claims.statement, status: c.claims.status } : null,
    checks: [...new Map((c.claims?.claim_sources ?? []).flatMap((l) => {
      if (!l.sources?.url || !l.live_checked_at) return [];
      const missing = l.live_found === false;
      const when = new Date(l.live_checked_at).toLocaleDateString("nl-NL");
      const text = l.sources.live_error ? `pagina niet bereikbaar (${l.sources.live_error})` : missing ? "citaat niet meer gevonden op de pagina" : "citaat teruggevonden";
      return [[l.sources.url, { url: l.sources.url, note: `hercontrole ${when}: ${text}`, missing }] as const];
    })).values()],
  }));
  // Gebruikerstest D6: voorstellen (genoemd door de AI, zonder bron) staan apart en alleen voor consultants; ze tellen
  // nergens mee. De database laat opdrachtgevers ze ook niet lezen.
  const competitors = withoutProposals(allCompetitors);
  const proposals = canWrite ? allCompetitors.filter(isProposal) : [];
  const signals: SignalView[] = (signalsRes.data ?? []).map((s) => ({ id: s.id, kind: s.kind as SignalKind, label: s.label, mentions: s.mentions, origin: s.origin, quotes: parseSignalQuotes(s.quotes) }));
  const signalSources = sources
    .filter((s) => isSignalSource(s))
    .map((s) => ({ id: s.id, title: s.title, source_type: s.source_type, excerpts: (s.source_excerpts ?? []).map((e) => ({ id: e.id, text: e.text })) }))
    .filter((s) => s.excerpts.length > 0);
  const supportCounts = (sourceId: string) => {
    const counts: Record<SupportCheck, number> = { supports: 0, partial: 0, not_supported: 0, unchecked: 0 };
    for (const c of claims) for (const e of c.evidence) if (e.source_id === sourceId) counts[isSupportCheck(e.support_check) ? e.support_check : "unchecked"]++;
    return counts;
  };
  // Golf C, punt 10: bevindingen die alleen als tegenbewijs (relatie 'contradicts') aan een bron hangen, staan apart.
  const isCounter = (c: (typeof claims)[number]) => c.evidence.length > 0 && c.evidence.every((e) => e.stance === "contradicts");
  const counterClaims = claims.filter(isCounter);
  const verified = claims.filter((c) => c.status === "verified").length;
  const answered = questions.filter((q) => q.status === "answered").length;
  // Fase B2: de beslissende vraag (is_decisive) gaat voor; zonder markering de eerste open vraag.
  const decisiveQuestion = questions.find((q) => q.is_decisive === true) ?? null;
  const openQuestion = decisiveQuestion && decisiveQuestion.status !== "answered" ? decisiveQuestion : questions.find((q) => q.status !== "answered");
  // Sjabloonvragen met de brede doelgroep terwijl de intake specifieker is, of nog geen beslissende vraag.
  const questionsNeedIntake = questions.some((q) => isGenericTemplate(q, idea)) || (questions.length > 0 && !decisiveQuestion);
  const kinds = new Set(competitors.map((c) => c.kind));
  // Gebruikerstest D5: de prijs uit de intake als jaaromzet per klant (aanname), voor de knop in het marktpotentieel.
  const offerText = priceFromIntake(idea);
  const annual = annualPriceFromOffer(offerText);
  const intakePrice = annual && offerText ? { ...annual, offer: offerText } : null;
  const ue = ueRes.data;
  const sizingClaims = claims
    .filter((c) => c.status !== "insufficient")
    .map((c) => ({ id: c.id, statement: c.statement, status: c.status, numeric_value: c.numeric_value, region: c.region, reference_date: c.scope?.referenceDate ?? null }));

  // Fase B2, punt 3: de schatting vóór de start, per modus, met dezelfde bovengrenzen als de runner.
  const searchProviders = canWrite && aiConfigured() ? await researchProviders(idea.org_id) : [];
  const models = Object.fromEntries(PROVIDERS.map((p) => [p, modelFor(p, process.env, "research")]));
  const runOrder = decisiveFirst(questions);
  const runEstimates = searchProviders.length
    ? (["quick", "deep"] as const).reduce(
        (acc, mode) => {
          const e = estimateRun(planSteps(runOrder, mode), searchProviders, mode, runBudgetUsd(mode, env.researchBudgetUsd), models);
          acc[mode] = { text: estimateText(e), providers: e.providers.map((p) => PROVIDER_LABELS[p].name) };
          return acc;
        },
        {} as Record<"quick" | "deep", { text: string; providers: string[] }>,
      )
    : undefined;

  // Fase B2, punt 6: de bevindingen bij de grootste onzekerheid (alleen bestaande bevindingen met bron).
  const uncertainty = await loadUncertaintyPicks(supabase, id);
  const uncertaintyPicks = uncertainty.picks.flatMap((p) => {
    const c = claims.find((x) => x.id === p.claimId);
    if (!c) return [];
    const sources = [...new Set(c.evidence.map((e) => e.source?.publisher || e.source?.title || "").filter(Boolean))];
    return [{ claimId: p.claimId, effect: p.effect, reason: p.reason, origin: p.origin, statement: c.statement, status: c.status, sources }];
  });

  const importedReports: ImportedReport[] = sources
    .filter((s) => isImportedReport(s.access_note))
    .map((s) => ({ id: s.id, title: s.title, sourceType: s.source_type, blocks: s.excerptCount, findings: claims.filter((c) => c.evidence.some((e) => e.source_id === s.id)).length }));

  const tab = typeof sp.tab === "string" ? sp.tab : "overview";
  const evidenceActions = (claim: (typeof claims)[number]) =>
    canWrite && !quick
      ? (eid: string) => {
          const e = claim.evidence.find((x) => x.id === eid);
          if (!e) return null;
          return (
            <SupportControls
              id={eid}
              checkedBy={e.support_checked_by ?? null}
              current={e.support_check ?? "unchecked"}
              aiConnected={aiConfigured()}
              checkAction={checkClaimSupport.bind(null, id, eid)}
              overrideAction={overrideSupport.bind(null, id, eid)}
            />
          );
        }
      : undefined;
  const claimActions = (cid: string) =>
    canWrite ? (
      <form action={deleteClaim.bind(null, id, cid)}>
        <button className="text-link" style={{ color: "var(--color-risk-text)" }}>Bevinding verwijderen</button>
        <FormPendingOverlay />
      </form>
    ) : null;

  // Voorstel "ProofLab eenvoudiger": elk tabblad is een taak van Markt met de vaste taakkop.
  const list = ideaTasks(await loadProgress(id));
  const head = (key: "market-question" | "market-competitors" | "market-customers" | "market-sizing", title: string, why: string, aside?: React.ReactNode) => (
    <TaskHeader ideaId={id} list={list} taskKey={key} title={title} why={why} aiConnected={aiConfigured()} aside={aside} />
  );
  const firstSource =
    canWrite && sources.length === 0 && claims.length === 0 ? (
      <TabJumpLink className="btn primary" tab="sources" anchor="bron-toevoegen" href={`/app/ideas/${id}/research?tab=sources#bron-toevoegen`}>
        Voeg je eerste bron toe
      </TabJumpLink>
    ) : undefined;

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, "Marktverkenning"]} coach="research" ideaId={id} section="/research" badge={run?.mode === "quick" && run.status === "done" ? "Snelle marktcheck · voorlopig" : undefined}>
      <Tabs
        key={tab}
        initial={tab}
        heads={{
          overview: head("market-question", "Begrijp je markt.", "Een marktbeeld met zicht op concurrenten, doelgroepen, kansen en onzekerheden. Elke conclusie verwijst naar een controleerbare bron.", firstSource),
          sources: head("market-question", "Bronnen en bevindingen", "Voeg bronnen toe en leg per bevinding vast wat de bron wel en niet bewijst. Een AI-tekst is zelf nooit een bron."),
          competitors: head("market-competitors", "Concurrenten en alternatieven", "Wat doen klanten nu in plaats van jouw idee? Ook niets doen, Excel of het eigen netwerk telt als alternatief."),
          customers: head("market-customers", "Doelgroep en klantonderzoek", "Wie heeft het probleem, wie betaalt en wie beslist? Hier beschrijf je de doelgroep; bij Klantonderzoek hoor je hen in hun eigen woorden."),
          klantonderzoek: head("market-customers", "Doelgroep en klantonderzoek", "Praat met echte klanten of zet een korte enquête uit. Alleen wat mensen zelf zeggen of doen telt als bewijs."),
          sizing: head("market-sizing", "Hoe groot is de markt?", "Reken met aannames die je kunt onderbouwen. Ontbrekende data blijft zichtbaar onbekend; een schatting is geen bewezen marktomvang."),
        }}
        // Gebruikerstest A10: concurrenten, klantonderzoek en marktpotentieel (zware interactieve panelen) pas opbouwen bij
        // het openen. Marktbeeld en Bronnen niet: daar springen zoekresultaten en "Voeg toe als bron" direct naartoe.
        lazy={["competitors", "klantonderzoek", "sizing"]}
        tabs={[
          { key: "overview", label: "Marktbeeld" },
          { key: "competitors", label: "Concurrenten" },
          { key: "customers", label: "Doelgroepen" },
          { key: "klantonderzoek", label: "Klantonderzoek" },
          { key: "sizing", label: "Marktpotentieel" },
          { key: "sources", label: "Bronnen" },
        ]}
      >
        {/* Marktbeeld */}
        <div key="overview">
      <div className="insight-banner">
        <div>
          <span className="pill blue">✳ Beslisvraag</span>
          <h2 className="as-h3" style={{ marginTop: 10 }}>{idea.decision_question}</h2>
          <p>
            {idea.target_audience}
            {idea.audience_detail ? ` (${idea.audience_detail})` : ""} · {idea.region}
            {idea.key_uncertainty ? ` · grootste onzekerheid: ${idea.key_uncertainty}` : ""}
          </p>
        </div>
        <span className={`pill ${verified ? "green" : "orange"}`}>{verified} geverifieerde bevinding{verified === 1 ? "" : "en"}</span>
      </div>

      <UncertaintyCard
        ideaId={id}
        uncertainty={uncertaintyText(idea.key_uncertainty, decisiveQuestion?.question)}
        picks={uncertaintyPicks}
        candidates={claims
          .filter((c) => ["verified", "estimate", "contested", "refuted"].includes(c.status) && !uncertaintyPicks.some((p) => p.claimId === c.id))
          .map((c) => ({ id: c.id, statement: c.statement }))}
        canWrite={canWrite}
        editable={uncertainty.editable}
        aiConnected={aiConfigured()}
      />


          <Detail>
          <div className="research-kpis">
            <div className="card tight">
              <div className="tiny">Onderzoeksvragen beantwoord</div>
              <div className="mini-kpi num">{answered}/{questions.length}</div>
              <span className="stat-caption">Maximaal vijf <Term k="beslissende-vraag">beslissende vragen</Term></span>
            </div>
            <div className="card tight">
              <div className="tiny">Bevindingen met bron</div>
              <div className="mini-kpi num">{claims.length}</div>
              <span className="stat-caption">{verified} geverifieerd · {claims.filter((c) => c.status === "insufficient").length} onvoldoende bewijs</span>
            </div>
            <div className="card tight">
              <div className="tiny">{openQuestion && openQuestion.id === decisiveQuestion?.id ? "Beslissende vraag" : "Belangrijkste open vraag"}</div>
              <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3, margin: "12px 0 7px" }}>{openQuestion?.question ?? "Alle vragen beantwoord"}</div>
              <span className={`pill ${openQuestion ? "orange" : "green"}`}>{openQuestion ? "Nog niet beantwoord" : "Klaar"}</span>
            </div>
          </div>
          </Detail>

          {/* Eén kolom: de vragen en het onderzoekslogboek bevatten lange zinnen die in een halve kolom onleesbaar werden. */}
          <div className="stack research-stack">
            <div className="card" id="onderzoekskaart" style={{ scrollMarginTop: 100 }}>
              {sp.vragen === "bijgewerkt" && (
                <p className="form-ok" role="status">
                  <strong>De vragen volgen nu de intake.</strong> De beslissende vraag is gemarkeerd en bestaande bevindingen zijn aan hun vraag gekoppeld gebleven.
                </p>
              )}
              <div className="section-title">
                <h3>Onderzoekskaart</h3>
                {canWrite && questionsNeedIntake && (
                  <ActionForm action={refreshQuestionsFromIntake.bind(null, id)} submitLabel="Vragen afleiden uit de intake" submitClass="btn white sm" pendingLabel="Bezig…">
                    <span />
                  </ActionForm>
                )}
                {canWrite && aiConfigured() && (
                  <ActionForm action={aiPlan.bind(null, id)} submitLabel="Laat AI opnieuw voorstellen" submitClass="btn ai sm" pendingLabel="Bezig…">
                    <span />
                  </ActionForm>
                )}
              </div>
              {questions.map((q) => {
                const qClaims = claims.filter((c) => c.question_id === q.id);
                const [label, pill] = QSTATUS[q.status as keyof typeof QSTATUS];
                return (
                  <details key={q.id} className="quickline" style={{ display: "block" }}>
                    <summary style={{ display: "flex", gap: 11, alignItems: "flex-start", cursor: "pointer", listStyle: "none" }}>
                      <span className="num">{q.position}</span>
                      <div className="question-text">
                        <strong>{q.question}</strong>
                        <span className="question-meta">
                          {q.is_decisive === true && <span className="pill blue">Beslissende vraag</span>}
                          <span className={`pill ${pill}`}>{label}</span>
                          {METHOD[q.method as keyof typeof METHOD]}
                          {isExpectedSource(q.expected_source) ? ` · Brontype: ${EXPECTED_SOURCES[q.expected_source]}` : ""} · {qClaims.length} bevinding{qClaims.length === 1 ? "" : "en"}
                          {q.ai_original ? ` · AI-concept · ${describeDraftEdit(draftEdit(q.ai_original, questionDraftText(q))).toLowerCase()}` : ""}
                        </span>
                      </div>
                    </summary>
                    <div style={{ padding: "10px 0 4px 39px" }}>
                      {q.why_it_matters && <p className="tiny">Waarom: {q.why_it_matters}</p>}
                      {q.unit && <p className="tiny mt-8">Meeteenheid: {q.unit}</p>}
                      <p className="tiny mt-8">Klaar als: {q.done_criterion}</p>
                      {q.is_decisive === true ? (
                        <p className="tiny mt-8">Deze vraag raakt de grootste onzekerheid en gaat in elke onderzoeksrun als eerste.</p>
                      ) : (
                        canWrite &&
                        decisiveQuestion && (
                          <form action={setDecisiveQuestion.bind(null, id, q.id)} className="mt-8">
                            <button className="text-link">Maak dit de beslissende vraag</button>
                            <FormPendingOverlay />
                          </form>
                        )
                      )}
                      {canWrite && (
                        <ActionForm action={saveQuestion.bind(null, id, q.id)} submitLabel="Vraag opslaan" submitClass="btn white sm" footer={<DeleteQuestion ideaId={id} questionId={q.id} />}>
                          <label className="field-label" htmlFor={`q-${q.id}`}>Vraag</label>
                          <input className="field" id={`q-${q.id}`} name="question" defaultValue={q.question} />
                          <label className="field-label" htmlFor={`d-${q.id}`}>Klaar-criterium</label>
                          <input className="field" id={`d-${q.id}`} name="done_criterion" defaultValue={q.done_criterion} />
                          <div className="double-field">
                            <div>
                              <label className="field-label" htmlFor={`m-${q.id}`}>Methode</label>
                              <select className="field" id={`m-${q.id}`} name="method" defaultValue={q.method}>
                                {Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="field-label" htmlFor={`s-${q.id}`}>Status</label>
                              <select className="field" id={`s-${q.id}`} name="status" defaultValue={q.status}>
                                {Object.entries(QSTATUS).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}
                              </select>
                            </div>
                          </div>
                          <div className="double-field">
                            <div>
                              <label className="field-label" htmlFor={`u-${q.id}`}>Meeteenheid</label>
                              <input className="field" id={`u-${q.id}`} name="unit" defaultValue={q.unit ?? ""} placeholder="Bijv. aantal bedrijven" />
                            </div>
                            <div>
                              <label className="field-label" htmlFor={`b-${q.id}`}>Verwacht brontype</label>
                              <select className="field" id={`b-${q.id}`} name="expected_source" defaultValue={q.expected_source ?? ""}>
                                <option value="">Niet opgegeven</option>
                                {Object.entries(EXPECTED_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                              </select>
                            </div>
                          </div>
                        </ActionForm>
                      )}
                    </div>
                  </details>
                );
              })}
              {canWrite && questions.length < 5 && (
                <details className="mt-12">
                  <summary className="text-link">+ Vraag toevoegen</summary>
                  <ActionForm action={saveQuestion.bind(null, id, null)} submitLabel="Toevoegen" resetOnSuccess>
                    <label className="field-label" htmlFor="nq">Vraag</label>
                    <input className="field" id="nq" name="question" />
                    <label className="field-label" htmlFor="nd">Klaar-criterium</label>
                    <input className="field" id="nd" name="done_criterion" />
                    <input type="hidden" name="method" value="both" />
                    <input type="hidden" name="status" value="open" />
                  </ActionForm>
                </details>
              )}
            </div>
            <ResearchRunPanel
              ideaId={id}
              canWrite={canWrite}
              providers={PROVIDERS.map((p) => ({ id: p, name: providerLabel(p), keyEnv: PROVIDER_KEY_ENV[p], connected: configuredProviders().includes(p) }))}
              searchWith={searchProviders.map((p) => PROVIDER_LABELS[p].name)}
              estimates={runEstimates}
              worker={worker}
              run={run ? { id: run.id, status: run.status, mode: run.mode, cost: Number(run.cost_usd), budget: Number(run.budget_usd), tasks: (tasks ?? []).map((t) => runTaskView(t)) } : null}
              searchLog={quick ? [] : groupSearchLog((logRows ?? []).filter((r) => r.kind !== "counter"), questions)}
              cbsAction={fetchCbsFigures.bind(null, id)}
              isOwner={isOwner}
            />
            {/* Golf C, punt 10: tegenbewijs apart, met het eigen zoeklogboek. */}
            {(counterClaims.length > 0 || counterLog.length > 0 || counterTasks.length > 0) && (
              <div className="card">
                <div className="section-title">
                  <h3>Tegenbewijs</h3>
                  <span className={`pill ${counterClaims.length ? "coral" : "gray"}`}>
                    {counterClaims.length} tegenbevinding{counterClaims.length === 1 ? "" : "en"}
                  </span>
                </div>
                <p className="sub">
                  Per onderzoeksvraag zoekt ProofLab apart naar bronnen die het idee tegenspreken. Elke tegenbevinding heeft een letterlijk gecontroleerd citaat.
                  Niets gevonden bewijst niet dat het idee klopt.
                </p>
                {counterClaims.length > 0 && (
                  <p className="tiny"><a className="text-link" href="#tegenbewijs">Lees de tegenbevindingen ↓</a></p>
                )}
                {/* Systeemcontrole: hoe er gezocht is, staat achter een uitklapper; de tegenbevindingen zelf staan verderop. */}
                {(counterTasks.length > 0 || counterLog.length > 0) && (
                  <Detail>
                  <details className="run-details">
                    <summary className="text-link">Hoe is er gezocht naar tegenbewijs?</summary>
                    {counterTasks.map((t, i) => (
                      <div className="quickline" key={i}>
                        <span className="num risk" aria-hidden="true">{t.status === "done" ? "✓" : t.status === "failed" ? "!" : "…"}</span>
                        <div><strong>{t.label}</strong><span>{t.detail ?? (t.status === "pending" ? "Nog niet gestart." : t.status === "skipped" ? "Overgeslagen." : "")}</span></div>
                      </div>
                    ))}
                    {counterLog.length > 0 && <SearchLogList questions={counterLog} canWrite={canWrite} title="Zoeklogboek tegenbewijs" />}
                  </details>
                  </Detail>
                )}
              </div>
            )}
            {challenges.length > 0 && (
              <Detail>
              <div className="card">
                <div className="section-title"><h3>Tegenargumenten</h3><span className="pill coral">Advocaat van de duivel</span></div>
                {challenges.map((c, i) => (
                  <div className="quickline" key={i}>
                    <span className="num risk" aria-hidden="true">!</span>
                    <div><strong>{c.title}</strong><span>{c.detail}</span></div>
                  </div>
                ))}
                <div className="note">Deze punten zijn kritische vragen van de AI, geen bewijs. Neem ze mee in de Reality Check.</div>
              </div>
              </Detail>
            )}
          </div>

          <div className="section-title mt-24"><h2>Bevindingen per onderzoeksvraag</h2></div>
          <OpenOnHash />
          {claims.length === 0 ? (
            <div className="empty-state">
              <h3>Nog geen bevindingen</h3>
              <p>{aiConfigured() ? <>Start een marktcheck, of voeg zelf een bron met <Term k="letterlijk-citaat">letterlijk citaat</Term> toe.</> : <>Voeg een bron toe onder Bronnen en leg er een bevinding met <Term k="letterlijk-citaat">letterlijk citaat</Term> bij.</>}</p>
            </div>
          ) : (
            <div className="stack">
              {questions.map((q) => {
                const list = claims.filter((c) => c.question_id === q.id && !isCounter(c));
                if (list.length === 0) return null;
                return (
                  <div key={q.id} className="stack">
                    <div className="eyebrow" style={{ marginBottom: 0 }}>Vraag {q.position} · {q.question}</div>
                    {/* Systeemcontrole: eerst de drie sterkste bevindingen per vraag, de rest achter een uitklapper. */}
                    {byStrength(list).slice(0, FIRST_FINDINGS).map((c) => <InsightCard key={c.id} claim={c} actions={claimActions(c.id)} evidenceActions={evidenceActions(c)} />)}
                    {list.length > FIRST_FINDINGS && (
                      <details className="more-findings">
                        <summary className="text-link">Toon nog {list.length - FIRST_FINDINGS} {list.length - FIRST_FINDINGS === 1 ? "bevinding" : "bevindingen"} bij deze vraag</summary>
                        <div className="stack mt-12">
                          {byStrength(list).slice(FIRST_FINDINGS).map((c) => <InsightCard key={c.id} claim={c} actions={claimActions(c.id)} evidenceActions={evidenceActions(c)} />)}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })}
              {claims.filter((c) => !c.question_id && !isCounter(c)).map((c) => <InsightCard key={c.id} claim={c} actions={claimActions(c.id)} evidenceActions={evidenceActions(c)} />)}
            </div>
          )}

          {counterClaims.length > 0 && (
            <>
              <div className="section-title mt-24">
                <div>
                  <h2 id="tegenbewijs" style={{ scrollMarginTop: 100 }}><Term k="tegenbewijs">Tegenbewijs</Term></h2>
                  <p className="sub">Bevindingen die het idee tegenspreken, per onderzoeksvraag. Lees ze even serieus als het ondersteunende bewijs.</p>
                </div>
              </div>
              <div className="stack">
                {[...questions.map((q) => ({ key: q.id, label: `Vraag ${q.position} · ${q.question}`, list: counterClaims.filter((c) => c.question_id === q.id) })),
                  { key: "zonder-vraag", label: "Zonder onderzoeksvraag", list: counterClaims.filter((c) => !c.question_id || !questions.some((q) => q.id === c.question_id)) }]
                  .filter((g) => g.list.length > 0)
                  .map((g) => (
                    <div key={g.key} className="stack">
                      <div className="eyebrow" style={{ marginBottom: 0 }}>{g.label}</div>
                      {byStrength(g.list).slice(0, FIRST_FINDINGS).map((c) => <InsightCard key={c.id} claim={c} actions={claimActions(c.id)} evidenceActions={evidenceActions(c)} />)}
                      {g.list.length > FIRST_FINDINGS && (
                        <details className="more-findings">
                          <summary className="text-link">Toon nog {g.list.length - FIRST_FINDINGS} {g.list.length - FIRST_FINDINGS === 1 ? "tegenbevinding" : "tegenbevindingen"} bij deze vraag</summary>
                          <div className="stack mt-12">
                            {byStrength(g.list).slice(FIRST_FINDINGS).map((c) => <InsightCard key={c.id} claim={c} actions={claimActions(c.id)} evidenceActions={evidenceActions(c)} />)}
                          </div>
                        </details>
                      )}
                    </div>
                  ))}
              </div>
            </>
          )}

          <div className="card" style={{ marginTop: 18 }}>
            <div className="section-title"><h3>Concurrentielandschap</h3></div>
            <div className="grid-3">
              <div style={{ padding: 15, background: "var(--color-surface-soft)", borderRadius: "var(--radius-inner)" }}>
                <span className="pill blue">Direct</span>
                <h3 style={{ fontSize: 16, margin: "12px 0 7px" }}>{plural(competitors.filter((c) => c.kind === "direct").length, "aanbieder", "aanbieders")}</h3>
                <p className="tiny">{competitors.filter((c) => c.kind === "direct").map((c) => c.name).slice(0, 3).join(", ") || "Nog niet onderzocht"}</p>
              </div>
              <div style={{ padding: 15, background: "var(--color-warning-soft)", borderRadius: "var(--radius-inner)" }}>
                <span className="pill coral">Indirect</span>
                <h3 style={{ fontSize: 16, margin: "12px 0 7px" }}>{plural(competitors.filter((c) => c.kind === "indirect").length, "aanbieder", "aanbieders")}</h3>
                <p className="tiny">{competitors.filter((c) => c.kind === "indirect").map((c) => c.name).slice(0, 3).join(", ") || "Nog niet onderzocht"}</p>
              </div>
              <div style={{ padding: 15, background: "var(--color-success-soft)", borderRadius: "var(--radius-inner)" }}>
                <span className="pill green">Alternatief</span>
                <h3 style={{ fontSize: 16, margin: "12px 0 7px" }}>{plural(competitors.filter((c) => c.kind === "alternative" || c.kind === "status_quo").length, "alternatief", "alternatieven")}</h3>
                <p className="tiny">{competitors.filter((c) => c.kind === "alternative" || c.kind === "status_quo").map((c) => c.name).slice(0, 3).join(", ")}</p>
              </div>
            </div>
            {!kinds.has("direct") && <div className="note">Nog geen directe aanbieders vastgelegd. &quot;Geen concurrentie&quot; is zelden waar; zoek ook in aangrenzende markten.</div>}
          </div>
        </div>

        {/* Concurrenten */}
        <div key="competitors">
          <CompetitorPanel
            competitors={competitors}
            proposals={proposals}
            canWrite={canWrite}
            claims={claims.filter((c) => c.status !== "insufficient").map((c) => ({ id: c.id, statement: c.statement }))}
            addAction={saveCompetitor.bind(null, id, null)}
            updateActions={Object.fromEntries(allCompetitors.map((c) => [c.id, saveCompetitor.bind(null, id, c.id)]))}
            deleteActions={Object.fromEntries(allCompetitors.map((c) => [c.id, deleteCompetitor.bind(null, id, c.id)]))}
            recheckActions={Object.fromEntries(competitors.map((c) => [c.id, recheckCompetitors.bind(null, id, c.id)]))}
            recheckAll={recheckCompetitors.bind(null, id, null)}
          />
        </div>

        {/* Doelgroepen */}
        <div key="customers">
          <div className="section-title">
            <div>
              <h2>Wie heeft dit probleem?</h2>
              <p className="sub">We onderscheiden de gebruiker, de beslisser en degene die betaalt.</p>
            </div>
            <Link className="btn soft sm" href={`/app/ideas/${id}/experiments`}>Plan klantinterviews →</Link>
          </div>
          {(segRes.data ?? []).length === 0 ? (
            <div className="empty-state"><h3>Nog geen segmenten</h3><p>Leg minstens de gebruiker en de betaler of beslisser vast. In B2B zijn dat vaak verschillende mensen.</p></div>
          ) : (
            <div className="grid-3">
              {(segRes.data ?? []).map((s) => {
                const [label, pill] = ROLE[s.role as keyof typeof ROLE];
                return (
                  <div className="card" key={s.id}>
                    <span className={`pill ${pill}`}>{label}</span>
                    <h3 style={{ margin: "16px 0 10px" }}>{s.label}</h3>
                    {s.job_to_be_done && <p className="sub"><strong>Wil bereiken:</strong> {s.job_to_be_done}</p>}
                    {s.pain && <p className="sub mt-8"><strong>Pijn:</strong> {s.pain}</p>}
                    {s.current_alternative && <p className="sub mt-8"><strong>Nu:</strong> {s.current_alternative}</p>}
                    <div className="divider" />
                    <div className="tiny">Nog te toetsen</div>
                    <strong style={{ fontSize: 14 }}>{s.open_question ?? "—"}</strong>
                    {canWrite && (
                      <form action={deleteSegment.bind(null, id, s.id)} className="mt-12"><button className="text-link" style={{ color: "var(--color-risk-text)" }}>Verwijderen</button><FormPendingOverlay /></form>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {canWrite && (
            <div className="card mt-18">
              <h3>Segment toevoegen</h3>
              <ActionForm action={saveSegment.bind(null, id)} submitLabel="Toevoegen" resetOnSuccess>
                <div className="double-field mt-12">
                  <div className="form-line">
                    <label htmlFor="sg-role">Rol</label>
                    <select className="field" id="sg-role" name="role" defaultValue="user">
                      {Object.entries(ROLE).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div className="form-line"><label htmlFor="sg-label">Naam</label><input className="field" id="sg-label" name="label" placeholder="Bijv. Bestuurder of gebruiker" /></div>
                </div>
                <div className="form-line"><label htmlFor="sg-job">Wat probeert deze persoon te bereiken?</label><input className="field" id="sg-job" name="job_to_be_done" /></div>
                <div className="double-field">
                  <div className="form-line"><label htmlFor="sg-pain">Pijn of frustratie</label><input className="field" id="sg-pain" name="pain" /></div>
                  <div className="form-line"><label htmlFor="sg-alt">Huidige oplossing</label><input className="field" id="sg-alt" name="current_alternative" /></div>
                </div>
                <div className="form-line"><label htmlFor="sg-open">Belangrijkste open vraag</label><input className="field" id="sg-open" name="open_question" /></div>
              </ActionForm>
            </div>
          )}
          <CustomerSignals ideaId={id} signals={signals} sources={signalSources} canWrite={canWrite} aiConnected={aiConfigured()} />
          <div className="card" style={{ marginTop: 18 }}>
            <div className="eyebrow">Goede vraag voor echt onderzoek</div>
            <h3 style={{ margin: "7px 0" }}>&quot;Kun je vertellen over de laatste keer dat je dit probleem had?&quot;</h3>
            <p className="sub">Dat levert vaak concreter gedrag op dan vragen of iemand jouw nieuwe oplossing aantrekkelijk vindt.</p>
          </div>
        </div>

        {/* Klantonderzoek: verkennende enquêtes en online interviews bij de onderzoeksvragen */}
        <div key="klantonderzoek">
          <CustomerResearchPanel
            ideaId={id}
            canWrite={canWrite}
            schemaReady={studies.schemaReady}
            rows={studies.rows}
            questions={questions.map((q) => ({ id: q.id, position: q.position, question: q.question }))}
            audience={[idea.target_audience, idea.audience_detail].filter(Boolean).join(", ")}
            aiConnected={aiConfigured()}
            createAction={createStudy.bind(null, id)}
          />
        </div>

        {/* Marktpotentieel */}
        <div key="sizing">
          <SizingPanel
            // D5: opnieuw opbouwen als de omzet per klant op de server verandert (bijv. na "Neem intakeprijs over").
            // Fase 2, punt 6: ook na "Haal uit CBS" (andere waarde en bron bij een factor).
            key={(scenRes.data ?? []).map((sc) => (sc.sizing_factors ?? []).map((f) => `${f.key}:${f.value}:${f.claim_id ?? ""}`).join(",")).join("|")}
            cbsActions={canWrite ? { metadata: cbsTableMetadata.bind(null, id), preview: cbsCellPreview.bind(null, id), save: saveCbsFactor.bind(null, id) } : null}
            intakePrice={intakePrice}
            adoptIntakePrice={canWrite && intakePrice ? adoptIntakePrice.bind(null, id) : null}
            canWrite={canWrite}
            claims={sizingClaims}
            scenarios={(scenRes.data ?? []).map((s) => ({
              id: s.id,
              kind: s.kind as ScenarioKind,
              model: s.model as SizingModel,
              factors: (s.sizing_factors ?? []).sort((a, b) => a.position - b.position).map((f) => ({ key: f.key, label: f.label, unit: f.unit, value: Number(f.value), claim_id: f.claim_id, note: f.note, low: f.low_value, high: f.high_value, year: f.year, region: f.region })),
            }))}
            breakEvenRevenue={breakEvenRevenue({ grossMarginPct: ue?.gross_margin_pct ?? null, fixedCostsYear: ue?.fixed_costs_year ?? null })}
            actions={Object.fromEntries((scenRes.data ?? []).map((s) => [s.id, saveScenario.bind(null, id, s.id)]))}
          />
          <SectorRegisterPanel
            registers={registers}
            targets={registerTargets}
            canWrite={canWrite}
            templateHref={`/app/ideas/${id}/research/sectorregister-sjabloon.csv`}
            importAction={canWrite ? importSectorRegister.bind(null, id) : null}
            attachFileActions={canWrite ? Object.fromEntries(registers.map((r) => [r.sourceId, attachRegisterFile.bind(null, id, r.sourceId)])) : {}}
            fetchPageActions={canWrite ? Object.fromEntries(registers.map((r) => [r.sourceId, fetchRegisterPage.bind(null, id, r.sourceId)])) : {}}
            linkActions={canWrite ? Object.fromEntries(registers.map((r) => [r.sourceId, linkSectorRegister.bind(null, id, r.sourceId)])) : {}}
          />
          <Detail>
          <UnitEconomicsPanel
            canWrite={canWrite}
            action={saveUnitEconomics.bind(null, id)}
            initial={{
              pricePerCustomerYear: ue?.price_per_customer_year ?? null,
              grossMarginPct: ue?.gross_margin_pct ?? null,
              cacEur: ue?.cac_eur ?? null,
              annualChurnPct: ue?.annual_churn_pct ?? null,
              fixedCostsYear: ue?.fixed_costs_year ?? null,
              upfrontInvestment: ue?.upfront_investment ?? null,
            }}
          />
          </Detail>
        </div>

        {/* Bronnen */}
        <div key="sources">
          <div className="section-title">
            <div>
              <h2>Alle bronnen bij elkaar.</h2>
              <p className="sub">Per bron: herkomst, datum, het bewaarde fragment en welke bevindingen erop steunen.</p>
            </div>
          </div>
          <div className="card">
            {sources.length === 0 && <p className="sub">Nog geen bronnen.</p>}
            {sources.map((s) => {
              const used = claims.filter((c) => c.evidence.some((e) => e.source_id === s.id)).length;
              const sc = supportCounts(s.id);
              const missingHere = claims.some((c) => c.evidence.some((e) => e.source_id === s.id && e.live_found === false));
              return (
                <div className="source-item" key={s.id} id={`bron-${s.id}`}>
                  <span className="source-icon" aria-hidden="true">{s.source_type === "official_statistic" ? "▣" : s.url ? "↗" : "◉"}</span>
                  <div style={{ flex: 1 }}>
                    <strong>{s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a> : s.title}</strong>
                    <p>
                      {SOURCE_TYPES[s.source_type as SourceType]}
                      {s.publisher ? ` · ${s.publisher}` : ""} · {s.published_on ? new Date(s.published_on).toLocaleDateString("nl-NL") : "datum onbekend"} · opgehaald{" "}
                      {new Date(s.retrieved_at).toLocaleDateString("nl-NL")} · {plural(s.excerptCount, "fragment", "fragmenten")} · {plural(used, "bevinding", "bevindingen")}
                    </p>
                    {s.access_note && <p style={{ whiteSpace: "pre-line" }}>{s.access_note}</p>}
                    {(s.found_by ?? []).length > 0 && (
                      <p className="tiny">
                        Gevonden door: {s.found_by.filter(isProvider).map((p) => PROVIDER_LABELS[p].name).join(", ")}
                        {s.found_by.length > 1 ? " · meerdere aanbieders vonden deze pagina los van elkaar; ter informatie, het telt niet als extra bewijs." : ""}
                      </p>
                    )}
                    {used > 0 && (
                      <p style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        Draagt het citaat de bewering?
                        {(Object.keys(sc) as SupportCheck[]).filter((k) => sc[k] > 0).map((k) => (
                          <span key={k} className={`pill ${SUPPORT_LABEL[k].pill}`} title={SUPPORT_LABEL[k].explain}>{sc[k]}× {SUPPORT_LABEL[k].label.toLowerCase()}</span>
                        ))}
                        {missingHere && <span className="pill coral">citaat niet meer op de pagina</span>}
                      </p>
                    )}
                    <details>
                      <summary className="text-link">{isImportedReport(s.access_note) ? `Uitgelezen tekst (${s.excerptCount} blokken)` : "Bewaarde fragmenten"}</summary>
                      {(s.source_excerpts ?? []).map((e) => (
                        <blockquote className="quote" key={e.id}>{e.text}{e.location ? <span className="tiny"> ({e.location})</span> : null}</blockquote>
                      ))}
                      {s.excerptCount > s.source_excerpts.length && (
                        <p className="tiny">
                          De eerste {s.source_excerpts.length} van {s.excerptCount} blokken. Leg een bevinding uit dit rapport vast in het importblok hieronder: ProofLab zoekt daar
                          zelf het blok bij je citaat.
                        </p>
                      )}
                    </details>
                  </div>
                  <div className="stack" style={{ justifyItems: "end" }}>
                    <span className={`pill ${s.is_primary || s.source_type === "official_statistic" ? "green" : "gray"}`}>{s.is_primary ? "Primair" : s.source_type === "official_statistic" ? "Officieel" : "Secundair"}</span>
                    {canWrite && (
                      <form action={deleteSource.bind(null, id, s.id)}><button className="text-link" style={{ color: "var(--color-risk-text)" }}>Verwijderen</button><FormPendingOverlay /></form>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {canWrite && (
            <ReportImport
              ideaId={id}
              supabaseUrl={env.supabaseUrl}
              supabaseKey={env.supabaseKey}
              documents={importableDocs}
              reports={importedReports}
              questions={questions.map((q) => ({ id: q.id, position: q.position, question: q.question }))}
              aiAvailable={aiConfigured()}
            />
          )}
          {canWrite && (
            <div className="grid-2 mt-18">
              <div className="card" id="bron-toevoegen" style={{ scrollMarginTop: 100 }}>
                <h3>1. Bron toevoegen</h3>
                <p className="sub" style={{ margin: "6px 0 12px" }}>URL, CSV-regel of rapportpassage: alleen het relevante fragment wordt bewaard.</p>
                <AddSourceForm action={addSource.bind(null, id)} />
              </div>
              <div className="card">
                <h3>2. Bevinding met citaat vastleggen</h3>
                <p className="sub" style={{ margin: "6px 0 12px" }}>ProofLab controleert of het citaat letterlijk in het fragment staat en bepaalt de status zelf.</p>
                <AddClaimForm action={addClaim.bind(null, id)} excerpts={excerpts} questions={questions.map((q) => ({ id: q.id, position: q.position, question: q.question }))} />
              </div>
            </div>
          )}
          {quality && (
            <div className="mt-18">
              <Detail>
              <AiQualityCard
                measures={[
                  { title: "Steuncontrole: eens met de consultant", measure: quality.support },
                  { title: "AI-codering van interviews: geaccepteerd", measure: quality.coding },
                ]}
              />
              </Detail>
            </div>
          )}
          <div className="note">
            Statussen: {Object.values(CLAIM_STATUS).map((s) => s.label).join(" · ")}. De status wordt berekend uit de bronnen en het citaat, niet handmatig gekozen.
          </div>
        </div>
      </Tabs>
      <TaskFooter ideaId={id} next={list.phases.find((ph) => ph.key === "assumptions")!.tasks[0]} nextLabel="Verder: Aannames" />
    </PageFrame>
  );
}

function DeleteQuestion({ ideaId, questionId }: { ideaId: string; questionId: string }) {
  return (
    <button formAction={deleteQuestion.bind(null, ideaId, questionId)} className="text-link" style={{ color: "var(--color-risk-text)" }}>
      Vraag verwijderen
    </button>
  );
}

type LogRow = { id: string; question_id: string | null; question: string | null; provider: string; query: string; urls: unknown; passages: number; reused: boolean; kind?: string };

// Zoeklogboek per onderzoeksvraag, in de volgorde van de onderzoekskaart.
function groupSearchLog(rows: LogRow[], questions: { id: string; position: number; question: string }[]): QuestionLog[] {
  const groups = new Map<string, QuestionLog>();
  for (const r of rows) {
    const key = r.question_id ?? `vraag:${r.question ?? ""}`;
    const q = questions.find((x) => x.id === r.question_id);
    if (!groups.has(key)) groups.set(key, { key, label: q ? `Vraag ${q.position} · ${q.question}` : (r.question ?? "Vraag"), rows: [] });
    const urls = (Array.isArray(r.urls) ? r.urls : []).flatMap((u): SearchLogUrl[] => {
      const x = u as Partial<SearchLogUrl>;
      return typeof x?.url === "string" ? [{ url: x.url, title: typeof x.title === "string" ? x.title : null, status: String(x.status ?? "niet_opgehaald"), reason: String(x.reason ?? "") }] : [];
    });
    groups.get(key)!.rows.push({ id: r.id, provider: isProvider(r.provider) ? PROVIDER_LABELS[r.provider].short : "ProofLab", query: r.query, passages: r.passages, reused: r.reused, urls });
  }
  const order = (k: string) => questions.find((q) => q.id === k)?.position ?? 99;
  return [...groups.values()].sort((a, b) => order(a.key) - order(b.key));
}

// Providers that would run the web search for this organisation (its choice first, ensemble on or off).
// Fase B2, punt 5: per stap de mislukte aanbieders met een korte reden, en of "opnieuw proberen" kan.
function runTaskView(t: { id: string; label: string; status: string; detail: string | null; kind: string; output: unknown; question_id: string | null }) {
  const retryKind = !!t.question_id && ["search", "extract", "counter"].includes(t.kind);
  return {
    id: t.id,
    label: t.label,
    status: t.status,
    detail: t.detail,
    failures: t.status === "done" && retryKind
      ? failedProviders(t.output).map((f) => ({
          provider: f.provider,
          name: isProvider(f.provider) ? PROVIDER_LABELS[f.provider].name : f.provider,
          reason: FAILURE_TEXT[f.reason],
          canRetry: retryable(f.reason),
        }))
      : [],
    canRetry: retryKind && t.status === "failed",
  };
}

function workerState(lease: { error: unknown; data: { lease_until: string } | null } | null): "busy" | "idle" | "unknown" {
  if (!lease || lease.error) return "unknown";
  return lease.data && new Date(lease.data.lease_until).getTime() > Date.now() ? "busy" : "idle";
}

async function researchProviders(orgId: string) {
  return ensembleProviders(await aiSettingsForOrg(orgId), "research", configuredProviders());
}
